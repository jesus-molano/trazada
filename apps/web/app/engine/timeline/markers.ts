/** Marcadores del timeline, derivados solo de `timing` y `events` (sin estimaciones). */
import type { DecodedTrzb, SessionEvents, SessionType, WindowKind } from '@trazada/schema'
import { lapsView } from '../data/columns'

export const WINDOW_KINDS: readonly WindowKind[] = ['sc', 'vsc', 'vsc-ending', 'red']
/** Ventanas de ayuda al adelantamiento: OVERTAKE (2026) y DRS (2023–25), en su propio carril. */
export const ASSIST_KINDS = ['overtake', 'drs'] as const
export type AssistKind = (typeof ASSIST_KINDS)[number]
export const FLAG_KINDS = ['red_flag', 'chequered_flag', 'sector_yellow', 'sector_double_yellow'] as const
export type FlagKind = (typeof FLAG_KINDS)[number]

export interface TimelineMarkers {
  /** Inicio de cada vuelta del líder (carrera y sprint): el primer coche que la empieza. */
  laps: { lap: number; t: number }[]
  windows: { kind: WindowKind; fromMs: number; toMs: number }[]
  assists: { kind: AssistKind; fromMs: number; toMs: number }[]
  flags: { kind: FlagKind; t: number; sector: number | null }[]
  /** Paradas en boxes por coche (entrada y salida del pit lane). */
  pits: { car: string; inMs: number; outMs: number | null }[]
}

export function buildTimelineMarkers(
  type: SessionType,
  timing: DecodedTrzb,
  events: SessionEvents,
  endMs: number,
): TimelineMarkers {
  const laps = lapsView(timing)

  const lapStarts = new Map<number, number>()
  if (type === 'race' || type === 'sprint') {
    for (let i = 0; i < laps.rows; i++) {
      const start = laps.startMs[i]!
      const lap = laps.lap[i]!
      if (start < 0 || lap < 1) continue
      const prev = lapStarts.get(lap)
      if (prev === undefined || start < prev) lapStarts.set(lap, start)
    }
  }

  const pits: TimelineMarkers['pits'] = []
  const byCar = new Map<string, { lap: number; inMs: number; outMs: number }[]>()
  for (let i = 0; i < laps.rows; i++) {
    const car = String(laps.car[i])
    const list = byCar.get(car) ?? []
    list.push({ lap: laps.lap[i]!, inMs: laps.pitInMs[i]!, outMs: laps.pitOutMs[i]! })
    byCar.set(car, list)
  }
  for (const [car, rows] of byCar) {
    rows.sort((a, b) => a.lap - b.lap)
    const outs = rows.filter((r) => r.outMs >= 0).map((r) => r.outMs)
    for (const r of rows) {
      if (r.inMs < 0) continue
      pits.push({ car, inMs: r.inMs, outMs: outs.find((o) => o > r.inMs) ?? null })
    }
  }
  pits.sort((a, b) => a.inMs - b.inMs)

  return {
    laps: [...lapStarts].map(([lap, t]) => ({ lap, t })).sort((a, b) => a.lap - b.lap),
    windows: events.windows
      .filter((w) => WINDOW_KINDS.includes(w.kind))
      .map((w) => ({ kind: w.kind, fromMs: w.fromMs, toMs: w.toMs ?? endMs })),
    assists: events.windows
      .filter((w) => (ASSIST_KINDS as readonly string[]).includes(w.kind))
      .map((w) => ({ kind: w.kind as AssistKind, fromMs: w.fromMs, toMs: w.toMs ?? endMs })),
    flags: events.raceControl
      .filter((e) => (FLAG_KINDS as readonly string[]).includes(e.parsed.kind))
      .map((e) => ({ kind: e.parsed.kind as FlagKind, t: e.t, sector: e.sector })),
    pits,
  }
}

/** Vuelta del líder en el instante t (0 antes de la salida). */
export function leaderLapAt(markers: TimelineMarkers, t: number): number {
  let lo = 0
  let hi = markers.laps.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (markers.laps[mid]!.t <= t) lo = mid + 1
    else hi = mid
  }
  return lo === 0 ? 0 : markers.laps[lo - 1]!.lap
}

const SESSION_STARTED = 2 // enum sessionStatus: Unknown, Inactive, Started…

/**
 * Origen del reloj visible: la salida en carrera y sprint; en el resto, el primer "Started" de la
 * sesión (o el inicio de la reproducción si no lo hay).
 */
export function clockOrigin(
  type: SessionType,
  timing: DecodedTrzb,
  playback: { startMs: number; lightsOutMs?: number | null },
): number {
  if ((type === 'race' || type === 'sprint') && playback.lightsOutMs != null) return playback.lightsOutMs
  const status = timing.tables.sessionStatus
  if (status) {
    const t = status.columns.t!
    const s = status.columns.status!
    for (let i = 0; i < status.rows; i++) if (s[i] === SESSION_STARTED) return t[i]!
  }
  return playback.startMs
}
