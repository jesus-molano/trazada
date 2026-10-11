/**
 * Acceso a los tokens de `tokens.css` desde TS (three.js, uPlot, GSAP). El valor vivo sale del documento;
 * sin documento (SSR, tests) se usa el de la propia hoja, así que no hay valores duplicados en el código.
 */
import css from './tokens.css?raw'

/** Primer valor de cada token en la hoja (el de `:root`, no el de reduced motion). */
const DEFAULTS = new Map<string, string>()
for (const m of css.matchAll(/(--tz-[\w-]+)\s*:\s*([^;]+);/g)) {
  if (!DEFAULTS.has(m[1]!)) DEFAULTS.set(m[1]!, m[2]!.trim())
}

/** Alias de otro token (`--tz-gain: var(--tz-success)`): el valor del token al que apunta. */
const ALIAS = /^var\((--tz-[\w-]+)\)$/

function fromSheet(name: string, depth = 0): string {
  const value = DEFAULTS.get(name)
  if (value === undefined) throw new Error(`token desconocido: ${name}`)
  const alias = ALIAS.exec(value)
  return alias && depth < 8 ? fromSheet(alias[1]!, depth + 1) : value
}

export function token(name: `--tz-${string}`): string {
  if (typeof document !== 'undefined') {
    // El valor calculado de una propiedad personalizada ya trae resueltos sus var().
    const live = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    if (live) return live
  }
  return fromSheet(name)
}
