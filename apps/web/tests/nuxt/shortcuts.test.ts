/**
 * Atajos del replay con el registro de teclas (D29): `useReplayShortcuts` consulta los atajos registrados antes de
 * cortar por Ctrl/⌘/Alt (Ctrl+K), respeta el foco en un campo de texto o un desplegable y cierra con Esc lo más
 * prioritario de `ESC_PRIORITY`, también el seguimiento y la selección del propio replay. Esc vale con el foco en
 * cualquier control; el timeline (slider) y las casillas no se quedan con las teclas que no usan; una tecla mantenida
 * no alterna sin parar.
 */
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { isEditableTarget, SEEK_STEP_MS, useReplayShortcuts } from '~/composables/useReplayShortcuts'
import { createReplayRuntime } from '~/replay/runtime'
import { ESC_PRIORITY, handleEscape, registerEscape, registerShortcut } from '~/replay/keys'
import { getRuntime, usePlaybackStore } from '~/stores/playback'
import { loadFixture } from '~/testing/fixture'

/** El timeline de verdad: atiende sus flechas y las cancela (el resto de teclas siguen su camino). */
function sliderKeydown(event: KeyboardEvent) {
  if (event.key.startsWith('Arrow')) event.preventDefault()
}

const Host = defineComponent({
  setup() {
    useReplayShortcuts()
    return () =>
      h('div', [
        h('input', { 'data-testid': 'field' }),
        h('button', { type: 'button', 'data-testid': 'btn' }, 'b'),
        h('div', { role: 'slider', tabindex: 0, 'data-testid': 'slider', onKeydown: sliderKeydown }),
        h('label', { 'data-testid': 'check-label' }, [h('input', { type: 'checkbox', 'data-testid': 'check' }), 'c']),
        h('select', { 'data-testid': 'select' }, [h('option', { value: 'a' }, 'a'), h('option', { value: 'b' }, 'b')]),
        h('input', { type: 'radio', name: 'r', 'data-testid': 'radio' }),
      ])
  },
})

const el = <T extends HTMLElement = HTMLElement>(testid: string) => document.querySelector<T>(`[data-testid="${testid}"]`)!

/** Pulsa una tecla sobre `target` (por defecto, el cuerpo de la página) y devuelve el evento. */
function press(
  key: string,
  mods: { ctrl?: boolean; meta?: boolean; shift?: boolean; repeat?: boolean } = {},
  target: EventTarget = document.body,
) {
  const event = new KeyboardEvent('keydown', {
    key,
    ctrlKey: !!mods.ctrl,
    metaKey: !!mods.meta,
    shiftKey: !!mods.shift,
    repeat: !!mods.repeat,
    bubbles: true,
    cancelable: true,
  })
  target.dispatchEvent(event)
  return event
}

/** Un toque del puntero sobre `target` (lo que ve el replay antes del foco de un clic). */
function pointerDown(target: Element) {
  target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }))
}

const offs: (() => void)[] = []
let unmount: (() => void) | null = null

beforeEach(async () => {
  usePlaybackStore().attach(createReplayRuntime(await loadFixture()))
  const w = await mountSuspended(Host, { attachTo: document.body })
  unmount = () => w.unmount()
})
afterEach(() => {
  for (const off of offs.splice(0)) off()
  unmount?.()
  unmount = null
  usePlaybackStore().detach()
  document.body.innerHTML = ''
})

describe('atajos registrados en el replay', () => {
  it('Ctrl/⌘+K registrado se atiende aunque lleve modificador, y cancela la acción del navegador', () => {
    const run = vi.fn()
    offs.push(registerShortcut({ key: 'k', mods: ['mod'] }, run))
    const e = press('k', { ctrl: true })
    expect(run).toHaveBeenCalledTimes(1)
    expect(e.defaultPrevented).toBe(true)
    press('K', { meta: true })
    expect(run).toHaveBeenCalledTimes(2)
    // Sin el modificador no es ese atajo.
    expect(press('k').defaultPrevented).toBe(false)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('con el foco en un campo de texto, solo los marcados para ello (ni los del replay ni los demás)', () => {
    const plain = vi.fn()
    const palette = vi.fn()
    offs.push(registerShortcut({ key: 'g' }, plain))
    offs.push(registerShortcut({ key: 'p', mods: ['mod'] }, palette, { inEditable: true }))
    const field = document.querySelector<HTMLInputElement>('[data-testid="field"]')!
    field.focus()
    press('g', {}, field)
    press('p', { ctrl: true }, field)
    expect(plain).not.toHaveBeenCalled()
    expect(palette).toHaveBeenCalledTimes(1)
    // Fuera del campo, la tecla simple sí.
    press('g')
    expect(plain).toHaveBeenCalledTimes(1)
  })

  it('un evento ya atendido (defaultPrevented) o sin replay enganchado no llega a ningún atajo', () => {
    const run = vi.fn()
    offs.push(registerShortcut({ key: 'g' }, run))
    const handled = new KeyboardEvent('keydown', { key: 'g', bubbles: true, cancelable: true })
    handled.preventDefault()
    document.body.dispatchEvent(handled)
    expect(run).not.toHaveBeenCalled()
    usePlaybackStore().detach()
    press('g')
    expect(run).not.toHaveBeenCalled()
  })
})

describe('Esc por prioridades', () => {
  it('cierra cada vez lo más prioritario: una función por encima, luego el seguimiento y al final la selección', () => {
    const playback = usePlaybackStore()
    playback.selectCar('1')
    playback.setFollowing(true)
    let compareOpen = true
    offs.push(registerEscape(ESC_PRIORITY.compare, { active: () => compareOpen, run: () => (compareOpen = false) }))

    press('Escape')
    expect(compareOpen).toBe(false)
    expect(playback.following).toBe(true)
    expect(playback.selectedCar).toBe('1')

    press('Escape')
    expect(playback.following).toBe(false)
    expect(playback.selectedCar).toBe('1')

    press('Escape')
    expect(playback.selectedCar).toBeNull()
  })

  it('al desmontar el replay, el seguimiento y la selección dejan el registro', () => {
    const playback = usePlaybackStore()
    playback.selectCar('1')
    unmount?.()
    unmount = null
    const below = vi.fn()
    offs.push(registerEscape(ESC_PRIORITY.selection - 1, { active: () => true, run: below }))
    // Sin el replay montado nadie escucha el teclado: se prueba el registro directamente.
    expect(handleEscape()).toBe(true)
    expect(below).toHaveBeenCalledTimes(1)
    expect(playback.selectedCar).toBe('1')
  })
})

describe('qué controles se quedan con las teclas', () => {
  it('isEditableTarget: los campos de texto, los desplegables y los combobox sí; el slider, las casillas y los botones no', () => {
    const make = (html: string) => {
      const box = document.createElement('div')
      box.innerHTML = html
      document.body.append(box)
      return box.firstElementChild!
    }
    for (const html of [
      '<input>',
      '<input type="text">',
      '<input type="search">',
      '<input type="number">',
      '<textarea></textarea>',
      '<select><option>a</option></select>',
      '<div contenteditable="true"></div>',
      '<div role="textbox" tabindex="0"></div>',
      '<input role="combobox">',
      '<div role="listbox" tabindex="0"></div>',
    ]) {
      expect(isEditableTarget(make(html)), html).toBe(true)
    }
    for (const html of [
      '<div role="slider" tabindex="0"></div>',
      '<input type="checkbox">',
      '<input type="radio">',
      '<input type="range">',
      '<input type="button" value="b">',
      '<button type="button">b</button>',
      '<div role="separator" tabindex="0"></div>',
      '<button type="button" role="tab">t</button>',
    ]) {
      expect(isEditableTarget(make(html)), html).toBe(false)
    }
    expect(isEditableTarget(null)).toBe(false)
    expect(isEditableTarget(document.body)).toBe(false)
  })

  it('Esc cierra lo de encima con el foco en el slider, en un desplegable, en una casilla o en un campo de texto', () => {
    let open = 0
    offs.push(registerEscape(ESC_PRIORITY.analysis, { active: () => open > 0, run: () => open-- }))
    for (const id of ['slider', 'select', 'check', 'field']) {
      open = 1
      const target = el(id)
      target.focus()
      const e = press('Escape', {}, target)
      expect(open, id).toBe(0)
      expect(e.defaultPrevented, id).toBe(true)
    }
    // Sin nada que cerrar, el Esc sigue su camino (un campo de texto lo usa por su cuenta).
    expect(press('Escape', {}, el('field')).defaultPrevented).toBe(false)
  })

  it('un Esc que ya atendió el control (la tarjeta del timeline) no cierra nada más', () => {
    let open = true
    offs.push(registerEscape(ESC_PRIORITY.analysis, { active: () => open, run: () => (open = false) }))
    const slider = el('slider')
    const hidePreview = (e: KeyboardEvent) => e.preventDefault()
    slider.addEventListener('keydown', hidePreview)
    press('Escape', {}, slider)
    expect(open).toBe(true)
    slider.removeEventListener('keydown', hidePreview)
    press('Escape', {}, slider)
    expect(open).toBe(false)
  })

  it('con el foco en el slider: los atajos de una tecla, el espacio y 1–5 siguen; sus flechas mueven el tiempo una sola vez', () => {
    const clock = getRuntime()!.clock
    const toggle = vi.fn()
    offs.push(registerShortcut({ key: 't' }, toggle))
    const slider = el('slider')
    slider.focus()

    press('t', {}, slider)
    expect(toggle).toHaveBeenCalledTimes(1)
    expect(clock.playing).toBe(false)
    expect(press(' ', {}, slider).defaultPrevented).toBe(true)
    expect(clock.playing).toBe(true)
    press(' ', {}, slider)
    expect(clock.playing).toBe(false)
    press('4', {}, slider)
    expect(clock.rate).toBe(8)

    // Las flechas del slider las atiende (y cancela) él: el replay no mueve el tiempo otra vez ni cambia de coche.
    const t0 = clock.timeMs
    press('ArrowLeft', {}, slider)
    press('ArrowDown', {}, slider)
    expect(clock.timeMs).toBe(t0)
    expect(usePlaybackStore().selectedCar).toBeNull()
  })

  it('con el foco en un desplegable o un campo de texto, ni los atajos de una tecla ni los del replay', () => {
    const clock = getRuntime()!.clock
    const toggle = vi.fn()
    offs.push(registerShortcut({ key: 't' }, toggle))
    for (const id of ['select', 'field']) {
      const target = el(id)
      target.focus()
      press('t', {}, target)
      press(' ', {}, target)
      press('3', {}, target)
      press('ArrowDown', {}, target)
    }
    expect(toggle).not.toHaveBeenCalled()
    expect([clock.playing, clock.rate, usePlaybackStore().selectedCar]).toEqual([false, 1, null])
  })

  it('casilla: los atajos siguen; el espacio la marca si se llegó con el teclado y reproduce si vino de un clic', () => {
    const clock = getRuntime()!.clock
    const toggle = vi.fn()
    offs.push(registerShortcut({ key: 't' }, toggle))
    const check = el<HTMLInputElement>('check')
    check.focus()
    press('t', {}, check)
    expect(toggle).toHaveBeenCalledTimes(1)

    // Con el teclado: el espacio es de la casilla (nativo, no se cancela).
    expect(press(' ', {}, check).defaultPrevented).toBe(false)
    expect(clock.playing).toBe(false)

    // Con un clic en su etiqueta: el espacio es reproducir/pausa (y se cancela el de la casilla).
    pointerDown(el('check-label'))
    expect(press(' ', {}, check).defaultPrevented).toBe(true)
    expect(clock.playing).toBe(true)
  })

  it('las flechas de un botón de opción son suyas (nativas): ni mueven el tiempo ni cambian de coche', () => {
    const clock = getRuntime()!.clock
    const radio = el('radio')
    radio.focus()
    const t0 = clock.timeMs
    expect(press('ArrowRight', {}, radio).defaultPrevented).toBe(false)
    expect(press('ArrowDown', {}, radio).defaultPrevented).toBe(false)
    expect(clock.timeMs).toBe(t0)
    expect(usePlaybackStore().selectedCar).toBeNull()
  })
})

describe('tecla mantenida (repetición automática)', () => {
  it('el espacio alterna una vez; Esc cierra una sola cosa; las flechas siguen moviendo el tiempo', () => {
    const playback = usePlaybackStore()
    const clock = getRuntime()!.clock
    press(' ')
    for (let i = 0; i < 4; i++) expect(press(' ', { repeat: true }).defaultPrevented).toBe(true)
    expect(clock.playing).toBe(true)
    clock.pause()

    playback.selectCar('1')
    playback.setFollowing(true)
    press('Escape')
    for (let i = 0; i < 4; i++) press('Escape', { repeat: true })
    expect(playback.following).toBe(false)
    expect(playback.selectedCar).toBe('1')

    const t0 = clock.timeMs
    press('ArrowRight')
    press('ArrowRight', { repeat: true })
    press('ArrowRight', { repeat: true })
    expect(clock.timeMs).toBe(t0 + 3 * SEEK_STEP_MS)
  })

  it('un atajo conmutador (L, T, ?) cuenta una vez y su repetición no llega al navegador; un salto (coma, punto) se repite', () => {
    const toggle = vi.fn()
    const jump = vi.fn()
    offs.push(registerShortcut({ key: 'l' }, toggle))
    offs.push(registerShortcut({ key: '.' }, jump, { repeat: true }))
    press('l')
    for (let i = 0; i < 5; i++) expect(press('l', { repeat: true }).defaultPrevented).toBe(true)
    expect(toggle).toHaveBeenCalledTimes(1)
    press('.')
    press('.', { repeat: true })
    expect(jump).toHaveBeenCalledTimes(2)
  })
})
