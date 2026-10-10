/**
 * Anchura «de mapa»: la pista se dibuja con su anchura real de cerca y, al alejarse, con un mínimo de
 * píxeles en pantalla (a escala de circuito entero, 14 m serían un hilo de 2–3 px). Es solo visual: no
 * cambia ninguna posición de coche ni el trazado.
 */

export interface Vec3 {
  x: number
  y: number
  z: number
}

/** Metros por píxel a una distancia dada de una cámara en perspectiva. */
export function worldPerPixel(distance: number, fovDeg: number, viewportHeightPx: number): number {
  return (2 * distance * Math.tan((fovDeg * Math.PI) / 360)) / Math.max(1, viewportHeightPx)
}

/** Semianchura visible: la real, o la que ocupa `minPx` píxeles a esa distancia si es mayor. */
export function screenHalfWidth(realHalf: number, distance: number, fovDeg: number, viewportHeightPx: number, minPx: number): number {
  return Math.max(realHalf, (minPx / 2) * worldPerPixel(distance, fovDeg, viewportHeightPx))
}

/**
 * Distancia de la cámara al suelo (plano y = groundY) a lo largo de su dirección de mira; si mira hacia
 * arriba o casi en horizontal, su altura sobre el suelo. `dir` debe estar normalizado.
 */
export function viewDistance(pos: Vec3, dir: Vec3, groundY: number): number {
  const height = Math.abs(pos.y - groundY)
  if (dir.y > -0.05) return Math.max(1, height)
  return Math.max(1, Math.min((groundY - pos.y) / dir.y, height * 20))
}

/** ¿Merece la pena reescribir la malla? (evita trabajo por cambios de menos de un 3 %). */
export function widthChanged(previous: number, next: number): boolean {
  return Math.abs(next - previous) > previous * 0.03
}

/** Anchura mínima en pantalla de la pista y del pit lane (px CSS). */
export const MIN_TRACK_PX = 7
export const MIN_PIT_PX = 3.5
