/**
 * Distancia ↔ tiempo de un coche sobre su pista de movimiento (TS puro, sin Vue ni three).
 *
 * `s` es la distancia acumulada (m, en planta) de la línea central, la misma que mueve los coches: en el pit
 * lane, su equivalente en pista. `sAt` es exactamente lo que dibuja el replay (`sampleCar`) y `timeAtS` es su
 * inversa: el primer instante en el que el coche alcanza esa distancia.
 *
 * Solo se interpola donde el replay interpola: dentro de un segmento con dato (Hermite monótona) y en la
 * transición corta pista↔pit (recta). Dentro de un hueco (sin señal más de 2 s, o muestras «sin dato») no se
 * sabe cuándo pasó el coche por esa distancia: null. Fuera de los datos del coche, también null.
 *
 * Se apoya en que la `s` de las muestras con dato no decrece (el pipeline lo garantiza: lo que la monotonía
 * movería más de 5 m queda como «sin dato»). Si no fuera así, el resultado sigue siendo un instante en el que
 * el coche estaba en esa distancia, pero puede no ser el primero.
 */
import { SEGMENT_GAP_MS } from '../interp/hermite'
import { type CarSample, type CarTrack, newCarSample, PATH_NODATA, sampleCar } from '../replay/motion'

/** Tramos interpolables de una pista, en orden de tiempo (y de s). */
interface Pieces {
  /** Primera y última muestra de cada tramo (incluidas; al menos dos). */
  from: Int32Array
  to: Int32Array
  /** 1: transición pista↔pit (recta entre dos muestras); 0: Hermite dentro de un segmento. */
  linear: Uint8Array
  /** Máximo acumulado de s hasta el final de cada tramo: no decrece, para la búsqueda binaria. */
  maxS: Float64Array
}

const cache = new WeakMap<CarTrack, Pieces>()

function buildPieces(track: CarTrack): Pieces {
  const { t, s, path, seg } = track
  const n = t.length
  const from: number[] = []
  const to: number[] = []
  const linear: number[] = []
  let i = 0
  while (i < n - 1) {
    if (seg[i] === seg[i + 1]) {
      // Tramo Hermite: todas las muestras seguidas del mismo segmento (con dato).
      let j = i + 1
      while (j + 1 < n && seg[j + 1] === seg[i]) j++
      if (path[i] !== PATH_NODATA) {
        from.push(i)
        to.push(j)
        linear.push(0)
      }
      i = j
    } else {
      // Cambio de segmento: transición en recta solo si es corta y ninguna de las dos muestras es «sin dato».
      if (t[i + 1]! - t[i]! <= SEGMENT_GAP_MS && path[i] !== PATH_NODATA && path[i + 1] !== PATH_NODATA) {
        from.push(i)
        to.push(i + 1)
        linear.push(1)
      }
      i++
    }
  }
  const maxS = new Float64Array(from.length)
  let m = -Infinity
  for (let p = 0; p < from.length; p++) {
    for (let k = from[p]!; k <= to[p]!; k++) m = Math.max(m, s[k]!)
    maxS[p] = m
  }
  return { from: Int32Array.from(from), to: Int32Array.from(to), linear: Uint8Array.from(linear), maxS }
}

function piecesOf(track: CarTrack): Pieces {
  let p = cache.get(track)
  if (!p) {
    p = buildPieces(track)
    cache.set(track, p)
  }
  return p
}

/** s de la Hermite entre las muestras i e i+1 en la fracción u, y su derivada respecto a u. */
function hermite(track: CarTrack, i: number, u: number, out: { s: number; dsdu: number }): void {
  const h = track.t[i + 1]! - track.t[i]!
  const s0 = track.s[i]!
  const s1 = track.s[i + 1]!
  const m0 = track.m[i]! * h
  const m1 = track.m[i + 1]! * h
  const u2 = u * u
  const u3 = u2 * u
  out.s = (2 * u3 - 3 * u2 + 1) * s0 + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * s1 + (u3 - u2) * m1
  out.dsdu = (6 * u2 - 6 * u) * s0 + (3 * u2 - 4 * u + 1) * m0 + (-6 * u2 + 6 * u) * s1 + (3 * u2 - 2 * u) * m1
}

const tmp = { s: 0, dsdu: 0 }

/** Instante en el que la Hermite entre i e i+1 (monótona) vale `target` (s[i] < target ≤ s[i+1]). */
function invertHermite(track: CarTrack, i: number, target: number): number {
  const t0 = track.t[i]!
  const h = track.t[i + 1]! - t0
  const s0 = track.s[i]!
  const s1 = track.s[i + 1]!
  if (!(h > 0) || !(s1 > s0)) return track.t[i + 1]!
  // Newton con salvaguarda de bisección: s(u) no decrece en [0, 1].
  let lo = 0
  let hi = 1
  let u = (target - s0) / (s1 - s0)
  for (let it = 0; it < 60; it++) {
    hermite(track, i, u, tmp)
    const f = tmp.s - target
    if (Math.abs(f) < 1e-9) break
    if (f > 0) hi = u
    else lo = u
    if (hi - lo < 1e-12) break
    let next = tmp.dsdu > 0 ? u - f / tmp.dsdu : NaN
    if (!(next > lo && next < hi)) next = 0.5 * (lo + hi)
    u = next
  }
  return t0 + u * h
}

/**
 * Primer instante (ms de sesión) en el que el coche alcanza la distancia acumulada `s` (m), o null si ese tramo
 * cae en un hueco sin dato o fuera de los datos del coche.
 */
export function timeAtS(track: CarTrack, s: number): number | null {
  if (!Number.isFinite(s)) return null
  const P = piecesOf(track)
  const count = P.from.length
  // Primer tramo cuyo máximo acumulado llega a s.
  let lo = 0
  let hi = count
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (P.maxS[mid]! >= s) hi = mid
    else lo = mid + 1
  }
  if (lo === count) return null
  const a = P.from[lo]!
  const b = P.to[lo]!
  const S = track.s
  const T = track.t
  if (S[a]! > s) return null // antes de este tramo hay un hueco: el coche pasó por s sin dato
  if (S[a] === s) return T[a]!
  // Primera muestra del tramo con s ≥ objetivo (búsqueda binaria; s no decrece dentro del tramo).
  let l = a + 1
  let r = b
  while (l < r) {
    const mid = (l + r) >> 1
    if (S[mid]! >= s) r = mid
    else l = mid + 1
  }
  let j = l
  if (!(S[j]! >= s && S[j - 1]! < s)) {
    // Dato no monótono dentro del tramo: recorrido lineal.
    j = a + 1
    while (j <= b && !(S[j]! >= s && S[j - 1]! < s)) j++
    if (j > b) return null
  }
  const i = j - 1
  if (P.linear[lo]) return T[i]! + ((s - S[i]!) / (S[j]! - S[i]!)) * (T[j]! - T[i]!)
  return invertHermite(track, i, s)
}

const scratch = newCarSample()

/** Distancia acumulada (m) del coche en t, la misma que dibuja el replay, o null si no hay dato en t. */
export function sAt(track: CarTrack, t: number, sample: CarSample = scratch): number | null {
  const smp = sampleCar(track, t, sample)
  return smp.state === 'hidden' ? null : smp.s
}
