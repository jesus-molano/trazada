/**
 * Pistas de movimiento por coche (layout `motion`): vistas sin copia de t, s y path, más las tangentes
 * de la Hermite (calculadas en el Web Worker) y el segmento de cada muestra.
 */
import type { DecodedTrzb } from '@trazada/schema'
import { column } from '../data/columns'
import { hermiteAt, SEGMENT_GAP_MS, segmentStarts, segmentTangents } from '../interp/hermite'

export const PATH_TRACK = 0
export const PATH_PIT = 1
export const PATH_NODATA = 2

export type TangentMode = 'pchip' | 'speed'

export interface CarTrack {
  car: string
  t: Float64Array
  s: Float64Array
  path: Uint8Array
  m: Float64Array
  /** Índice de la primera muestra del segmento al que pertenece cada muestra. */
  seg: Int32Array
}

/** Velocidad medida (km/h → m/ms) interpolada linealmente en los instantes de posición de un coche. */
function speedAt(car: DecodedTrzb, carNumber: number, times: Float64Array): Float64Array | undefined {
  const cars = car.tables.cars!
  const idx = Array.from(cars.columns.car!).indexOf(carNumber)
  if (idx < 0) return undefined
  const start = cars.columns.start![idx]!
  const count = cars.columns.count![idx]!
  if (count < 2) return undefined
  const ct = column(car, 'tel', 't').subarray(start, start + count) as Float64Array
  const cv = column(car, 'tel', 'speed').subarray(start, start + count)
  const out = new Float64Array(times.length)
  let j = 0
  for (let i = 0; i < times.length; i++) {
    const x = times[i]!
    while (j < count - 2 && ct[j + 1]! < x) j++
    const t0 = ct[j]!
    const t1 = ct[j + 1]!
    const f = t1 > t0 ? Math.min(1, Math.max(0, (x - t0) / (t1 - t0))) : 0
    out[i] = ((cv[j]! + f * (cv[j + 1]! - cv[j]!)) / 3.6) * 1e-3
  }
  return out
}

/** Tangentes de toda la tabla `pos` (alineadas con sus filas). Se calcula en el Web Worker. */
export function computeTangents(motion: DecodedTrzb, car: DecodedTrzb | null, mode: TangentMode): Float64Array {
  const cars = motion.tables.cars!
  const t = column(motion, 'pos', 't') as Float64Array
  const s = column(motion, 'pos', 's') as Float64Array
  const path = column(motion, 'pos', 'path')
  const out = new Float64Array(t.length)
  for (let c = 0; c < cars.rows; c++) {
    const start = cars.columns.start![c]!
    const count = cars.columns.count![c]!
    const ts = t.subarray(start, start + count)
    const ss = s.subarray(start, start + count)
    const ps = path.subarray(start, start + count)
    const ms = out.subarray(start, start + count)
    const speed = mode === 'speed' && car ? speedAt(car, cars.columns.car![c]!, ts) : undefined
    const starts = segmentStarts(ts, ps)
    for (let k = 0; k < starts.length; k++) {
      const from = starts[k]!
      const to = k + 1 < starts.length ? starts[k + 1]! : count
      if (ps[from] === PATH_NODATA) continue
      segmentTangents(ts, ss, from, to, ms, speed)
    }
  }
  return out
}

export function carTracks(motion: DecodedTrzb, tangents: Float64Array): CarTrack[] {
  const cars = motion.tables.cars!
  const t = column(motion, 'pos', 't') as Float64Array
  const s = column(motion, 'pos', 's') as Float64Array
  const path = column(motion, 'pos', 'path') as Uint8Array
  const out: CarTrack[] = []
  for (let c = 0; c < cars.rows; c++) {
    const start = cars.columns.start![c]!
    const count = cars.columns.count![c]!
    const ts = t.subarray(start, start + count)
    const ps = path.subarray(start, start + count)
    const seg = new Int32Array(count)
    let current = 0
    for (let i = 0; i < count; i++) {
      if (i === 0 || ts[i]! - ts[i - 1]! > SEGMENT_GAP_MS || ps[i] !== ps[i - 1]) current = i
      seg[i] = current
    }
    out.push({
      car: String(cars.columns.car![c]),
      t: ts,
      s: s.subarray(start, start + count),
      path: ps,
      m: tangents.subarray(start, start + count),
      seg,
    })
  }
  return out
}

export interface CarSample {
  /** 'hidden': sin dato en t (fuera de rango, hueco > 2 s o garaje). 'transition': cambio pista↔pit. */
  state: 'visible' | 'transition' | 'hidden'
  path: number
  s: number
  /** ds/dt en m/s. */
  speed: number
  /** Solo en transición: fracción [0, 1] entre la última muestra (i) y la siguiente (i+1). */
  f: number
  i: number
}

export function newCarSample(): CarSample {
  return { state: 'hidden', path: PATH_NODATA, s: 0, speed: 0, f: 0, i: -1 }
}

const tmp = { s: 0, v: 0 }

/** Índice i con t[i] ≤ x < t[i+1], partiendo de una pista (coherencia temporal) o −1 / n−1 fuera de rango. */
export function findInterval(t: Float64Array, x: number, hint: number): number {
  const n = t.length
  if (n === 0 || x < t[0]!) return -1
  if (x >= t[n - 1]!) return n - 1
  const i = hint >= 0 && hint < n ? hint : 0
  if (t[i]! <= x && x < t[i + 1]!) return i
  if (i + 2 < n && t[i + 1]! <= x && x < t[i + 2]!) return i + 1
  let lo = 0
  let hi = n - 1
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1
    if (t[mid]! <= x) lo = mid
    else hi = mid
  }
  return lo
}

/** Estado de un coche en el instante x (ms de sesión). */
export function sampleCar(track: CarTrack, x: number, out: CarSample): CarSample {
  const n = track.t.length
  const i = findInterval(track.t, x, out.i)
  out.i = i
  if (i < 0 || (i === n - 1 && x > track.t[n - 1]!)) {
    out.state = 'hidden'
    return out
  }
  if (i === n - 1) {
    out.state = track.path[i] === PATH_NODATA ? 'hidden' : 'visible'
    out.path = track.path[i]!
    out.s = track.s[i]!
    out.speed = 0
    return out
  }
  const pa = track.path[i]!
  const pb = track.path[i + 1]!
  if (track.seg[i] === track.seg[i + 1]) {
    out.path = pa
    if (pa === PATH_NODATA) {
      out.state = 'hidden'
      return out
    }
    hermiteAt(track.t, track.s, track.m, i, x, tmp)
    out.state = 'visible'
    out.s = tmp.s
    out.speed = tmp.v * 1000
    return out
  }
  // Entre segmentos: transición corta entre pista y pit (se dibuja en línea recta), o sin señal.
  const gap = track.t[i + 1]! - track.t[i]!
  if (gap <= SEGMENT_GAP_MS && pa !== PATH_NODATA && pb !== PATH_NODATA) {
    out.state = 'transition'
    out.path = pa
    out.f = (x - track.t[i]!) / gap
    out.s = track.s[i]! + out.f * (track.s[i + 1]! - track.s[i]!)
    out.speed = ((track.s[i + 1]! - track.s[i]!) / gap) * 1000
    return out
  }
  out.state = 'hidden'
  return out
}
