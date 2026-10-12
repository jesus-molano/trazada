/**
 * Fuentes propias (@fontsource, en nuxt.config.ts): cada cara va en subconjuntos con `unicode-range` y el navegador
 * solo baja el que necesita el texto que pinta.
 */

/** Si un `unicode-range` de CSS (p. ej. «U+0-FF, U+131, U+2000-206F» o «U+4??») incluye el punto de código. */
export function coversCodePoint(range: string, cp: number): boolean {
  return range.split(',').some((part) => {
    const r = part.trim().toUpperCase().replace(/^U\+/, '')
    if (!r) return false
    if (r.includes('?')) return cp >= Number.parseInt(r.replaceAll('?', '0'), 16) && cp <= Number.parseInt(r.replaceAll('?', 'F'), 16)
    const [lo = '', hi = lo] = r.split('-')
    return cp >= Number.parseInt(lo, 16) && cp <= Number.parseInt(hi, 16)
  })
}

/**
 * Carga ya las caras latinas que aún no se han usado (las del replay, desde la portada): sin esto, el primer layout del
 * replay pedía Barlow 500 y compañía, pintaba con la de respaldo y volvía a colocar el texto al llegar.
 */
export function warmLatinFonts(fonts: FontFaceSet | undefined = globalThis.document?.fonts): void {
  fonts?.forEach((face) => {
    if (face.status === 'unloaded' && coversCodePoint(face.unicodeRange, 0x41)) void face.load().catch(() => {})
  })
}
