/**
 * Trazas por distancia de una vuelta (ítem 1, D31; TS puro, sin Vue ni three): velocidad, acelerador y freno del
 * coche frente a la distancia recorrida dentro de la vuelta, para comparar a dos pilotos en el mismo punto de la pista.
 *
 * Los valores son las muestras crudas de la telemetría (nada se interpola ni se suaviza): acelerador 255 → sin dato
 * (NaN, y la línea se corta), freno de encendido/apagado (0/1). Lo único que sale del modelo es dónde se coloca cada
 * muestra en el eje de distancia: la distancia del replay (posición GPS proyectada e interpolada, ±8 m) en el instante
 * de la muestra. Sin posición en ese instante (hueco), la muestra no entra y la línea se corta; también se corta
 * entre dos muestras separadas más de `MAX_SAMPLE_AGE_MS` (2 s), como el resto de la telemetría.
 *
 * Una traza se calcula una vez por vuelta (cuando cambia la vuelta o la referencia); la vuelta en curso de A se
 * recorta al instante actual con `traceCount` (sin futuro).
 */
import { type CarSeries, MAX_SAMPLE_AGE_MS } from '../telemetry/telemetry'
import { type CarTrack, newCarSample } from '../replay/motion'
import type { LapAnchor } from './delta'
import { sAt } from './distance'

export interface LapTrace {
  /** Distancia dentro de la vuelta (m) de cada muestra: no decrece y está en [0, L). */
  d: Float64Array
  /** Instante de cada muestra (ms de sesión), creciente. */
  t: Float64Array
  /** km/h. */
  speed: Float32Array
  /** % (0–100); NaN sin dato (código 255). */
  throttle: Float32Array
  /** 0/1 (el canal no da la presión). */
  brake: Uint8Array
  /** 1 si la línea se corta antes de esta muestra (hueco de posición o de telemetría de más de 2 s). */
  cut: Uint8Array
}

const EMPTY: LapTrace = {
  d: new Float64Array(0),
  t: new Float64Array(0),
  speed: new Float32Array(0),
  throttle: new Float32Array(0),
  brake: new Uint8Array(0),
  cut: new Uint8Array(0),
}

/** Primer índice con t[i] ≥ x. */
function lowerBound(t: ArrayLike<number>, x: number): number {
  let lo = 0
  let hi = t.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (t[mid]! < x) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * Traza de la vuelta que empezó en `start` y acaba en `endMs` (ms de sesión, excluido; NaN o Infinity si sigue
 * abierta), con las muestras de telemetría `series` del coche y su pista de movimiento `track`. `lengthM`: longitud
 * de la vuelta (m); lo que caiga fuera de [0, L) no entra.
 */
export function lapTrace(
  series: CarSeries | null,
  track: CarTrack,
  start: LapAnchor,
  endMs: number,
  lengthM: number,
): LapTrace {
  if (!series || !Number.isFinite(start.s)) return EMPTY
  const end = Number.isNaN(endMs) ? Infinity : endMs
  const from = lowerBound(series.t, start.t)
  const to = end === Infinity ? series.t.length : lowerBound(series.t, end)
  const n = Math.max(0, to - from)
  const d = new Float64Array(n)
  const t = new Float64Array(n)
  const speed = new Float32Array(n)
  const throttle = new Float32Array(n)
  const brake = new Uint8Array(n)
  const cut = new Uint8Array(n)
  const smp = newCarSample()
  let k = 0
  let pending = false
  let lastT = Number.NaN
  let lastD = -Infinity
  for (let i = from; i < to; i++) {
    const ti = series.t[i]!
    const s = sAt(track, ti, smp)
    const di = s === null ? Number.NaN : s - start.s
    if (!(di >= 0 && di < lengthM) || di < lastD) {
      pending = true
      continue
    }
    d[k] = di
    t[k] = ti
    speed[k] = series.speed[i]!
    const th = series.throttle[i]!
    throttle[k] = th === 255 ? Number.NaN : th
    brake[k] = series.brake[i]! > 0 ? 1 : 0
    cut[k] = k > 0 && (pending || ti - lastT > MAX_SAMPLE_AGE_MS) ? 1 : 0
    pending = false
    lastT = ti
    lastD = di
    k++
  }
  return {
    d: d.subarray(0, k),
    t: t.subarray(0, k),
    speed: speed.subarray(0, k),
    throttle: throttle.subarray(0, k),
    brake: brake.subarray(0, k),
    cut: cut.subarray(0, k),
  }
}

/** Cuántas muestras de la traza había en `now` (t ≤ now): lo que se dibuja de una vuelta en curso. */
export function traceCount(trace: LapTrace, now: number): number {
  return lowerBound(trace.t, now + 1e-6)
}

/**
 * Valores de una serie en el eje común: número, `null` (corte: la línea se interrumpe; también sin dato) o
 * `undefined` (en ese punto solo hay muestra del otro coche: la línea pasa por encima). Es el convenio de uPlot.
 */
export type TraceValues = (number | null | undefined)[]

export interface AlignedTraces {
  /** Distancia (m), no decreciente. */
  x: number[]
  /** [A, B] de cada canal. */
  speed: [TraceValues, TraceValues]
  throttle: [TraceValues, TraceValues]
  brake: [TraceValues, TraceValues]
}

interface Points {
  x: number[]
  speed: (number | null)[]
  throttle: (number | null)[]
  brake: (number | null)[]
}

/** Puntos de una traza (sus `count` primeras muestras), con un punto nulo en medio de cada corte. */
function points(trace: LapTrace | null, count: number): Points {
  const out: Points = { x: [], speed: [], throttle: [], brake: [] }
  if (!trace) return out
  const n = Math.min(count, trace.d.length)
  for (let i = 0; i < n; i++) {
    if (trace.cut[i]) {
      out.x.push((trace.d[i - 1]! + trace.d[i]!) / 2)
      out.speed.push(null)
      out.throttle.push(null)
      out.brake.push(null)
    }
    const th = trace.throttle[i]!
    out.x.push(trace.d[i]!)
    out.speed.push(trace.speed[i]!)
    out.throttle.push(Number.isNaN(th) ? null : th)
    out.brake.push(trace.brake[i]!)
  }
  return out
}

/**
 * Une las trazas de A (sus `aCount` primeras muestras) y de B en un eje de distancia común: uPlot comparte el eje x
 * entre series. Cada serie lleva sus valores en sus distancias y `undefined` en las del otro coche.
 */
export function alignTraces(a: LapTrace | null, aCount: number, b: LapTrace | null, bCount: number): AlignedTraces {
  const pa = points(a, aCount)
  const pb = points(b, bCount)
  const out: AlignedTraces = { x: [], speed: [[], []], throttle: [[], []], brake: [[], []] }
  let i = 0
  let j = 0
  const push = (x: number, side: 0 | 1, p: Points, k: number) => {
    out.x.push(x)
    const other = side === 0 ? 1 : 0
    out.speed[side].push(p.speed[k])
    out.throttle[side].push(p.throttle[k])
    out.brake[side].push(p.brake[k])
    out.speed[other].push(undefined)
    out.throttle[other].push(undefined)
    out.brake[other].push(undefined)
  }
  while (i < pa.x.length || j < pb.x.length) {
    if (j >= pb.x.length || (i < pa.x.length && pa.x[i]! <= pb.x[j]!)) {
      push(pa.x[i]!, 0, pa, i)
      i++
    } else {
      push(pb.x[j]!, 1, pb, j)
      j++
    }
  }
  return out
}
