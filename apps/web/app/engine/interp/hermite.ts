/**
 * Hermite cúbica monótona por segmentos (limitador de Fritsch–Carlson) para s(t) de cada coche.
 *
 * - Un segmento se corta cuando hay un hueco > SEGMENT_GAP_MS o cambia el `path` (pista/pit/sin dato).
 * - Tangentes: diferencias finitas (PCHIP) o la velocidad medida, siempre pasadas por el limitador para
 *   que s(t) no decrezca nunca entre muestras.
 * - En los extremos de un segmento, la tangente es la secante del tramo (sin extrapolar).
 */
export const SEGMENT_GAP_MS = 2000

/** Inicio de cada segmento: índice de la primera muestra (relativo al coche). */
export function segmentStarts(t: ArrayLike<number>, path: ArrayLike<number>, gapMs = SEGMENT_GAP_MS): number[] {
  const out: number[] = []
  for (let i = 0; i < t.length; i++) {
    if (i === 0 || t[i]! - t[i - 1]! > gapMs || path[i] !== path[i - 1]) out.push(i)
  }
  return out
}

/**
 * Tangentes ds/dt (m/ms) para las muestras [from, to) de un segmento, escritas en `out[from..to)`.
 * `speed` opcional: velocidad medida en m/ms en cada muestra (si no, PCHIP con media armónica).
 */
export function segmentTangents(
  t: ArrayLike<number>,
  s: ArrayLike<number>,
  from: number,
  to: number,
  out: Float64Array,
  speed?: ArrayLike<number>,
): void {
  const n = to - from
  if (n <= 0) return
  if (n === 1) {
    out[from] = 0
    return
  }
  // Secantes de cada tramo
  const d = new Float64Array(n - 1)
  for (let k = 0; k < n - 1; k++) {
    const dt = t[from + k + 1]! - t[from + k]!
    d[k] = dt > 0 ? (s[from + k + 1]! - s[from + k]!) / dt : 0
  }
  out[from] = d[0]!
  out[to - 1] = d[n - 2]!
  for (let k = 1; k < n - 1; k++) {
    const a = d[k - 1]!
    const b = d[k]!
    let m: number
    if (speed) {
      m = Math.max(0, speed[from + k]!)
    } else {
      // Media armónica ponderada (PCHIP de Fritsch–Butland)
      if (a <= 0 || b <= 0) m = 0
      else {
        const h0 = t[from + k]! - t[from + k - 1]!
        const h1 = t[from + k + 1]! - t[from + k]!
        const w1 = 2 * h1 + h0
        const w2 = h1 + 2 * h0
        m = (w1 + w2) / (w1 / a + w2 / b)
      }
    }
    out[from + k] = m
  }
  // Limitador de Fritsch–Carlson: garantiza monotonía en cada tramo.
  for (let k = 0; k < n - 1; k++) {
    const dk = d[k]!
    const i = from + k
    if (dk <= 0) {
      out[i] = 0
      out[i + 1] = 0
      continue
    }
    const alpha = out[i]! / dk
    const beta = out[i + 1]! / dk
    const r = alpha * alpha + beta * beta
    if (r > 9) {
      const tau = 3 / Math.sqrt(r)
      out[i] = tau * alpha * dk
      out[i + 1] = tau * beta * dk
    }
  }
}

/** Evalúa la Hermite en t entre las muestras i e i+1 (t[i] ≤ x ≤ t[i+1]). Devuelve [s, ds/dt]. */
export function hermiteAt(
  t: ArrayLike<number>,
  s: ArrayLike<number>,
  m: ArrayLike<number>,
  i: number,
  x: number,
  out: { s: number; v: number },
): void {
  const t0 = t[i]!
  const h = t[i + 1]! - t0
  if (h <= 0) {
    out.s = s[i]!
    out.v = 0
    return
  }
  const u = (x - t0) / h
  const u2 = u * u
  const u3 = u2 * u
  const s0 = s[i]!
  const s1 = s[i + 1]!
  const m0 = m[i]! * h
  const m1 = m[i + 1]! * h
  out.s = (2 * u3 - 3 * u2 + 1) * s0 + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * s1 + (u3 - u2) * m1
  out.v = ((6 * u2 - 6 * u) * s0 + (3 * u2 - 4 * u + 1) * m0 + (-6 * u2 + 6 * u) * s1 + (3 * u2 - 2 * u) * m1) / h
}
