/**
 * Sistema de movimiento: lee duraciones y curvas de los tokens CSS para que GSAP y
 * las transiciones CSS compartan una única fuente de verdad. Con
 * prefers-reduced-motion todas las duraciones valen 0.
 *
 * Regla (D42): solo se anima la interfaz (aparecer, reordenar, cambiar de estado). Nunca se animan valores de
 * datos: un contador o un tween de velocidad mostraría cifras que nunca existieron (H8).
 */
import { getCurrentInstance, getCurrentScope, onMounted, onScopeDispose, readonly, ref, type Ref } from 'vue'
import { token } from './tokens'

export type MotionToken = 'fast' | 'base' | 'slow' | 'camera' | 'flash'
export type EaseToken = 'standard' | 'enter' | 'exit'

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia(REDUCED_MOTION_QUERY).matches
}

/**
 * prefers-reduced-motion como ref reactiva: sigue los cambios del sistema (evento `change`) y suelta el
 * listener al desmontar. Dentro de un componente vale `false` hasta montarse, igual que en SSR, para que la
 * hidratación no difiera; las animaciones siempre ocurren después.
 */
export function useReducedMotion(): Readonly<Ref<boolean>> {
  const reduced = ref(false)
  if (typeof window === 'undefined' || !window.matchMedia) return readonly(reduced)
  const query = window.matchMedia(REDUCED_MOTION_QUERY)
  const onChange = (event: MediaQueryListEvent) => {
    reduced.value = event.matches
  }
  query.addEventListener('change', onChange)
  if (getCurrentScope()) onScopeDispose(() => query.removeEventListener('change', onChange))
  if (getCurrentInstance()) onMounted(() => (reduced.value = query.matches))
  else reduced.value = query.matches
  return readonly(reduced)
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

/** Pasos máximos de una entrada escalonada: el elemento 30 no espera 30 pasos. */
export const STAGGER_MAX_STEPS = 8

/**
 * Retardo (s) del elemento `index` de una entrada escalonada, en pasos de `--tz-stagger` y con tope de
 * `maxSteps`; 0 con reduced motion. `stagger()` es un paso (el `stagger` de GSAP).
 */
export function stagger(index = 1, maxSteps = STAGGER_MAX_STEPS): number {
  if (prefersReducedMotion()) return 0
  const steps = Math.min(Math.max(0, Math.floor(index)), Math.max(0, maxSteps))
  return steps * parseCssTime(token('--tz-stagger'))
}

/** Velocidad de reproducción máxima a la que se animan las listas (×4): a ×8 y ×16 cambian demasiado rápido. */
export const LIST_MOTION_MAX_RATE = 4
/** Entradas (o salidas) máximas para animar un cambio de lista; más es una carga o un salto, no un suceso. */
export const LIST_MOTION_MAX_CHANGES = 3

export type ListKey = string | number

/**
 * ¿Se anima el paso de la lista `prev` a `next` (reordenar con FLIP, entrada de un mensaje, destello)?
 * Solo con el movimiento permitido, a ≤ ×4, sin salto del reloj (seek, pausa) y si el cambio es pequeño
 * (como mucho LIST_MOTION_MAX_CHANGES claves que entran o salen) y real (otro orden u otras claves).
 */
export function listMotionAllowed(
  prev: readonly ListKey[],
  next: readonly ListKey[],
  jumped: boolean,
  rate: number,
  reduced: boolean,
): boolean {
  if (reduced || jumped || !(rate <= LIST_MOTION_MAX_RATE)) return false
  const before = new Set(prev)
  const after = new Set(next)
  let added = 0
  let removed = 0
  for (const key of after) if (!before.has(key)) added++
  for (const key of before) if (!after.has(key)) removed++
  if (added > LIST_MOTION_MAX_CHANGES || removed > LIST_MOTION_MAX_CHANGES) return false
  if (added === 0 && removed === 0 && prev.length === next.length && prev.every((key, i) => key === next[i])) return false
  return true
}
