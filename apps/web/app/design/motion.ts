/**
 * Sistema de movimiento: lee duraciones y curvas de los tokens CSS para que GSAP y
 * las transiciones CSS compartan una única fuente de verdad. Con
 * prefers-reduced-motion todas las duraciones valen 0.
 */
export type MotionToken = 'fast' | 'base' | 'slow' | 'camera'
export type EaseToken = 'standard' | 'enter' | 'exit'

const FALLBACK_MS: Record<MotionToken, number> = { fast: 120, base: 200, slow: 360, camera: 900 }
const FALLBACK_EASE: Record<EaseToken, string> = {
  standard: 'cubic-bezier(0.2, 0, 0, 1)',
  enter: 'cubic-bezier(0, 0, 0, 1)',
  exit: 'cubic-bezier(0.3, 0, 1, 1)',
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function cssVar(name: string): string {
  if (typeof document === 'undefined') return ''
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

/** Duración en segundos (unidad de GSAP). */
export function duration(token: MotionToken): number {
  if (prefersReducedMotion()) return 0
  const raw = cssVar(`--tz-dur-${token}`)
  const ms = raw.endsWith('ms') ? Number.parseFloat(raw) : Number.NaN
  return (Number.isFinite(ms) ? ms : FALLBACK_MS[token]) / 1000
}

/** Curva cúbica como cadena CSS; GSAP la acepta vía CustomEase o como 'power' equivalente. */
export function easing(token: EaseToken): string {
  return cssVar(`--tz-ease-${token}`) || FALLBACK_EASE[token]
}

/** Equivalentes GSAP de las curvas de los tokens (sin plugins extra). */
export const GSAP_EASE: Record<EaseToken, string> = {
  standard: 'power3.inOut',
  enter: 'power3.out',
  exit: 'power3.in',
}
