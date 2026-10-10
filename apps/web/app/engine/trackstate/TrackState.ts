/**
 * Estado de la pista en el instante del reloj, derivado solo de `events.json` (banderas por sector ya
 * resueltas por el pipeline y ventanas de estado). TS puro: lo usan la escena, la interfaz y los tests.
 *
 * Un intervalo está activo en t si `fromMs ≤ t < toMs` (un `toMs` nulo se cierra al final de la sesión).
 */
import type { SectorFlag, SessionEvents, WindowKind } from '@trazada/schema'

export type NeutralKind = 'red' | 'sc' | 'vsc' | 'vsc-ending'
export type SectorFlagKind = SectorFlag['flag']

/** Prioridad cuando se solapan: la roja manda sobre el SC, y este sobre el VSC. */
export const NEUTRAL_PRIORITY: readonly NeutralKind[] = ['red', 'sc', 'vsc', 'vsc-ending']

export interface TrackStateSnapshot {
  /** Banderas activas por sector de comisarios (número de sector → bandera). */
  sectors: Record<number, SectorFlagKind>
  /** Neutralización vigente, o null con la pista en verde. */
  neutral: NeutralKind | null
  /** Amarilla en algún punto de la pista según el estado de pista oficial (TrackStatus 2). */
  yellow: boolean
  /** Ventana de OVERTAKE (2026) o de DRS (2023–25) activada por race control. */
  overtake: boolean
  drs: boolean
}

interface Interval<K> {
  kind: K
  fromMs: number
  toMs: number
}

const FLAG_RANK: Record<SectorFlagKind, number> = { YELLOW: 1, 'DOUBLE YELLOW': 2, RED: 3 }

export function emptySnapshot(): TrackStateSnapshot {
  return { sectors: {}, neutral: null, yellow: false, overtake: false, drs: false }
}

export class TrackState {
  /** Último estado calculado. Se sustituye (no se muta) cuando cambia: sirve como valor para Vue. */
  snapshot: TrackStateSnapshot = emptySnapshot()
  /** Sube cada vez que cambia el estado (los oyentes por frame comparan versiones). */
  version = 0
  private key = ''
  private readonly sectorFlags: (Interval<SectorFlagKind> & { sector: number })[]
  private readonly windows: Interval<WindowKind>[]

  constructor(events: SessionEvents, endMs: number) {
    const close = (to: number | null) => (to === null ? endMs : to)
    this.sectorFlags = events.sectorFlags.map((f) => ({
      kind: f.flag,
      sector: f.sector,
      fromMs: f.fromMs,
      toMs: close(f.toMs),
    }))
    this.windows = events.windows.map((w) => ({ kind: w.kind, fromMs: w.fromMs, toMs: close(w.toMs) }))
  }

  /** Recalcula el estado en t. Devuelve true si ha cambiado. */
  update(t: number): boolean {
    const sectors: Record<number, SectorFlagKind> = {}
    for (const f of this.sectorFlags) {
      if (f.fromMs <= t && t < f.toMs) {
        const prev = sectors[f.sector]
        if (!prev || FLAG_RANK[f.kind] > FLAG_RANK[prev]) sectors[f.sector] = f.kind
      }
    }
    let neutral: NeutralKind | null = null
    let yellow = false
    let overtake = false
    let drs = false
    for (const w of this.windows) {
      if (!(w.fromMs <= t && t < w.toMs)) continue
      if (w.kind === 'yellow') yellow = true
      else if (w.kind === 'overtake') overtake = true
      else if (w.kind === 'drs') drs = true
      else if (neutral === null || NEUTRAL_PRIORITY.indexOf(w.kind) < NEUTRAL_PRIORITY.indexOf(neutral)) {
        neutral = w.kind
      }
    }
    const key = `${Object.entries(sectors).join(';')}|${neutral}|${+yellow}${+overtake}${+drs}`
    if (key === this.key) return false
    this.key = key
    this.snapshot = { sectors, neutral, yellow, overtake, drs }
    this.version++
    return true
  }
}

/** Número de mensajes con `t ≤ timeMs` en una lista ordenada por t (búsqueda binaria). */
export function visibleCount(times: ArrayLike<number>, timeMs: number): number {
  let lo = 0
  let hi = times.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (times[mid]! <= timeMs) lo = mid + 1
    else hi = mid
  }
  return lo
}
