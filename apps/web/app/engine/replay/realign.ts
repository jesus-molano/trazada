/**
 * Hora de las posiciones reajustada por consenso entre coches (D52). Las horas de Position.z llegan desplazadas hasta
 * ±145 ms, casi lo mismo para todos los coches de un mismo envío; la Hermite pasa exactamente por cada (t, s), así que la
 * velocidad dibujada oscilaba un ±50–80 % a 3–4 Hz («frenazos y acelerones» a ×1) aunque cada frame se pinte con la
 * hora exacta. Aquí se estima ese desplazamiento con la velocidad de CarData y se corrige solo `t`, nunca `s`:
 *
 * 1. Para cada coche, D(t) = integral trapezoidal de su velocidad medida.
 * 2. En las muestras en pista, con vecinos dibujables a los dos lados (mismo segmento: huecos ≤ 2 s) y a más de
 *    80 km/h: r = s − D(t) y ε = (r − mediana de r en i±6, sin i) / v (ms): lo que la muestra va por delante o por
 *    detrás de lo que dice la velocidad de sus vecinas. D(t) solo tiene que ser fiable en esos ±1,5 s.
 * 3. Para cada instante del feed (la misma `t` en varios coches), δ = mediana de ε entre coches (al menos
 *    MIN_CARS); si |δ| > MAX_SHIFT_MS no es el desfase del envío y no se toca. Se aplica a todas las muestras de ese
 *    instante, de todos los coches (también en pit o sin velocidad).
 * 4. Si con δ la hora de algún coche no queda estrictamente creciente, con MIN_GAP_MS o más entre muestras (o lo que
 *    hubiera, si ya era menos), esos δ pasan a 0.
 *
 * TS puro; se ejecuta en el Web Worker de carga, antes de las tangentes (data/load-session.ts), sobre la tabla `pos`
 * ya decodificada (muta su columna `t` en sitio).
 */
import type { DecodedTrzb } from '@trazada/schema'
import { segmentStarts } from '../interp/hermite'

/** Muestras a cada lado para la referencia local de r. */
export const REALIGN_NEIGHBOURS = 6
/** Por debajo de esta velocidad (km/h) un error de distancia da un error de hora demasiado grande. */
export const REALIGN_MIN_KMH = 80
/** Desplazamiento máximo creíble del envío (ms). */
export const REALIGN_MAX_SHIFT_MS = 200
/** Separación mínima entre muestras de un coche tras el reajuste (ms). */
export const REALIGN_MIN_GAP_MS = 20
/** Coches que tienen que opinar en un instante para moverlo. */
export const REALIGN_MIN_CARS = 3
/** Pasadas de la estimación (cada una parte de las horas ya corregidas). */
export const REALIGN_PASSES = 2
/** Vecinas válidas que hacen falta para la referencia local de una muestra. */
const MIN_NEIGHBOURS = 4
/** Mismos valores que en engine/replay/motion.ts (sin importarlo: motion no depende de esto ni al revés). */
const PATH_TRACK = 0

export interface RealignStats {
  /** Instantes del feed con opinión de al menos MIN_CARS coches. */
  readonly instants: number
  /** Instantes movidos (δ ≠ 0). */
  readonly shifted: number
  /** Instantes con δ descartado: fuera de ±MAX_SHIFT_MS o porque la hora de algún coche dejaba de crecer. */
  readonly dropped: number
  /** Mayor |δ| aplicado (ms). */
  readonly maxAbsMs: number
}

const EMPTY: RealignStats = { instants: 0, shifted: 0, dropped: 0, maxAbsMs: 0 }

/** Mediana de `xs[0..n)` (pocas muestras: ordenación por inserción en sitio, sin reservar memoria). */
function smallMedian(xs: Float64Array, n: number): number {
  for (let i = 1; i < n; i++) {
    const x = xs[i]!
    let j = i - 1
    while (j >= 0 && xs[j]! > x) {
      xs[j + 1] = xs[j]!
      j--
    }
    xs[j + 1] = x
  }
  return n % 2 ? xs[n >> 1]! : (xs[n / 2 - 1]! + xs[n / 2]!) / 2
}

/**
 * Velocidad (m/ms) y distancia integrada D (m) de la telemetría de un coche en los instantes `times` (crecientes). Fuera
 * del tramo con telemetría, v = NaN.
 */
function integrate(ct: ArrayLike<number>, cv: ArrayLike<number>, times: ArrayLike<number>, v: Float64Array, d: Float64Array) {
  const n = ct.length
  const cum = new Float64Array(n)
  for (let j = 1; j < n; j++) {
    cum[j] = cum[j - 1]! + ((ct[j]! - ct[j - 1]!) * (cv[j]! + cv[j - 1]!)) / 2 / 3600
  }
  let j = 0
  for (let i = 0; i < times.length; i++) {
    const x = times[i]!
    if (n < 2 || x < ct[0]! || x > ct[n - 1]!) {
      v[i] = Number.NaN
      continue
    }
    while (j < n - 2 && ct[j + 1]! < x) j++
    const t0 = ct[j]!
    const t1 = ct[j + 1]!
    const f = t1 > t0 ? (x - t0) / (t1 - t0) : 0
    const vx = cv[j]! + f * (cv[j + 1]! - cv[j]!)
    // km/h → m/ms: / 3600; la integral de t0 a x del tramo lineal.
    v[i] = vx / 3600
    d[i] = cum[j]! + ((x - t0) * (cv[j]! + vx)) / 2 / 3600
  }
}

/** Reajusta en sitio la columna `t` de `pos` (ms de sesión). Sin telemetría de coches, no hace nada. */
export function realignPositionTimes(motion: DecodedTrzb, car: DecodedTrzb | null): RealignStats {
  const cars = motion.tables.cars
  const pos = motion.tables.pos
  const telCars = car?.tables.cars
  const tel = car?.tables.tel
  if (!cars || !pos || !telCars || !tel) return EMPTY
  const T = pos.columns.t as Float64Array
  const S = pos.columns.s!
  const P = pos.columns.path!
  const telT = tel.columns.t!
  const telV = tel.columns.speed!
  const telIndex = new Map<number, number>()
  for (let k = 0; k < telCars.rows; k++) telIndex.set(telCars.columns.car![k]!, k)
  const N = T.length

  // Instantes del feed: la misma hora publicada en varios coches. Cada muestra, con el id entero de su instante.
  const ids = new Int32Array(N)
  const byTime = new Map<number, number>()
  for (let i = 0; i < N; i++) {
    let id = byTime.get(T[i]!)
    if (id === undefined) {
      id = byTime.size
      byTime.set(T[i]!, id)
    }
    ids[i] = id
  }
  const M = byTime.size

  const minV = REALIGN_MIN_KMH / 3600
  // δ acumulado de cada instante. Cada pasada estima con las horas ya corregidas: la referencia de una muestra (sus
  // vecinas) lleva el desfase de sus propios envíos, y con una sola pasada ese sesgo, común a todos los coches, se
  // quedaba (unos 25 ms); con dos, unos pocos ms (más pasadas no mejoran nada con datos reales y cuestan ~120 ms cada
  // una en una carrera).
  const total = new Float64Array(M)
  const rejected = new Uint8Array(M)
  const cur = new Float64Array(N)
  const eps = new Float64Array(N)
  const has = new Uint8Array(N)
  const counts = new Int32Array(M + 1)
  const grouped = new Float64Array(N)
  const near = new Float64Array(2 * REALIGN_NEIGHBOURS)
  let instants = 0
  for (let pass = 0; pass < REALIGN_PASSES; pass++) {
    for (let i = 0; i < N; i++) cur[i] = T[i]! + total[ids[i]!]!
    has.fill(0)
    for (let c = 0; c < cars.rows; c++) {
      const k = telIndex.get(cars.columns.car![c]!)
      if (k === undefined) continue
      const start = cars.columns.start![c]!
      const count = cars.columns.count![c]!
      const keys = T.subarray(start, start + count)
      const ts = cur.subarray(start, start + count)
      const ss = S.subarray(start, start + count)
      const ps = P.subarray(start, start + count)
      const ts0 = telCars.columns.start![k]!
      const tn = telCars.columns.count![k]!
      const v = new Float64Array(count)
      const d = new Float64Array(count)
      integrate(telT.subarray(ts0, ts0 + tn), telV.subarray(ts0, ts0 + tn), ts, v, d)

      // Segmento de cada muestra y si vale como dato (pista, interior de su segmento, deprisa, con telemetría).
      const seg = new Int32Array(count)
      const starts = segmentStarts(keys, ps)
      for (let g = 0; g < starts.length; g++) {
        const to = g + 1 < starts.length ? starts[g + 1]! : count
        seg.fill(starts[g]!, starts[g]!, to)
      }
      const ok = new Uint8Array(count)
      const r = new Float64Array(count)
      for (let i = 1; i < count - 1; i++) {
        if (ps[i] !== PATH_TRACK || seg[i - 1] !== seg[i] || seg[i + 1] !== seg[i] || !(v[i]! >= minV)) continue
        ok[i] = 1
        r[i] = ss[i]! - d[i]!
      }
      for (let i = 1; i < count - 1; i++) {
        if (!ok[i] || rejected[ids[start + i]!]) continue
        let n = 0
        const lo = Math.max(0, i - REALIGN_NEIGHBOURS)
        const hi = Math.min(count - 1, i + REALIGN_NEIGHBOURS)
        for (let j = lo; j <= hi; j++) if (j !== i && ok[j] && seg[j] === seg[i]) near[n++] = r[j]!
        if (n < MIN_NEIGHBOURS) continue
        eps[start + i] = (r[i]! - smallMedian(near, n)) / v[i]!
        has[start + i] = 1
      }
    }
    // Opiniones agrupadas por instante (cada muestra da como mucho una).
    counts.fill(0)
    for (let i = 0; i < N; i++) if (has[i]) counts[ids[i]! + 1]!++
    for (let m = 0; m < M; m++) counts[m + 1]! += counts[m]!
    const fill = counts.slice(0, M)
    for (let i = 0; i < N; i++) if (has[i]) grouped[fill[ids[i]!]!++] = eps[i]!
    // δ de esta pasada en cada instante con opinión suficiente; el que se va de ±MAX_SHIFT_MS no es el desfase del
    // envío: se descarta y deja de moverse.
    instants = 0
    let moved = false
    for (let m = 0; m < M; m++) {
      const from = counts[m]!
      const n = counts[m + 1]! - from
      if (n < REALIGN_MIN_CARS) continue
      instants++
      const list = grouped.subarray(from, from + n).sort()
      const delta = n % 2 ? list[n >> 1]! : (list[n / 2 - 1]! + list[n / 2]!) / 2
      if (Math.abs(delta) < 0.5) continue
      const sum = total[m]! + delta
      if (Math.abs(sum) > REALIGN_MAX_SHIFT_MS) {
        rejected[m] = 1
        total[m] = 0
      } else total[m] = sum
      moved = true
    }
    if (!moved) break
  }
  const shift = new Float64Array(M)
  let dropped = 0
  for (let m = 0; m < M; m++) {
    if (rejected[m]) dropped++
    else shift[m] = Math.round(total[m]!)
  }

  // Ningún coche hacia atrás ni con muestras pegadas: los δ que lo provocan, a 0 (hasta que no quede ninguno).
  for (let changed = true; changed; ) {
    changed = false
    for (let c = 0; c < cars.rows; c++) {
      const start = cars.columns.start![c]!
      const end = start + cars.columns.count![c]!
      for (let i = start; i < end - 1; i++) {
        const ia = ids[i]!
        const ib = ids[i + 1]!
        const da = shift[ia]!
        const db = shift[ib]!
        if (da === 0 && db === 0) continue
        const gap = T[i + 1]! - T[i]!
        const next = gap + db - da
        if (next >= Math.min(REALIGN_MIN_GAP_MS, gap) && (next > 0 || gap <= 0)) continue
        if (da !== 0) dropped++
        if (db !== 0 && ib !== ia) dropped++
        shift[ia] = 0
        shift[ib] = 0
        changed = true
      }
    }
  }

  let shifted = 0
  let maxAbsMs = 0
  for (let m = 0; m < M; m++) {
    if (shift[m] === 0) continue
    shifted++
    maxAbsMs = Math.max(maxAbsMs, Math.abs(shift[m]!))
  }
  for (let i = 0; i < N; i++) T[i] = T[i]! + shift[ids[i]!]!
  return { instants, shifted, dropped, maxAbsMs }
}
