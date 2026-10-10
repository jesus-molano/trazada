/**
 * Atajos del replay con el registro de teclas (D29): `useReplayShortcuts` consulta los atajos registrados antes de
 * cortar por Ctrl/⌘/Alt (Ctrl+K), respeta el foco en un campo de texto y cierra con Esc lo más prioritario de
 * `ESC_PRIORITY`, también el seguimiento y la selección del propio replay.
 */
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { useReplayShortcuts } from '~/composables/useReplayShortcuts'
import { createReplayRuntime } from '~/replay/runtime'
import { ESC_PRIORITY, handleEscape, registerEscape, registerShortcut } from '~/replay/keys'
import { usePlaybackStore } from '~/stores/playback'
import { loadFixture } from '~/testing/fixture'

const Host = defineComponent({
  setup() {
    useReplayShortcuts()
    return () => h('div', [h('input', { 'data-testid': 'field' }), h('button', { type: 'button', 'data-testid': 'btn' }, 'b')])
  },
})

/** Pulsa una tecla sobre `target` (por defecto, el cuerpo de la página) y devuelve el evento. */
function press(key: string, mods: { ctrl?: boolean; meta?: boolean; shift?: boolean } = {}, target: EventTarget = document.body) {
  const event = new KeyboardEvent('keydown', {
    key,
    ctrlKey: !!mods.ctrl,
    metaKey: !!mods.meta,
    shiftKey: !!mods.shift,
    bubbles: true,
    cancelable: true,
  })
  target.dispatchEvent(event)
  return event
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
