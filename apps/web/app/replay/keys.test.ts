import { afterEach, describe, expect, it, vi } from 'vitest'
import { ESC_PRIORITY, findShortcut, handleEscape, registerEscape, registerShortcut, runShortcut } from './keys'

/** KeyboardEvent mínimo (Node no lo tiene). */
function key(k: string, mods: { ctrl?: boolean; meta?: boolean; alt?: boolean; shift?: boolean } = {}) {
  let prevented = false
  return {
    key: k,
    ctrlKey: !!mods.ctrl,
    metaKey: !!mods.meta,
    altKey: !!mods.alt,
    shiftKey: !!mods.shift,
    preventDefault: () => (prevented = true),
    get defaultPrevented() {
      return prevented
    },
  } as unknown as KeyboardEvent
}

const offs: (() => void)[] = []
const track = (off: () => void) => (offs.push(off), off)
afterEach(() => {
  for (const off of offs.splice(0)) off()
})

describe('registro de Esc', () => {
  it('las prioridades fijas van de lo que está más encima a la selección', () => {
    const order = ['summary', 'palette', 'tips', 'analysisCard', 'analysis', 'tv', 'compare', 'follow', 'selection'] as const
    const values = order.map((k) => ESC_PRIORITY[k])
    expect([...values].sort((a, b) => b - a)).toEqual(values)
    expect(new Set(values).size).toBe(values.length)
  })

  it('cada Esc cierra solo lo más prioritario que esté activo', () => {
    const open = { summary: true, follow: true, selection: true }
    const closed: string[] = []
    for (const k of ['selection', 'summary', 'follow'] as const) {
      track(
        registerEscape(ESC_PRIORITY[k], {
          active: () => open[k],
          run: () => {
            open[k] = false
            closed.push(k)
          },
        }),
      )
    }
    expect(handleEscape()).toBe(true)
    expect(handleEscape()).toBe(true)
    expect(handleEscape()).toBe(true)
    expect(closed).toEqual(['summary', 'follow', 'selection'])
    expect(handleEscape()).toBe(false)
  })

  it('a igual prioridad gana el último registrado; la baja lo quita', () => {
    const runs: string[] = []
    track(registerEscape(60, { active: () => true, run: () => runs.push('a') }))
    const offB = track(registerEscape(60, { active: () => true, run: () => runs.push('b') }))
    handleEscape()
    offB()
    handleEscape()
    expect(runs).toEqual(['b', 'a'])
  })
})

describe('registro de atajos', () => {
  it('una letra vale en minúscula o mayúscula, pero no con Shift si no lo pide', () => {
    const run = vi.fn()
    track(registerShortcut({ key: 't' }, run))
    expect(runShortcut(key('t'), false)).toBe(true)
    expect(runShortcut(key('T'), false)).toBe(true)
    expect(runShortcut(key('T', { shift: true }), false)).toBe(false)
    expect(runShortcut(key('t', { ctrl: true }), false)).toBe(false)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('«mod» es Ctrl o ⌘; los demás modificadores, exactos', () => {
    const run = vi.fn()
    track(registerShortcut({ key: 'k', mods: ['mod'] }, run))
    expect(runShortcut(key('k', { ctrl: true }), false)).toBe(true)
    expect(runShortcut(key('K', { meta: true }), false)).toBe(true)
    expect(runShortcut(key('k'), false)).toBe(false)
    expect(runShortcut(key('k', { ctrl: true, alt: true }), false)).toBe(false)
    expect(runShortcut(key('k', { ctrl: true, shift: true }), false)).toBe(false)
    expect(run).toHaveBeenCalledTimes(2)
    expect(() => registerShortcut({ key: 'k', mods: ['mod', 'ctrl'] }, run)).toThrow(/mod/)
  })

  it('con símbolos, el Shift de la distribución del teclado no cuenta; con Shift exigido, sí', () => {
    const help = vi.fn()
    const big = vi.fn()
    track(registerShortcut({ key: '?' }, help))
    track(registerShortcut({ key: 'L', mods: ['shift'] }, big))
    expect(runShortcut(key('?', { shift: true }), false)).toBe(true)
    expect(runShortcut(key('L', { shift: true }), false)).toBe(true)
    expect(runShortcut(key('l'), false)).toBe(false)
    expect(help).toHaveBeenCalledTimes(1)
    expect(big).toHaveBeenCalledTimes(1)
  })

  it('ejecuta el atajo y cancela la acción por defecto del navegador', () => {
    const run = vi.fn()
    track(registerShortcut({ key: 'k', mods: ['mod'] }, run))
    const e = key('k', { ctrl: true })
    runShortcut(e, false)
    expect(e.defaultPrevented).toBe(true)
    expect(run).toHaveBeenCalledWith(e)
  })

  it('las teclas del replay y del navegador no se pueden registrar sin Ctrl/⌘/Alt', () => {
    for (const k of [' ', 'ArrowLeft', 'ArrowUp', 'Escape', 'Tab', 'Enter', '1', '5']) {
      expect(() => registerShortcut({ key: k }, () => {}), k).toThrow(/ya la usa/)
    }
    track(registerShortcut({ key: '1', mods: ['alt'] }, () => {}))
    track(registerShortcut({ key: '6' }, () => {}))
  })

  it('con el foco en un campo de texto, solo los atajos marcados para ello', () => {
    const plain = vi.fn()
    const palette = vi.fn()
    track(registerShortcut({ key: 'g' }, plain))
    track(registerShortcut({ key: 'k', mods: ['mod'] }, palette, { inEditable: true }))
    expect(runShortcut(key('g'), true)).toBe(false)
    expect(runShortcut(key('k', { meta: true }), true)).toBe(true)
    expect(plain).not.toHaveBeenCalled()
  })

  it('`when` lo desactiva sin darlo de baja; con dos iguales atiende el último; la baja lo quita', () => {
    let enabled = false
    const a = vi.fn()
    const b = vi.fn()
    track(registerShortcut({ key: 'c' }, a))
    const offB = track(registerShortcut({ key: 'c' }, b, { when: () => enabled }))
    runShortcut(key('c'), false)
    enabled = true
    runShortcut(key('c'), false)
    offB()
    runShortcut(key('c'), false)
    expect(a).toHaveBeenCalledTimes(2)
    expect(b).toHaveBeenCalledTimes(1)
    expect(findShortcut(key('x'), false)).toBeNull()
  })
})
