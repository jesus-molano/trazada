/**
 * Reglas de movimiento (D42) sobre todo el CSS de la app (.vue y .css) y los helpers de motion.ts.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick } from 'vue'
import {
  duration,
  LIST_MOTION_MAX_CHANGES,
  LIST_MOTION_MAX_RATE,
  listMotionAllowed,
  stagger,
  STAGGER_MAX_STEPS,
  useReducedMotion,
} from './motion'
import { token } from './tokens'

const APP = fileURLToPath(new URL('..', import.meta.url))

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : [path]
  })
}

/** CSS de cada fichero: los .css enteros y los bloques <style> de los .vue, sin comentarios. */
const STYLES: { file: string; css: string }[] = files(APP)
  .filter((f) => /\.(vue|css)$/.test(f))
  .map((f) => {
    const src = readFileSync(f, 'utf8')
    const css = f.endsWith('.css') ? src : [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n')
    return { file: relative(APP, f), css: css.replace(/\/\*[\s\S]*?\*\//g, '') }
  })

/** Reglas hoja (selector + cuerpo), también las que están dentro de @media; sin las de @keyframes. */
function rules(css: string): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = []
  const stack: string[] = []
  let start = 0
  for (let i = 0; i < css.length; i++) {
    const c = css[i]
    if (c === '{') {
      stack.push(css.slice(start, i).trim())
      start = i + 1
    } else if (c === '}') {
      const selector = stack.pop() ?? ''
      const inKeyframes = stack.some((s) => s.startsWith('@keyframes'))
      if (!selector.startsWith('@') && !inKeyframes) out.push({ selector, body: css.slice(start, i) })
      start = i + 1
    }
  }
  return out
}

/** Declaraciones `transition*` y `animation*` de una regla. */
function motionDecls(body: string): { prop: string; value: string }[] {
  return [...body.matchAll(/(?<![\w-])((?:transition|animation)(?:-[a-z-]+)?)\s*:\s*([^;}]+)/g)].map((m) => ({
    prop: m[1]!,
    value: m[2]!.trim(),
  }))
}

/**
 * Elementos cuyo transform se escribe en cada frame (una transición de transform los retrasaría): la clase
 * tiene que estar en el último compuesto del selector (un hijo, como el `span` del cabezal, sí puede animarse).
 */
const LAST = '[^\\s>+~]*$'
const PER_FRAME = [
  new RegExp(`\\.tz-car(?![\\w-])${LAST}`),
  new RegExp(`\\.tz-label(?![\\w-])${LAST}`),
  new RegExp(`\\.tz-timeline__(?:head|fill|hover)(?![\\w-])${LAST}`),
  new RegExp(`\\.tz-tel__bar\\s*>?\\s*span${LAST}`),
]

/** Animaciones infinitas permitidas (solo el indicador de carga, si llega a existir). */
const INFINITE_ALLOWED = new Set<string>()

describe('movimiento en el CSS (D42)', () => {
  it('el analizador ve las reglas, también dentro de @media, y no las de @keyframes', () => {
    const parsed = rules('.a{transition:x}@media (hover:hover){.b:hover{color:red}}@keyframes k{from{opacity:0}}.c{}')
    expect(parsed.map((r) => r.selector)).toEqual(['.a', '.b:hover', '.c'])
    const all = STYLES.flatMap(({ css }) => rules(css).flatMap((r) => motionDecls(r.body)))
    expect(all.length).toBeGreaterThan(10)
  })

  it('toda transición o animación usa las duraciones de los tokens (sin ms ni s literales)', () => {
    const offenders: string[] = []
    for (const { file, css } of STYLES) {
      for (const { selector, body } of rules(css)) {
        for (const { prop, value } of motionDecls(body)) {
          if (/^(none|initial|inherit|unset)$/.test(value)) continue
          if (/-(property|name|fill-mode|iteration-count|direction|play-state|behavior|composition)$/.test(prop)) continue
          if (/(?<![\w-])\d*\.?\d+m?s\b/.test(value)) offenders.push(`${file} ${selector}: ${prop}: ${value}`)
          else if (/^(transition|animation)(-duration)?$/.test(prop) && !/var\(--tz-dur-/.test(value)) offenders.push(`${file} ${selector}: ${prop}: ${value}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('las curvas salen de los tokens (sin ease, ease-in/out, cubic-bezier ni steps sueltos)', () => {
    const offenders: string[] = []
    for (const { file, css } of STYLES) {
      for (const { selector, body } of rules(css)) {
        for (const { prop, value } of motionDecls(body)) {
          if (/(?<![\w-])(ease|ease-in|ease-out|ease-in-out|cubic-bezier|steps)(?![\w-])/.test(value.replace(/var\([^)]*\)/g, ''))) {
            offenders.push(`${file} ${selector}: ${prop}: ${value}`)
          }
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('nada de `transition: all`', () => {
    const offenders: string[] = []
    for (const { file, css } of STYLES) {
      for (const { selector, body } of rules(css)) {
        for (const { prop, value } of motionDecls(body)) {
          if (/^transition(-property)?$/.test(prop) && /(?<![\w-])all(?![\w-])/.test(value)) offenders.push(`${file} ${selector}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('ninguna transición de transform en lo que se mueve en cada frame (coches, etiquetas, cabezal, acelerador)', () => {
    const offenders: string[] = []
    for (const { file, css } of STYLES) {
      for (const { selector, body } of rules(css)) {
        const selectors = selector.split(',').map((s) => s.trim())
        if (!PER_FRAME.some((re) => selectors.some((s) => re.test(s)))) continue
        for (const { prop, value } of motionDecls(body)) {
          if (/^transition(-property)?$/.test(prop) && /(?<![\w-])(transform|all|translate|scale|rotate)(?![\w-])/.test(value)) {
            offenders.push(`${file} ${selector}: ${prop}: ${value}`)
          }
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('nada infinito (salvo la lista permitida)', () => {
    const offenders = STYLES.filter(({ file, css }) => /(?<![\w-])infinite(?![\w-])/.test(css) && !INFINITE_ALLOWED.has(file)).map(
      ({ file }) => file,
    )
    expect(offenders).toEqual([])
  })

  it('las animaciones comunes existen en base.css: tz-enter, tz-flash y tz-pulse', () => {
    const base = STYLES.find((s) => s.file === 'design/base.css')!.css
    for (const name of ['tz-enter', 'tz-flash', 'tz-pulse']) expect(base, name).toMatch(new RegExp(`@keyframes ${name}\\s*\\{`))
  })

  it('con prefers-reduced-motion, todas las duraciones y el escalonado valen 0, y el desplazamiento y la escala son neutros', () => {
    const css = readFileSync(join(APP, 'design/tokens.css'), 'utf8')
    const at = css.indexOf('@media (prefers-reduced-motion: reduce)')
    expect(at).toBeGreaterThan(0)
    const reduce = css.slice(at)
    const root = css.slice(0, at)
    const durations = [...root.matchAll(/(--tz-dur-[\w-]+)\s*:/g)].map((m) => m[1]!)
    expect(durations.length).toBeGreaterThanOrEqual(5)
    for (const name of [...durations, '--tz-stagger']) expect(reduce, name).toMatch(new RegExp(`${name}\\s*:\\s*0m?s;`))
    expect(reduce).toMatch(/--tz-shift\s*:\s*0(px)?;/)
    expect(reduce).toMatch(/--tz-press-scale\s*:\s*1;/)
  })
})

/** matchMedia falso: `reduce` dice si coincide; `fire` simula el cambio del sistema. */
function fakeMatchMedia(reduce: boolean) {
  const listeners = new Set<(e: MediaQueryListEvent) => void>()
  const query = {
    get matches() {
      return reduce
    },
    addEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => listeners.delete(cb),
  }
  vi.stubGlobal('window', { matchMedia: () => query })
  return {
    listeners,
    fire(next: boolean) {
      reduce = next
      for (const cb of listeners) cb({ matches: next } as MediaQueryListEvent)
    },
  }
}

describe('helpers de movimiento', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('useReducedMotion sigue a prefers-reduced-motion y suelta el listener con su scope', async () => {
    const mq = fakeMatchMedia(true)
    const scope = effectScope()
    const reduced = scope.run(() => useReducedMotion())!
    expect(reduced.value).toBe(true)
    mq.fire(false)
    await nextTick()
    expect(reduced.value).toBe(false)
    expect(mq.listeners.size).toBe(1)
    scope.stop()
    expect(mq.listeners.size).toBe(0)
  })

  it('useReducedMotion sin navegador (SSR) vale false', () => {
    expect(useReducedMotion().value).toBe(false)
  })

  it('stagger: pasos de --tz-stagger con tope; 0 con reduced motion', () => {
    const step = Number.parseFloat(token('--tz-stagger')) / 1000
    expect(stagger()).toBeCloseTo(step)
    expect(stagger(0)).toBe(0)
    expect(stagger(3)).toBeCloseTo(3 * step)
    expect(stagger(100)).toBeCloseTo(STAGGER_MAX_STEPS * step)
    expect(stagger(100, 2)).toBeCloseTo(2 * step)
    expect(stagger(-4)).toBe(0)
    fakeMatchMedia(true)
    expect(stagger(3)).toBe(0)
    expect(duration('flash')).toBe(0)
  })

  it('duration("flash") lee --tz-dur-flash', () => {
    expect(duration('flash')).toBe(0.9)
  })
})

describe('listMotionAllowed: solo cambios pequeños, a ≤ ×4, sin salto y con movimiento permitido', () => {
  const order = ['VER', 'NOR', 'LEC', 'PIA']
  const swapped = ['VER', 'LEC', 'NOR', 'PIA']

  it('un adelantamiento a ×1 se anima', () => {
    expect(listMotionAllowed(order, swapped, false, 1, false)).toBe(true)
  })

  it('a ×4 sí; a ×8 y ×16 no', () => {
    expect(LIST_MOTION_MAX_RATE).toBe(4)
    expect(listMotionAllowed(order, swapped, false, 4, false)).toBe(true)
    expect(listMotionAllowed(order, swapped, false, 8, false)).toBe(false)
    expect(listMotionAllowed(order, swapped, false, 16, false)).toBe(false)
    expect(listMotionAllowed(order, swapped, false, Number.NaN, false)).toBe(false)
  })

  it('tras un salto del reloj (seek o pausa) nunca', () => {
    expect(listMotionAllowed(order, swapped, true, 1, false)).toBe(false)
  })

  it('con prefers-reduced-motion nunca', () => {
    expect(listMotionAllowed(order, swapped, false, 1, true)).toBe(false)
  })

  it('sin cambios no hay nada que animar', () => {
    expect(listMotionAllowed(order, [...order], false, 1, false)).toBe(false)
    expect(listMotionAllowed([], [], false, 1, false)).toBe(false)
  })

  it('mensajes nuevos: hasta LIST_MOTION_MAX_CHANGES se animan; una ráfaga (carga inicial, salto) no', () => {
    expect(LIST_MOTION_MAX_CHANGES).toBe(3)
    expect(listMotionAllowed([1, 2], [1, 2, 3], false, 1, false)).toBe(true)
    expect(listMotionAllowed([], [1], false, 1, false)).toBe(true)
    expect(listMotionAllowed([1], [1, 2, 3, 4], false, 2, false)).toBe(true)
    expect(listMotionAllowed([1], [1, 2, 3, 4, 5], false, 1, false)).toBe(false)
    expect(listMotionAllowed([], order, false, 1, false)).toBe(false)
  })

  it('salidas: como mucho LIST_MOTION_MAX_CHANGES', () => {
    expect(listMotionAllowed(order, ['VER', 'NOR', 'LEC'], false, 1, false)).toBe(true)
    expect(listMotionAllowed([1, 2, 3, 4, 5], [1], false, 1, false)).toBe(false)
  })
})
