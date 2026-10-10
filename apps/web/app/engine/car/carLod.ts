/**
 * Tamaño y nivel de detalle de los coches en pantalla. De lejos, el coche crece para que se vea a escala de
 * mapa (solo visual) y se dibuja como una cuña; de cerca, con su tamaño real y el modelo detallado. El cambio
 * tiene histéresis para que un coche al borde del umbral no parpadee entre los dos.
 */

/** Distancia de cámara (m) a partir de la cual los coches dejan de encogerse en pantalla. */
export const MIN_SIZE_DISTANCE_M = 450

/** Longitud en pantalla (px) a partir de la cual se dibuja el modelo detallado, y por debajo de la que se deja. */
export const CAR_DETAIL_ON_PX = 56
export const CAR_DETAIL_OFF_PX = 40

/** Factor de tamaño visual a una distancia de la cámara (1 de cerca). */
export function carSizeScale(distance: number): number {
  return Math.max(1, distance / MIN_SIZE_DISTANCE_M)
}

/**
 * Píxeles que ocupa en pantalla una longitud vista de frente a una distancia de la cámara.
 * @param projY elemento [1][1] de la matriz de proyección (1 / tan(fov/2)).
 */
export function screenLengthPx(lengthM: number, distance: number, projY: number, viewportHeightPx: number): number {
  return (lengthM * 0.5 * viewportHeightPx * projY) / Math.max(1e-3, distance)
}

/** Nivel de detalle siguiente (true = modelo detallado) según la longitud del coche en pantalla. */
export function nextDetail(detail: boolean, px: number): boolean {
  return detail ? px >= CAR_DETAIL_OFF_PX : px >= CAR_DETAIL_ON_PX
}
