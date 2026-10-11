/**
 * Paleta de comandos (ítem 14, D43) sobre el fixture (Spa 2026, libres 1): Ctrl+K y «/» la abren (no encima de otro
 * diálogo modal), el campo es un combobox con `aria-activedescendant` sobre la opción activa, ↑/↓ la mueven, Enter
 * ejecuta (con una acción simulada y con la real), lo deshabilitado no se ejecuta y dice por qué, Tab completa, Esc la
 * cierra y el foco vuelve; ninguna tecla llega a los atajos del replay; el botón del dock (iPad); los huecos.
 * Momentos (ítem 14b) con una carrera sintética sobre el fixture y los botones de salto del dock montados (su servicio):
 * «siguiente adelantamiento» llega 5 s antes y elige al que adelanta, con «Estimado» y sin spoilers; «siguiente duelo»
 * compara al perseguidor con el de delante. «seguir ver» no ofrece «Comparar con «seguir»».
 * Sin bucle de frames (requestAnimationFrame sustituido: el estado grueso llega con los avisos del reloj).
 */
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
// El hueco de pestañas antes que los botones de salto: estos leen «Sin spoilers» de la hoja (useAnalysis), que importa
// las pestañas, y cada pestaña usa la hoja.
import '~/slots/analysis-tabs'
import TzJumpButtons from '~/components/replay-dock/TzJumpButtons.vue'
import TzPaletteButton from '~/components/replay-dock/TzPaletteButton.vue'
import TzCommandPalette from '~/components/replay-overlays/TzCommandPalette.vue'
import { useAnalysis } from '~/composables/useAnalysis'
import type { LoadedSession } from '~/data/types'
import { JUMP_LEAD_MS } from '~/engine/moments/jumps'
import { registerCommandService } from '~/replay/commands'
import { ESC_PRIORITY, handleEscape, registerEscape, runShortcut } from '~/replay/keys'
import { createReplayRuntime, type ReplayRuntime } from '~/replay/runtime'
import { REPLAY_HEADER, REPLAY_OVERLAYS } from '~/slots/replay'
import { REPLAY_DOCK } from '~/slots/replay-dock'
import { useCompareStore } from '~/stores/compare'
import { usePlaybackStore } from '~/stores/playback'
import { recordingServices } from '~/testing/commands'
import { loadFixture } from '~/testing/fixture'
import { type RaceCar, raceSession } from '~/testing/moments'

let fixture: LoadedSession
let rt: ReplayRuntime
const unmounts: (() => void)[] = []
const offs: (() => void)[] = []

beforeEach(async () => {
  fixture ??= await loadFixture()
  vi.stubGlobal('requestAnimationFrame', () => 0)
  vi.stubGlobal('cancelAnimationFrame', () => {})
  rt = createReplayRuntime(fixture)
  usePlaybackStore().attach(rt)
})
afterEach(() => {
  for (const off of offs.splice(0)) off()
  for (const u of unmounts.splice(0)) u()
  usePlaybackStore().detach()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

async function mountBoth() {
  const palette = await mountSuspended(TzCommandPalette, { attachTo: document.body })
  const button = await mountSuspended(TzPaletteButton, { attachTo: document.body })
  unmounts.push(() => palette.unmount(), () => button.unmount())
}

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)
const $$ = <T extends Element = HTMLElement>(sel: string) => [...document.querySelectorAll<T>(sel)]
const dialog = () => $('[data-testid="command-palette"]')
const input = () => $<HTMLInputElement>('[data-testid="palette-input"]')!
const settle = async () => {
  await nextTick()
  await nextTick()
}
const keydown = (key: string, init: KeyboardEventInit = {}) =>
  new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })

/** Ctrl+K, como lo ve el replay (el registro de teclas, con el foco fuera de un campo). */
async function ctrlK() {
  const handled = runShortcut(keydown('k', { ctrlKey: true }), false)
  await settle()
  return handled
}

async function type(text: string) {
  input().value = text
  input().dispatchEvent(new Event('input', { bubbles: true }))
  await settle()
}

async function press(key: string, init: KeyboardEventInit = {}) {
  const event = keydown(key, init)
  ;(document.activeElement ?? input()).dispatchEvent(event)
  await settle()
  return event
}

/** La opción a la que apunta `aria-activedescendant`. */
const activeOption = () => {
  const idRef = input().getAttribute('aria-activedescendant')
  return idRef ? document.getElementById(idRef) : null
}

describe('abrir y cerrar', () => {
  it('Ctrl+K la abre con el foco en el combobox; Esc la cierra y el foco vuelve', async () => {
    await mountBoth()
    const before = document.createElement('button')
    document.body.append(before)
    before.focus()
    expect(dialog()).toBeNull()

    expect(await ctrlK()).toBe(true)
    expect(dialog()!.getAttribute('role')).toBe('dialog')
    expect(dialog()!.getAttribute('aria-modal')).toBe('true')
    expect(document.activeElement).toBe(input())
    expect(input().getAttribute('role')).toBe('combobox')
    expect(input().getAttribute('aria-controls')).toBe($('[role="listbox"]')!.id)

    await press('Escape')
    expect(dialog()).toBeNull()
    expect(document.activeElement).toBe(before)
  })

  it('«/» la abre; Ctrl+K dentro la cierra; Esc del registro (por encima de la hoja de análisis) también', async () => {
    await mountBoth()
    expect(runShortcut(keydown('/'), false)).toBe(true)
    await settle()
    expect(dialog()).not.toBeNull()
    await press('k', { ctrlKey: true })
    expect(dialog()).toBeNull()

    await ctrlK()
    let analysis = true
    offs.push(registerEscape(ESC_PRIORITY.analysis, { active: () => analysis, run: () => (analysis = false) }))
    expect(handleEscape()).toBe(true)
    await settle()
    expect(dialog()).toBeNull()
    expect(analysis).toBe(true)
  })

  it('no se abre encima de otro diálogo modal (la tarjeta de fin de sesión)', async () => {
    await mountBoth()
    const modal = document.createElement('div')
    modal.setAttribute('role', 'dialog')
    modal.setAttribute('aria-modal', 'true')
    document.body.append(modal)
    expect(await ctrlK()).toBe(false)
    expect(runShortcut(keydown('/'), false)).toBe(false)
    expect(dialog()).toBeNull()
  })

  it('el botón del dock (iPad) la abre y la cierra, con su nombre accesible', async () => {
    await mountBoth()
    const button = $<HTMLButtonElement>('[data-testid="palette-button"]')!
    expect(button.getAttribute('aria-label')).toMatch(/Comandos|Commands/)
    expect(button.getAttribute('aria-haspopup')).toBe('dialog')
    expect(button.getAttribute('aria-expanded')).toBe('false')
    button.focus()
    button.click()
    await settle()
    expect(dialog()).not.toBeNull()
    expect(button.getAttribute('aria-expanded')).toBe('true')
    $<HTMLButtonElement>('[data-testid="palette-close"]')!.click()
    await settle()
    expect(dialog()).toBeNull()
    expect(document.activeElement).toBe(button)
  })
})

describe('combobox y lista', () => {
  it('aria-activedescendant sobre la opción activa (aria-selected); ↑/↓ la mueven en círculo', async () => {
    await mountBoth()
    await ctrlK()
    const options = $$('[role="option"]')
    expect(options.length).toBeGreaterThan(1)
    expect(activeOption()).toBe(options[0])
    expect(options[0]!.getAttribute('aria-selected')).toBe('true')
    expect(options.filter((o) => o.getAttribute('aria-selected') === 'true')).toHaveLength(1)

    expect((await press('ArrowDown')).defaultPrevented).toBe(true)
    expect(activeOption()).toBe($$('[role="option"]')[1])
    await press('ArrowUp')
    await press('ArrowUp')
    const all = $$('[role="option"]')
    expect(activeOption()).toBe(all[all.length - 1])
    // Cada grupo es un `group` con su etiqueta, dentro del listbox.
    for (const g of $$('[role="listbox"] > [role="group"]')) {
      expect(document.getElementById(g.getAttribute('aria-labelledby')!)?.textContent?.trim()).not.toBe('')
    }
  })

  it('Enter ejecuta la sugerencia activa (acción simulada) y cierra', async () => {
    await mountBoth()
    const rec = recordingServices()
    offs.push(registerCommandService('playback', rec.services.playback))
    await ctrlK()
    await type('seguir nor')
    expect(activeOption()!.dataset.key).toBe('drivers.follow.1')
    expect(activeOption()!.textContent).toMatch(/Lando Norris/)
    await press('Enter')
    expect(rec.calls).toEqual(['select:1', 'follow:true'])
    expect(dialog()).toBeNull()
  })

  it('con la acción real: «x4» pone el reloj a ×4', async () => {
    await mountBoth()
    await ctrlK()
    await type('x4')
    await press('Enter')
    expect(rt.clock.rate).toBe(4)
    expect(usePlaybackStore().rate).toBe(4)
  })

  it('lo deshabilitado dice por qué y Enter no lo ejecuta', async () => {
    await mountBoth()
    await ctrlK()
    await type('seguir xyz')
    const opt = activeOption()!
    expect(opt.getAttribute('aria-disabled')).toBe('true')
    expect(opt.querySelector('[data-testid="palette-reason"]')!.textContent).toMatch(/Sin dato|No data/)
    await press('Enter')
    expect(dialog()).not.toBeNull()
    expect(usePlaybackStore().selectedCar).toBeNull()
  })

  it('en libres, «vuelta 2» pide piloto; Tab completa para escribirlo', async () => {
    await mountBoth()
    await ctrlK()
    await type('vuelta 2')
    expect(activeOption()!.dataset.key).toBe('goto.lap.2.needsDriver')
    const tab = await press('Tab')
    expect(tab.defaultPrevented).toBe(true)
    expect(input().value).toBe('vuelta 2 ')
    expect(document.activeElement).toBe(input())
  })

  it('Tab completa el piloto con su sigla', async () => {
    await mountBoth()
    await ctrlK()
    await type('seguir norr')
    await press('Tab')
    expect(input().value).toBe('seguir NOR ')
  })

  it('sin nada que encaje, lo dice y da ejemplos', async () => {
    await mountBoth()
    await ctrlK()
    await type('qwertyuiop')
    expect($$('[role="option"]')).toHaveLength(0)
    expect(input().getAttribute('aria-expanded')).toBe('false')
    expect($('[data-testid="palette-empty"]')!.textContent).toMatch(/qwertyuiop/)
  })

  it('lo que lleva a un instante enseña qué pasaba entonces (vista previa del timeline)', async () => {
    await mountBoth()
    await ctrlK()
    await type('+30')
    const opt = activeOption()!
    expect(opt.dataset.t).toBe(String(Math.round(rt.clock.timeMs + 30_000)))
    expect($('[data-testid="palette-preview"]')!.dataset.t).toBe(opt.dataset.t)
    expect($('[data-testid="palette-preview-when"]')!.textContent!.trim()).not.toBe('')
  })

  it('ninguna tecla llega a los atajos del replay mientras está abierta', async () => {
    await mountBoth()
    await ctrlK()
    const seen: string[] = []
    const listener = (e: KeyboardEvent) => seen.push(e.key)
    window.addEventListener('keydown', listener)
    offs.push(() => window.removeEventListener('keydown', listener))
    await press('ArrowLeft')
    await press(' ')
    expect(seen).toEqual([])
  })
})

describe('«seguir ver» (fallo visto en las capturas de la Tanda 4)', () => {
  it('solo ofrece seguir a VER: ni «Comparar con «seguir»» ni otra comparación', async () => {
    await mountBoth()
    await ctrlK()
    await type('seguir ver')
    expect(activeOption()!.dataset.key).toBe('drivers.follow.3')
    const keys = $$('[role="option"]').map((o) => o.dataset.key!)
    expect(keys.filter((k) => k.startsWith('compare.'))).toEqual([])
    expect($('[role="listbox"]')!.textContent).not.toMatch(/«seguir»|“seguir”/)
  })
})

describe('momentos (ítem 14b): adelantamientos y duelos', () => {
  /**
   * Como en tests/nuxt/moments.test.ts: VER (3) adelanta a NOR (1) en la vuelta 2 (cruce GPS a S + 90 s, confirmado
   * en la línea a S + 120 s) y desde ahí NOR le sigue a 0,5 s (duelo desde S + 119,5 s, duelo a la tercera vuelta).
   */
  const NOR: RaceCar = { car: 1, lapMs: [60_000, 60_000, 60_000, 60_000, 60_000, 60_000, 60_000, 60_000] }
  const VER: RaceCar = { car: 3, lapMs: [60_500, 59_000, 60_000, 60_000, 60_000, 60_000, 60_000, 60_000] }
  const PASS_AT = 90_000
  const CONFIRMED = 120_000
  const DUEL_START = 119_500
  let S = 0

  async function mountRace() {
    usePlaybackStore().detach()
    rt = createReplayRuntime(raceSession(fixture, [NOR, VER]))
    usePlaybackStore().attach(rt)
    S = rt.clock.startMs
    await mountBoth()
    const jumps = await mountSuspended(TzJumpButtons, { attachTo: document.body })
    unmounts.push(() => jumps.unmount())
  }
  const time = () => usePlaybackStore().timeMs

  it('«siguiente adelantamiento»: 5 s antes de su instante GPS, con «Estimado», sin decir quién; Enter elige al que adelanta', async () => {
    await mountRace()
    await ctrlK()
    await type('siguiente adelantamiento')
    const opt = activeOption()!
    expect(opt.dataset.key).toBe('moments.overtake.next')
    expect(Math.abs(Number(opt.dataset.t) - (S + PASS_AT - JUMP_LEAD_MS))).toBeLessThan(300)
    // «Sin spoilers» (por defecto): la línea aún no lo ha confirmado, así que no dice quién ni a quién.
    expect(opt.textContent).toMatch(/sin spoilers|no spoilers/)
    expect(opt.textContent).not.toMatch(/VER|NOR/)
    expect(opt.querySelector('[data-testid="estimated"][data-field="overtakeTime"]')).not.toBeNull()
    expect(opt.querySelector('.tz-palette__team')).toBeNull()

    await press('Enter')
    expect(dialog()).toBeNull()
    expect(Math.abs(time() - (S + PASS_AT - JUMP_LEAD_MS))).toBeLessThan(300)
    expect(usePlaybackStore().selectedCar).toBe('3')
  })

  it('ya confirmado en la línea (o sin «Sin spoilers»), con nombres', async () => {
    await mountRace()
    rt.clock.seek(S + CONFIRMED + 10_000)
    await settle()
    await ctrlK()
    await type('adelantamiento anterior')
    expect(activeOption()!.dataset.key).toBe('moments.overtake.prev')
    expect(activeOption()!.textContent).toMatch(/V2: VER adelanta a NOR|L2: VER passes NOR/)

    rt.clock.seek(S)
    await settle()
    await type('adelantamientos de NOR')
    expect(activeOption()!.dataset.key).toBe('moments.overtake.next.1')
    expect(activeOption()!.textContent).not.toMatch(/VER adelanta|VER passes/)
    useAnalysis().noSpoilers.value = false
    await settle()
    await type('adelantamientos de nor')
    expect(activeOption()!.textContent).toMatch(/VER adelanta a NOR|VER passes NOR/)
    // Con el piloto escrito, queda elegido ese piloto.
    await press('Enter')
    expect(usePlaybackStore().selectedCar).toBe('1')
  })

  it('«siguiente duelo»: al inicio del duelo (5 s antes), el perseguidor comparado con el de delante', async () => {
    await mountRace()
    await ctrlK()
    await type('siguiente duelo')
    expect(activeOption()!.dataset.key).toBe('moments.duel.next')
    await press('Enter')
    expect(time()).toBe(S + DUEL_START - JUMP_LEAD_MS)
    expect(usePlaybackStore().selectedCar).toBe('1')
    expect(useCompareStore().compareCar).toBe('3')
    expect(useCompareStore().comparing).toBe(true)
  })

  it('en libres (el fixture), deshabilitado: solo en carrera y sprint', async () => {
    await mountBoth()
    const jumps = await mountSuspended(TzJumpButtons, { attachTo: document.body })
    unmounts.push(() => jumps.unmount())
    await ctrlK()
    await type('siguiente adelantamiento')
    const opt = activeOption()!
    expect(opt.dataset.key).toBe('moments.overtake.next')
    expect(opt.getAttribute('aria-disabled')).toBe('true')
    expect(opt.querySelector('[data-testid="palette-reason"]')!.textContent).toMatch(/carrera y sprint|Races and sprints/)
  })
})

describe('huecos', () => {
  it('la paleta va en los superpuestos (entre la tarjeta de fin y la hoja de análisis) y su botón en el dock', () => {
    const overlays = REPLAY_OVERLAYS.map((o) => o.name)
    expect(overlays).toContain('TzCommandPalette')
    expect(overlays.indexOf('TzCommandPalette')).toBeGreaterThan(overlays.indexOf('TzSessionSummary'))
    expect(overlays.indexOf('TzCommandPalette')).toBeLessThan(overlays.indexOf('TzAnalysis'))
    // En el dock, detrás de los saltos entre momentos; en la cabecera partía la fila en el iPad.
    const dock = REPLAY_DOCK.map((d) => d.name)
    expect(dock.indexOf('TzPaletteButton')).toBeGreaterThan(dock.indexOf('TzJumpButtons'))
    expect(REPLAY_HEADER.map((h) => h.name)).not.toContain('TzPaletteButton')
  })
})
