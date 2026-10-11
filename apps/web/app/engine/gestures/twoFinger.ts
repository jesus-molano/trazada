/**
 * Gestos de dos dedos sobre la escena (ítem 17, D43): qué quiere hacer el usuario con los dos dedos, a partir de dónde
 * estaban al apoyar el segundo y dónde están ahora. Puro (sin DOM): lo usa `composables/useSceneGestures.ts`.
 *
 * - `scrub`: los dos dedos en paralelo y en horizontal. Mueven el reloj: todo el ancho de la escena son
 *   `SCRUB_WINDOW_MS` de sesión, de forma lineal (`scrubOffsetMs`); a la derecha avanza y a la izquierda retrocede.
 * - `pinch`: los dedos se juntan o se separan. Zoom del mapa (los controles del mapa) o, siguiendo a un coche, distancia
 *   de la cámara.
 * - `map`: todo lo demás (arrastrar en vertical o en diagonal, girar los dedos): lo que ya hacen los controles del mapa.
 *
 * Mientras ningún dedo se haya movido `decidePx`, no se decide nada (`null`): así un gesto no empieza siendo lo que no
 * es. Los umbrales son conservadores, para que inclinar o girar el mapa no muevan el reloj por error; el gesto del
 * sistema desde el borde de la pantalla (iPadOS) no se puede anular, pero tampoco interfiere.
 */

/** Posición de los dos dedos (px CSS de la página). */
export interface FingerPair {
  ax: number
  ay: number
  bx: number
  by: number
}

export type TwoFingerKind = 'scrub' | 'pinch' | 'map'

export interface TwoFingerThresholds {
  /** Recorrido (px) del dedo que más se ha movido para decidir. */
  readonly decidePx: number
  /** Coseno mínimo del ángulo entre los desplazamientos de los dos dedos para considerarlos paralelos (~25°). */
  readonly parallelCos: number
  /** El desplazamiento común es horizontal si |x| ≥ esto × |y| (~27° de la horizontal como mucho). */
  readonly horizontalRatio: number
  /** Los dos dedos se mueven parecido: el que menos, al menos esta fracción del que más. */
  readonly magnitudeRatio: number
  /** En un deslizamiento, la separación entre dedos cambia como mucho esta fracción del desplazamiento horizontal. */
  readonly spanRatio: number
  /** Cambio de separación (px) mínimo para un pellizco… */
  readonly pinchMinPx: number
  /** …y, como poco, esta fracción del desplazamiento común (un pellizco apenas mueve el punto medio). */
  readonly pinchRatio: number
}

export const TWO_FINGER: TwoFingerThresholds = {
  decidePx: 12,
  parallelCos: 0.9,
  horizontalRatio: 2,
  magnitudeRatio: 0.5,
  spanRatio: 0.35,
  pinchMinPx: 8,
  pinchRatio: 0.8,
}

/** Todo el ancho de la escena, en tiempo de sesión (ms): 2 minutos (D43). */
export const SCRUB_WINDOW_MS = 120_000

/** Separación entre los dos dedos (px). */
export function fingerSpan(p: FingerPair): number {
  return Math.hypot(p.bx - p.ax, p.by - p.ay)
}

/** Punto medio de los dos dedos en horizontal (px). */
export function fingerMidX(p: FingerPair): number {
  return (p.ax + p.bx) / 2
}

/**
 * Qué gesto es, de `start` (al apoyar el segundo dedo) a `now`; `null` mientras ningún dedo se haya movido lo bastante
 * para decidirlo.
 */
export function classifyTwoFinger(start: FingerPair, now: FingerPair, t: TwoFingerThresholds = TWO_FINGER): TwoFingerKind | null {
  const dax = now.ax - start.ax
  const day = now.ay - start.ay
  const dbx = now.bx - start.bx
  const dby = now.by - start.by
  const la = Math.hypot(dax, day)
  const lb = Math.hypot(dbx, dby)
  const travel = Math.max(la, lb)
  if (!(travel >= t.decidePx)) return null

  const ds = fingerSpan(now) - fingerSpan(start)
  const mx = (dax + dbx) / 2
  const my = (day + dby) / 2
  const common = Math.hypot(mx, my)

  const alike = Math.min(la, lb) >= t.magnitudeRatio * travel
  const parallel = alike && (dax * dbx + day * dby) / (la * lb) >= t.parallelCos
  const horizontal = Math.abs(mx) >= t.horizontalRatio * Math.abs(my)
  if (parallel && horizontal && Math.abs(ds) <= t.spanRatio * Math.abs(mx)) return 'scrub'
  if (Math.abs(ds) >= t.pinchMinPx && Math.abs(ds) >= t.pinchRatio * common) return 'pinch'
  return 'map'
}

/** Tiempo de sesión (ms) que corresponde a desplazar los dedos `dxPx` en una escena de `widthPx` de ancho. */
export function scrubOffsetMs(dxPx: number, widthPx: number, windowMs: number = SCRUB_WINDOW_MS): number {
  return widthPx > 0 && Number.isFinite(dxPx) ? (dxPx / widthPx) * windowMs : 0
}
