/**
 * Anchura «de mapa»: la pista se dibuja de cerca con una anchura genérica de 14 m (`TRACK_WIDTH_M`; no es la
 * de cada circuito, que la fuente no da) y, donde a esa distancia se vería más fina, con un mínimo de píxeles
 * en pantalla (a escala de circuito entero, 14 m serían un hilo de 2–3 px).
 * Se calcula en el shader para cada vértice (`composables/useMapWidth.ts`); esta es la misma cuenta en TS,
 * para los tests y la sonda de depuración. Es solo visual: no cambia ninguna posición de coche ni el trazado.
 */

/** Anchura mínima en pantalla de la pista y del pit lane (px CSS). */
export const MIN_TRACK_PX = 7
export const MIN_PIT_PX = 3.5

/** De canto (escorzo extremo), como mucho la anchura que daría este tanto por uno de la vista de frente. */
export const MIN_FORESHORTENING = 0.3

/**
 * Semianchura con la que se dibuja la cinta en un punto (m). `realHalf`: la semianchura en metros (la genérica,
 * no la del circuito), que es la que se ve de cerca.
 * @param pxPerM píxeles por metro en pantalla a lo ancho de la cinta en ese punto (con escorzo).
 * @param frontalPxPerM píxeles por metro de un segmento de frente a la cámara a esa profundidad.
 */
export function mapHalfWidth(realHalf: number, minPx: number, pxPerM: number, frontalPxPerM: number): number {
  const px = Math.max(pxPerM, MIN_FORESHORTENING * frontalPxPerM)
  if (!(px > 0)) return realHalf
  return Math.max(realHalf, (0.5 * minPx) / px)
}
