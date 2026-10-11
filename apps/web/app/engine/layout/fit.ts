/**
 * Prioridad del título en la cabecera del replay (D44): la cabecera va en una fila y, si no cabe, lo secundario pasa
 * antes a su forma corta (solo el icono, la cifra, «≈ Estimado») que el título a «…». Los niveles son acumulativos:
 * 1 = las formas de por debajo de 1920 px, 2 = las de por debajo de 1600 px, 3 = las de por debajo de 1360 px. Las
 * media queries ya ponen esas formas por ancho de ventana; el nivel las adelanta cuando el título no cabe entero (un
 * título largo a 1920 px, por ejemplo). Las etiquetas «Estimado» y las banderas no se esconden en ningún nivel.
 *
 * TS puro: quien mide (composables/useHeaderFit.ts) aplica cada nivel al DOM y dice si ya cabe.
 */

/** Niveles de compactación de la cabecera, además del 0 (lo que digan las media queries). */
export const HEADER_FIT_MAX = 3

/**
 * El primer nivel (de 0 a `max`) en el que cabe todo: aplica cada nivel con `apply` antes de preguntar a `fits`. Si
 * ninguno basta, se queda en `max` (lo más compacto; el título se acorta con «…»).
 */
export function firstFittingLevel(max: number, apply: (level: number) => void, fits: () => boolean): number {
  for (let level = 0; level < max; level++) {
    apply(level)
    if (fits()) return level
  }
  apply(max)
  return max
}

/** Valor del atributo `data-fit` para un nivel: los niveles alcanzados separados por espacios («1 2»), o null en 0. */
export function fitAttribute(level: number): string | null {
  if (level <= 0) return null
  return Array.from({ length: level }, (_, i) => String(i + 1)).join(' ')
}
