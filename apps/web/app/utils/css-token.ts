/** Valor de un token de diseño (`--tz-…`) leído del documento, para usarlo fuera de CSS (three.js). */
export function cssToken(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}
