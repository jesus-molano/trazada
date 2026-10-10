/**
 * Sistema de movimiento: lee duraciones y curvas de los tokens CSS para que GSAP y
 * las transiciones CSS compartan una única fuente de verdad. Con
 * prefers-reduced-motion todas las duraciones valen 0.
 */
import { token } from './tokens'

export type MotionToken = 'fast' | 'base' | 'slow' | 'camera'
export type EaseToken = 'standard' | 'enter' | 'exit'

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** "900ms" o ".9s" (el minificador de CSS reescribe las unidades) → segundos. */
export function parseCssTime(raw: string): number {
  const m = /^(-?[\d.]+)(ms|s)$/.exec(raw.trim())
  if (!m) throw new Error(`duración CSS no válida: ${raw}`)
  return Number.parseFloat(m[1]!) / (m[2] === 'ms' ? 1000 : 1)
}

/** Duración en segundos (unidad de GSAP). */
export function duration(name: MotionToken): number {
  if (prefersReducedMotion()) return 0
  return parseCssTime(token(`--tz-dur-${name}`))
}

/** Curva cúbica como cadena CSS; GSAP la acepta vía CustomEase o como 'power' equivalente. */
export function easing(name: EaseToken): string {
  return token(`--tz-ease-${name}`)
}

/** Equivalentes GSAP de las curvas de los tokens (sin plugins extra). */
export const GSAP_EASE: Record<EaseToken, string> = {
  standard: 'power3.inOut',
  enter: 'power3.out',
  exit: 'power3.in',
}
