/**
 * Índice de vueltas por coche, con la clasificación de cada vuelta, a partir de la tabla de vueltas del
 * cronometraje (dato real; TS puro, sin Vue ni three). Lo comparten la clasificación (leaderboard) y los
 * análisis por vuelta (race trace, ritmo, sectores, momentos).
 *
 * - Vueltas de cada coche ordenadas por número de vuelta (orden estable: dos filas con el mismo número quedan en
 *   el orden de la tabla).
 * - Paso por meta real (`crossMs`): el fin de la vuelta, salvo que no lo haya o que la «vuelta» dure menos de
 *   la mitad de la mediana de los tiempos de vuelta (p. ej. el registro residual de un coche retirado): entonces
 *   −1 y no cuenta como vuelta completada.
 * - Vueltas anuladas: cuentan hasta el mensaje de dirección de carrera que las anula (`deletedFrom`, ver
 *   `deletionTimes`); sin mensaje, desde que acaban. Por eso «anulada» depende del instante (`lapFlagsAt`).
 * - Tandas de clasificación (Q y SQ): cada vuelta pertenece a la tanda en la que empezó (`segment`; −1 entre
 *   tandas). Fuera de clasificación, todas son de la tanda 0.
 * - Clasificación (`kind`, bits `LAP_*`): entrada y salida de boxes, estado de pista durante la vuelta
 *   (`trackStatusMask`), vuelta 1, sin tiempo oficial y sin paso por meta real.
 */
import type { DecodedTrzb, RaceControlEvent, SessionType, TypedColumn } from '@trazada/schema'
import { lapsView } from '../data/columns'
import { deletionTimes } from '../timing/deletions'

/** Vuelta de entrada a boxes (`pitInMs` ≥ 0). */
export const LAP_PIT_IN = 1 << 0
/** Vuelta de salida de boxes (`pitOutMs` ≥ 0). */
export const LAP_PIT_OUT = 1 << 1
/** Amarilla en algún momento de la vuelta (TrackStatus 2). */
export const LAP_YELLOW = 1 << 2
/** Safety car en algún momento de la vuelta (TrackStatus 4). */
export const LAP_SC = 1 << 3
/** Coche de seguridad virtual o su final en algún momento de la vuelta (TrackStatus 6 y 7). */
export const LAP_VSC = 1 << 4
/** Bandera roja en algún momento de la vuelta (TrackStatus 5). */
export const LAP_RED = 1 << 5
/**
 * Vuelta 1 de cada coche, en toda sesión: en carrera y sprint es la de la salida parada (sin tiempo oficial en el
 * live timing); en libres y clasificación, la primera salida del box. Nunca es representativa.
 */
export const LAP_FIRST = 1 << 6
/** Sin tiempo oficial (`lapMs` −1). */
export const LAP_NO_TIME = 1 << 7
/** Sin paso por meta real (`crossMs` −1). */
export const LAP_NO_LINE = 1 << 8
/** Anulada por dirección de carrera. Solo lo da `lapFlagsAt`, porque depende del instante. */
export const LAP_DELETED = 1 << 9

export const LAP_PIT = LAP_PIT_IN | LAP_PIT_OUT
/** Neutralizada: SC, VSC o bandera roja durante la vuelta (los tiempos no son representativos). */
export const LAP_NEUTRALISED = LAP_SC | LAP_VSC | LAP_RED
/** Lo que deja fuera una comparación de ritmo por defecto (la amarilla no). */
export const LAP_NOT_REPRESENTATIVE = LAP_PIT | LAP_NEUTRALISED | LAP_FIRST | LAP_NO_TIME | LAP_DELETED

/** Bits de `trackStatusMask` (layout `timing`): 1 amarilla, 2 SC, 4 roja, 8 VSC, 16 fin de VSC. */
const MASK_YELLOW = 1
const MASK_SC = 2
const MASK_RED = 4
const MASK_VSC = 8 | 16

export interface CarLaps {
  car: string
  /** Fila de cada vuelta en la tabla `laps`. */
  row: Int32Array
  lap: Int32Array
  /** Inicio oficial (ms de sesión); −1 desconocido. */
  startMs: Float64Array
  /** Fin tal como viene en la tabla (−1 sin dato). */
  endMs: Float64Array
  /** Paso por meta real (ms de sesión) o −1 (ver arriba). */
  crossMs: Float64Array
  /** Tiempo oficial (ms); −1 sin tiempo. */
  lapMs: Float64Array
  /** Tiempos de sector (ms); −1 sin dato. */
  s1Ms: Float64Array
  s2Ms: Float64Array
  s3Ms: Float64Array
  /** Código de `ENUMS.compound`. */
  compound: Uint8Array
  /** Vueltas del juego de neumáticos (incluye otras sesiones); 255 desconocido. */
  tyreLife: Uint8Array
  /** 0 usado, 1 nuevo, 255 desconocido. */
  fresh: Uint8Array
  stint: Uint8Array
  /** Entrada y salida del pit lane (ms de sesión); −1 no hay. */
  pitInMs: Float64Array
  pitOutMs: Float64Array
  /** Posición oficial al final de la vuelta; 0 no aplica. */
  position: Uint8Array
  /** Desde cuándo está anulada (ms de sesión); Infinity, no se anuló. */
  deletedFrom: Float64Array
  /** Tanda de clasificación de la vuelta (0…; −1 entre tandas). Fuera de clasificación, 0. */
  segment: Int8Array
  /** Clasificación fija de la vuelta (bits `LAP_*`, sin `LAP_DELETED`). */
  kind: Uint16Array
}

export interface QualifyingSegments {
  starts: number[]
  ends: number[]
}

export interface LapTable {
  readonly type: SessionType
  /** Carrera o sprint. */
  readonly race: boolean
  /** Clasificación (Q o SQ). */
  readonly quali: boolean
  /** Coches (número como texto) en el orden en que aparecen en la tabla. */
  readonly cars: ReadonlyMap<string, CarLaps>
  readonly segments: QualifyingSegments
  /** Duración mínima de una vuelta con paso por meta real (la mitad de la mediana de los tiempos oficiales). */
  readonly minLapMs: number
  /** La tabla trae el estado de pista por vuelta (si no, no hay bits de amarilla, SC, VSC ni roja). */
  readonly trackStatusKnown: boolean
}

/**
 * Tandas de una clasificación (Q1/Q2/Q3, SQ1/SQ2/SQ3): la k-ésima va desde su inicio (`starts[k]`) hasta su
 * bandera a cuadros (`ends[k]`). Una tanda acaba con la bandera a cuadros y la siguiente empieza con la primera
 * luz verde posterior (una luz verde tras una bandera roja, sin bandera a cuadros, sigue en la misma tanda).
 */
export function qualifyingSegments(raceControl: readonly RaceControlEvent[]): QualifyingSegments {
  const starts = [-Infinity]
  const ends: number[] = []
  const marks = raceControl
    .filter((e) => e.parsed.kind === 'chequered_flag' || e.parsed.kind === 'green_light')
    .sort((a, b) => a.t - b.t)
  for (const e of marks) {
    const open = ends.length < starts.length
    if (e.parsed.kind === 'chequered_flag' && open) ends.push(e.t)
    else if (e.parsed.kind === 'green_light' && !open) starts.push(e.t)
  }
  if (ends.length < starts.length) ends.push(Infinity)
  return { starts, ends }
}

/** Tanda en curso en t (0 fuera de clasificación o sin tandas). */
export function segmentAt(segments: QualifyingSegments, t: number): number {
  let k = 0
  while (k + 1 < segments.starts.length && segments.starts[k + 1]! <= t) k++
  return k
}

export function buildLapTable(
  type: SessionType,
  timing: DecodedTrzb,
  raceControl: readonly RaceControlEvent[],
): LapTable {
  const race = type === 'race' || type === 'sprint'
  const quali = type === 'q' || type === 'sq'
  const v = lapsView(timing)
  const cols = timing.tables.laps!.columns
  // Columnas que un `timing` sintético puede no traer: sin ellas, sus centinelas de «sin dato».
  const optional = (name: string, missing: number): ArrayLike<number> =>
    (cols[name] as TypedColumn | undefined) ?? new Float64Array(v.rows).fill(missing)
  const s1 = optional('s1Ms', -1)
  const s2 = optional('s2Ms', -1)
  const s3 = optional('s3Ms', -1)
  const tyreLife = optional('tyreLife', 255)
  const fresh = optional('fresh', 255)
  const stint = optional('stint', 0)
  const trackStatusKnown = cols.trackStatusMask !== undefined
  const mask = optional('trackStatusMask', 0)

  const rows = new Map<string, number[]>()
  for (let i = 0; i < v.rows; i++) {
    const car = String(v.car[i])
    ;(rows.get(car) ?? rows.set(car, []).get(car)!).push(i)
  }
  // Una "vuelta" mucho más corta que lo normal no es un paso por meta (p. ej. el registro residual de un coche
  // retirado): no cuenta como vuelta completada.
  const durations = Array.from({ length: v.rows }, (_, i) => v.lapMs[i]!).filter((ms) => ms > 0).sort((a, b) => a - b)
  const minLapMs = durations.length ? 0.5 * durations[durations.length >> 1]! : 0
  const crossOf = (i: number) => (v.endMs[i]! > 0 && v.endMs[i]! - v.startMs[i]! >= minLapMs ? v.endMs[i]! : -1)
  const deletedFrom = deletionTimes(v, raceControl)
  const segments = quali ? qualifyingSegments(raceControl) : { starts: [-Infinity], ends: [Infinity] }
  // Tanda de una vuelta: la de su inicio (una vuelta lanzada antes de la bandera a cuadros cuenta en esa tanda).
  const segmentOf = (i: number) => {
    const end = v.endMs[i]!
    const ms = v.lapMs[i]!
    const start = v.startMs[i]! >= 0 ? v.startMs[i]! : end > 0 && ms > 0 ? end - ms : -1
    if (start < 0) return quali ? -1 : 0
    for (let k = 0; k < segments.starts.length; k++) {
      if (start >= segments.starts[k]! && start < segments.ends[k]!) return k
    }
    return -1
  }
  const kindOf = (i: number) => {
    const m = mask[i]!
    let k = 0
    if (v.pitInMs[i]! >= 0) k |= LAP_PIT_IN
    if (v.pitOutMs[i]! >= 0) k |= LAP_PIT_OUT
    if (m & MASK_YELLOW) k |= LAP_YELLOW
    if (m & MASK_SC) k |= LAP_SC
    if (m & MASK_VSC) k |= LAP_VSC
    if (m & MASK_RED) k |= LAP_RED
    if (v.lap[i] === 1) k |= LAP_FIRST
    if (!(v.lapMs[i]! > 0)) k |= LAP_NO_TIME
    if (crossOf(i) < 0) k |= LAP_NO_LINE
    return k
  }

  const cars = new Map<string, CarLaps>()
  for (const [car, idx] of rows) {
    idx.sort((a, b) => v.lap[a]! - v.lap[b]!)
    const f64 = (col: ArrayLike<number>) => Float64Array.from(idx, (i) => col[i]!)
    const u8 = (col: ArrayLike<number>) => Uint8Array.from(idx, (i) => col[i]!)
    cars.set(car, {
      car,
      row: Int32Array.from(idx),
      lap: Int32Array.from(idx, (i) => v.lap[i]!),
      startMs: f64(v.startMs),
      endMs: f64(v.endMs),
      crossMs: Float64Array.from(idx, crossOf),
      lapMs: f64(v.lapMs),
      s1Ms: f64(s1),
      s2Ms: f64(s2),
      s3Ms: f64(s3),
      compound: u8(v.compound),
      tyreLife: u8(tyreLife),
      fresh: u8(fresh),
      stint: u8(stint),
      pitInMs: f64(v.pitInMs),
      pitOutMs: f64(v.pitOutMs),
      position: u8(v.position),
      deletedFrom: Float64Array.from(idx, (i) => deletedFrom[i]!),
      segment: Int8Array.from(idx, segmentOf),
      kind: Uint16Array.from(idx, kindOf),
    })
  }
  return { type, race, quali, cars, segments, minLapMs, trackStatusKnown }
}

/**
 * Clasificación de la vuelta k en el instante t: la fija más `LAP_DELETED` si ya está anulada en t (con
 * t = Infinity, las que acabaron anuladas).
 */
export function lapFlagsAt(laps: CarLaps, k: number, t: number): number {
  const from = laps.deletedFrom[k]!
  return laps.kind[k]! | (from !== Infinity && from <= t ? LAP_DELETED : 0)
}

/** ¿Tiene la vuelta k alguno de los bits de `mask` en el instante t? */
export function lapIs(laps: CarLaps, k: number, mask: number, t: number): boolean {
  return (lapFlagsAt(laps, k, t) & mask) !== 0
}

/** Índice de la vuelta con ese número, o −1. */
export function lapIndex(laps: CarLaps, lap: number): number {
  let lo = 0
  let hi = laps.lap.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const x = laps.lap[mid]!
    if (x === lap) {
      // La primera fila con ese número (si hubiera repetidas).
      let k = mid
      while (k > 0 && laps.lap[k - 1] === lap) k--
      return k
    }
    if (x < lap) lo = mid + 1
    else hi = mid - 1
  }
  return -1
}

/** Vuelta en curso en t: la última (por número) que ya había empezado (`startMs` conocido y ≤ t), o −1. */
export function currentLapIndex(laps: CarLaps, t: number): number {
  let k = -1
  for (let j = 0; j < laps.lap.length; j++) if (laps.startMs[j]! >= 0 && laps.startMs[j]! <= t) k = j
  return k
}

/** Última vuelta (por número) con paso por meta real en t (`crossMs` ≤ t), o −1. */
export function lastCompletedIndex(laps: CarLaps, t: number): number {
  let k = -1
  for (let j = 0; j < laps.lap.length; j++) if (laps.crossMs[j]! > 0 && laps.crossMs[j]! <= t) k = j
  return k
}
