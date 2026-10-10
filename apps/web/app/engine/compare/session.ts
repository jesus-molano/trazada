/**
 * Comparación de dos pilotos en una sesión cargada (ítem 1, D31; TS puro, sin Vue ni three): une la vuelta de
 * referencia (./reference.ts), la diferencia en vivo (./delta.ts), el fantasma (./ghost.ts), las trazas por distancia
 * (./trace.ts) y la diferencia oficial al cerrar la vuelta. Una por runtime (`rt.ext(COMPARE_EXT, createCompare)`),
 * perezosa: los inicios de vuelta y las trazas de cada coche se calculan la primera vez que hacen falta.
 *
 * Por frame solo hay dos búsquedas binarias por coche y una muestra de la pista de movimiento; `frame` se memoiza por
 * sus argumentos, así que el panel y la capa del fantasma comparten el mismo cálculo en cada frame. Lo que devuelve se
 * muta en sitio en la siguiente llamada: quien lo lee no se lo guarda.
 */
import type { DecodedTrzb, SessionType } from '@trazada/schema'
import { type CarLaps, LAP_DELETED, lapIs, type LapTable, lastCompletedIndex } from '../analysis/lapTable'
import type { CarTrack } from '../replay/motion'
import { type CarSeries, Telemetry } from '../telemetry/telemetry'
import { type LapDelta, lapDelta, newLapDelta, type RefAnchor } from './delta'
import { type Ghost, ghostAt, newGhost } from './ghost'
import { carLapStarts, inLap, lapAtTime, type LapStarts, lapStartTime } from './laps'
import { type CompareRef, defaultCompareRef, referenceLap, type RefMissing } from './reference'
import { type LapTrace, lapTrace } from './trace'

/** Clave de `rt.ext` de la comparación (una por runtime, perezosa). */
export const COMPARE_EXT = 'compare'

/**
 * Por qué no hay comparación en este instante:
 * - `noLapA`: A no está en ninguna vuelta (antes de salir, entre vueltas, sin inicio de vuelta conocido).
 * - `noPositionA`: no hay posición de A al empezar su vuelta (hueco o fuera de los datos).
 * - `noLap`, `notStarted`: ver `RefMissing` (B sin esa vuelta o sin empezarla).
 * - `noPosition`: no hay posición de B al empezar su vuelta de referencia (fuera de los datos, hueco o sin inicio).
 */
export type CompareMissing = 'noLapA' | 'noPositionA' | RefMissing | 'noPosition'

export interface CompareFrame {
  t: number
  a: string
  b: string
  mode: CompareRef
  /** Vuelta en curso de A: índice en sus inicios de vuelta (−1) y número (null). */
  kA: number
  lapA: number | null
  /** Vuelta de referencia de B: índice en su tabla de vueltas y en sus inicios (−1), y número (null). */
  jB: number
  kB: number
  lapB: number | null
  /** Tiempo oficial de la vuelta de referencia (ms), o null sin tiempo. */
  lapMsB: number | null
  /** null si hay vuelta de A y de referencia, ambas con posición al empezar. */
  missing: CompareMissing | null
  delta: LapDelta
  ghost: Ghost
}

/** Diferencia oficial de la última vuelta que completó A frente a su referencia (tiempos de vuelta, dato real). */
export interface OfficialDiff {
  lapA: number
  /** Vuelta de referencia de B; null si no la hay (`missing`). */
  lapB: number | null
  /** Tiempos oficiales (ms); null sin tiempo oficial. */
  msA: number | null
  msB: number | null
  /** msA − msB (ms); null si falta alguno o B aún no ha cerrado la vuelta de referencia. */
  diffMs: number | null
  /** B aún no ha cerrado (o empezado) esa vuelta en el instante actual: la cifra llegará cuando la cierre. */
  pending: boolean
  /** Anuladas por dirección de carrera en el instante actual. */
  deletedA: boolean
  deletedB: boolean
  /** Sin vuelta de referencia. */
  missing: 'noLap' | null
}

/** Lo que la comparación necesita del runtime del replay (estructural: el motor no depende de `replay/`). */
export interface CompareSource {
  readonly session: { readonly manifest: { readonly session: { readonly type: SessionType } }; readonly car: DecodedTrzb }
  readonly model: { readonly tracks: readonly CarTrack[] }
  readonly leaderboard: { readonly lapTable: LapTable }
  readonly circuit: { readonly centerline: { readonly length: number } }
}

/**
 * Índice en los inicios de vuelta de la vuelta número `lap` que empezó en `start`, o −1 (sin inicio conocido, o uno
 * que no avanzaba y no entró). Los números no decrecen; con dos filas del mismo número, la de ese inicio.
 */
function startIndex(starts: LapStarts, lap: number, start: number | null): number {
  if (start === null) return -1
  let lo = 0
  let hi = starts.lap.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (starts.lap[mid]! < lap) lo = mid + 1
    else hi = mid
  }
  for (let k = lo; k < starts.lap.length && starts.lap[k] === lap; k++) if (starts.t[k] === start) return k
  return -1
}

export class CompareSession {
  readonly type: SessionType
  /** Longitud de una vuelta (m): la de la línea central. */
  readonly lengthM: number
  /** Referencia por defecto para el tipo de sesión. */
  readonly defaultRef: CompareRef
  private readonly table: LapTable
  private readonly tracks = new Map<string, CarTrack>()
  private readonly startsByCar = new Map<string, LapStarts>()
  private readonly car: DecodedTrzb
  private telemetry: Telemetry | null = null
  private readonly traces = new Map<string, LapTrace>()
  private readonly out: CompareFrame
  private memo: { a: string; b: string; mode: CompareRef; t: number } | null = null
  private readonly refAnchor: RefAnchor = { t: 0, s: 0, end: 0 }

  constructor(src: CompareSource) {
    this.type = src.session.manifest.session.type
    this.lengthM = src.circuit.centerline.length
    this.defaultRef = defaultCompareRef(this.type)
    this.table = src.leaderboard.lapTable
    this.car = src.session.car
    for (const tr of src.model.tracks) this.tracks.set(tr.car, tr)
    this.out = {
      t: 0,
      a: '',
      b: '',
      mode: this.defaultRef,
      kA: -1,
      lapA: null,
      jB: -1,
      kB: -1,
      lapB: null,
      lapMsB: null,
      missing: 'noLapA',
      delta: newLapDelta(),
      ghost: newGhost(),
    }
  }

  laps(car: string): CarLaps | null {
    return this.table.cars.get(car) ?? null
  }

  track(car: string): CarTrack | null {
    return this.tracks.get(car) ?? null
  }

  /** Inicios de vuelta de un coche (en tiempo y en distancia), o null si no tiene vueltas. */
  starts(car: string): LapStarts | null {
    let st = this.startsByCar.get(car)
    if (!st) {
      const laps = this.laps(car)
      if (!laps) return null
      st = carLapStarts(laps, this.track(car))
      this.startsByCar.set(car, st)
    }
    return st
  }

  series(car: string): CarSeries | null {
    this.telemetry ??= new Telemetry(this.car)
    return this.telemetry.seriesOf(car)
  }

  /** Comparación de A con B (referencia `mode`) en t. Memoizada: con los mismos argumentos, el mismo cálculo. */
  frame(a: string, b: string, mode: CompareRef, t: number): CompareFrame {
    const m = this.memo
    if (m && m.a === a && m.b === b && m.mode === mode && m.t === t) return this.out
    this.memo = { a, b, mode, t }
    const f = this.out
    f.t = t
    f.a = a
    f.b = b
    f.mode = mode
    f.kA = -1
    f.lapA = null
    f.jB = -1
    f.kB = -1
    f.lapB = null
    f.lapMsB = null
    f.missing = null
    const d = f.delta
    d.state = 'noData'
    d.ms = Number.NaN
    d.dA = Number.NaN
    d.at = Number.NaN
    f.ghost.state = 'noData'
    f.ghost.t = Number.NaN

    const startsA = this.starts(a)
    const trackA = this.track(a)
    const kA = startsA ? lapAtTime(startsA, t) : -1
    if (!startsA || !trackA || kA < 0 || !inLap(startsA, kA, t)) {
      f.missing = 'noLapA'
      return f
    }
    f.kA = kA
    f.lapA = startsA.lap[kA]!
    const anchorA = { t: startsA.t[kA]!, s: startsA.s[kA]! }
    if (Number.isNaN(anchorA.s)) {
      f.missing = 'noPositionA'
      return f
    }
    const lapsB = this.laps(b)
    if (!lapsB) {
      f.missing = 'noLap'
      return this.distanceOnly(f, trackA, anchorA, t)
    }
    const ref = referenceLap(lapsB, mode, f.lapA, anchorA.t, t)
    if (!ref.ok) {
      f.missing = ref.reason
      return this.distanceOnly(f, trackA, anchorA, t)
    }
    f.jB = ref.j
    f.lapB = lapsB.lap[ref.j]!
    f.lapMsB = lapsB.lapMs[ref.j]! > 0 ? lapsB.lapMs[ref.j]! : null
    const startsB = this.starts(b)!
    const trackB = this.track(b)
    const kB = startIndex(startsB, f.lapB, lapStartTime(lapsB, ref.j))
    if (!trackB || kB < 0 || Number.isNaN(startsB.s[kB]!)) {
      f.missing = 'noPosition'
      return this.distanceOnly(f, trackA, anchorA, t)
    }
    f.kB = kB
    const anchorB = this.refAnchor
    anchorB.t = startsB.t[kB]!
    anchorB.s = startsB.s[kB]!
    anchorB.end = startsB.end[kB]!
    lapDelta(trackA, anchorA, trackB, anchorB, t, d)
    ghostAt(trackB, anchorA, anchorB, t, f.ghost)
    return f
  }

  /** Sin referencia: solo la distancia de A en su vuelta (para el cursor de las gráficas). */
  private distanceOnly(f: CompareFrame, trackA: CarTrack, anchorA: { t: number; s: number }, t: number): CompareFrame {
    const nowhere: RefAnchor = { t: anchorA.t, s: Number.NaN, end: Number.NaN }
    lapDelta(trackA, anchorA, trackA, nowhere, t, f.delta)
    if (f.delta.state === 'ok') f.delta.state = 'noData'
    return f
  }

  /** Traza por distancia de la vuelta de A del frame (completa: se recorta al dibujar con `traceCount`). */
  traceA(f: CompareFrame): LapTrace | null {
    return f.kA < 0 ? null : this.trace(f.a, f.kA)
  }

  /** Traza por distancia de la vuelta de referencia de B del frame. */
  traceB(f: CompareFrame): LapTrace | null {
    return f.kB < 0 ? null : this.trace(f.b, f.kB)
  }

  private trace(car: string, k: number): LapTrace | null {
    const key = `${car}:${k}`
    let tr = this.traces.get(key)
    if (!tr) {
      const starts = this.starts(car)
      const track = this.track(car)
      if (!starts || !track || k < 0 || k >= starts.t.length) return null
      const end = Number.isNaN(starts.end[k]!) ? (starts.t[k + 1] ?? Infinity) : starts.end[k]!
      tr = lapTrace(this.series(car), track, { t: starts.t[k]!, s: starts.s[k]! }, end, this.lengthM)
      // Solo las últimas: una comparación usa dos a la vez (la de A y la de B) y cambian al cambiar de vuelta.
      if (this.traces.size >= 8) this.traces.delete(this.traces.keys().next().value!)
      this.traces.set(key, tr)
    }
    return tr
  }

  /**
   * Diferencia oficial de la última vuelta que A completó en t frente a su referencia (la misma regla que en vivo:
   * mejor y última vuelta de B fijadas al empezar A esa vuelta). Tiempos de vuelta oficiales: dato real, sin
   * redondear. null si A aún no ha completado ninguna vuelta.
   */
  official(a: string, b: string, mode: CompareRef, t: number): OfficialDiff | null {
    const lapsA = this.laps(a)
    if (!lapsA) return null
    const k = lastCompletedIndex(lapsA, t)
    if (k < 0) return null
    const lapA = lapsA.lap[k]!
    const msA = lapsA.lapMs[k]! > 0 ? lapsA.lapMs[k]! : null
    const deletedA = lapIs(lapsA, k, LAP_DELETED, t)
    const none: OfficialDiff = {
      lapA,
      lapB: null,
      msA,
      msB: null,
      diffMs: null,
      pending: false,
      deletedA,
      deletedB: false,
      missing: 'noLap',
    }
    const lapsB = this.laps(b)
    const startA = lapStartTime(lapsA, k)
    if (!lapsB || (startA === null && mode !== 'same')) return none
    const ref = referenceLap(lapsB, mode, lapA, startA ?? -Infinity, t)
    if (!ref.ok) return ref.reason === 'notStarted' ? { ...none, lapB: lapA, pending: true, missing: null } : none
    const j = ref.j
    const crossB = lapsB.crossMs[j]!
    const pending = !(crossB > 0 && crossB <= t)
    const msB = !pending && lapsB.lapMs[j]! > 0 ? lapsB.lapMs[j]! : null
    return {
      lapA,
      lapB: lapsB.lap[j]!,
      msA,
      msB,
      diffMs: msA !== null && msB !== null ? msA - msB : null,
      pending,
      deletedA,
      deletedB: !pending && lapIs(lapsB, j, LAP_DELETED, t),
      missing: null,
    }
  }
}

/** La comparación de una sesión cargada (para `rt.ext(COMPARE_EXT, createCompare)`). */
export function createCompare(src: CompareSource): CompareSession {
  return new CompareSession(src)
}
