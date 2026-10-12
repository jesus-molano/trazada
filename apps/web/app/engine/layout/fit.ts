/**
 * Prioridad del título en la cabecera del replay (D44): la cabecera va en una fila y, si no cabe, lo secundario pasa
 * antes a su forma corta (solo el icono, la cifra, «≈ Estimado») que el título a «…». Los niveles son acumulativos:
 * 1 = las formas de por debajo de 1920 px, 2 = las de por debajo de 1600 px, 3 = las de por debajo de 1360 px, y 4 = el
 * estado de pista en una fila propia, debajo de todo lo demás y a todo el ancho (sus chips, en horizontal). Las media
 * queries ya ponen las formas cortas por ancho de ventana; el nivel las adelanta cuando el título no cabe entero (un
 * título largo a 1920 px, por ejemplo). Las etiquetas «Estimado» y las banderas no se esconden en ningún nivel, y el
 * estado de pista nunca es una columna de chips: o va entero en la fila del título o en la suya.
 *
 * TS puro: quien mide (composables/useHeaderFit.ts) aplica cada nivel al DOM y dice si ya cabe y qué alto tiene.
 */

/** Niveles de compactación de la cabecera, además del 0 (lo que digan las media queries). */
export const HEADER_FIT_MAX = 4

/** Lo que se mide con un nivel aplicado: si todo va en una fila con el título entero, y el alto de la cabecera (px). */
export interface HeaderFit {
  fits: boolean
  height: number
}

/** Dos altos que difieren en menos que esto (px) son la misma cantidad de filas. */
const SAME_HEIGHT_PX = 2

/**
 * El nivel (de 0 a `max`) para la cabecera: aplica cada nivel con `apply` antes de medirlo con `measure`. Gana el primero
 * en el que cabe todo en una fila con el título entero. Si ninguno cabe, el más bajo de alto (lo que le queda a la
 * escena) y, a igual alto, el más alto de nivel: lo más compacto (el título se acorta con «…» si aun así no cabe) y, si
 * la fila se parte igual, el estado de pista en la suya en lugar de partir la fila por cualquier sitio.
 */
export function chooseLevel(
  max: number,
  apply: (level: number) => void,
  measure: () => HeaderFit,
  from = 0,
): number {
  // Desde el nivel actual (cada nivel probado fuerza un layout de toda la página). Un nivel más alto
  // nunca ocupa más: si con `from` cabe, se baja mientras siga cabiendo; si no, los de debajo tampoco caben y se sube.
  if (from > 0 && from <= max) {
    apply(from)
    if (measure().fits) {
      let level = from
      while (level > 0) {
        apply(level - 1)
        if (!measure().fits) break
        level--
      }
      if (level > 0) apply(level)
      return level
    }
  }
  let best = 0
  let bestHeight = Number.POSITIVE_INFINITY
  for (let level = from > 0 && from <= max ? from : 0; level <= max; level++) {
    apply(level)
    const m = measure()
    if (m.fits) return level
    if (m.height <= bestHeight + SAME_HEIGHT_PX) {
      best = level
      bestHeight = Math.min(bestHeight, m.height)
    }
  }
  if (best !== max) apply(best)
  return best
}

/** Valor del atributo `data-fit` para un nivel: los niveles alcanzados separados por espacios («1 2»), o null en 0. */
export function fitAttribute(level: number): string | null {
  if (level <= 0) return null
  return Array.from({ length: level }, (_, i) => String(i + 1)).join(' ')
}
