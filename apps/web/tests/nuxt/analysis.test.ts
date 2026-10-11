/**
 * Hoja de análisis (ítem 3, D33) sobre el fixture (Spa 2026, libres 1) y sobre una carrera sintética: el botón de la
 * cabecera la abre y tapa la escena (`rt.setSceneHidden`); Esc la cierra antes que la cámara de seguimiento; en
 * libres abre «Ritmo» y el race trace explica que solo hay en carrera; «Sin spoilers» viene activo y corta los datos
 * en el reloj; sin vueltas, «sin dato»; en carrera, el race trace llega a la vuelta en curso y el ritmo dice que la
 * vuelta 1 no tiene tiempo oficial; los stints se describen con su texto (nunca solo con el color) y saltan a su
 * salida. Sin bucle de frames (requestAnimationFrame sustituido: el estado grueso llega con los avisos del reloj); sin
 * Canvas 2D, las gráficas no pintan, pero su leyenda sí.
 */
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick } from 'vue'
import TzAnalysisChart from '~/components/TzAnalysisChart.vue'
import TzAnalysisButton from '~/components/replay-header/TzAnalysisButton.vue'
import TzAnalysis from '~/components/replay-overlays/TzAnalysis.vue'
import type { ChartSpec } from '~/analysis/chart'
import { useAnalysis } from '~/composables/useAnalysis'
import { stints } from '~/engine/analysis/stints'
import { formatClock } from '~/engine/format/time'
import { clockOrigin } from '~/engine/timeline/markers'
import type { LoadedSession } from '~/data/types'
import { ESC_PRIORITY, handleEscape, registerEscape } from '~/replay/keys'
import { createReplayRuntime, type ReplayRuntime } from '~/replay/runtime'
import { ANALYSIS_TABS, analysisTabs, defaultTab } from '~/slots/analysis-tabs'
import { collectSlot } from '~/slots/collect'
import { usePlaybackStore } from '~/stores/playback'
import { loadFixture } from '~/testing/fixture'
import { rcMessage, timingBuilder } from '~/testing/laps'
import { raceSession as momentsRace } from '~/testing/moments'
import { useReplayShortcuts } from '~/composables/useReplayShortcuts'

/** Callbacks de requestAnimationFrame: nunca se ejecutan (el bucle del runtime no hace falta: el reloj avisa solo). */
let pending: FrameRequestCallback[] = []

let fixture: LoadedSession
let rt: ReplayRuntime
const unmounts: (() => void)[] = []
const offs: (() => void)[] = []

beforeEach(async () => {
  fixture ??= await loadFixture()
  pending = []
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => pending.push(cb))
  vi.stubGlobal('cancelAnimationFrame', () => {})
})
afterEach(() => {
  for (const off of offs.splice(0)) off()
  for (const u of unmounts.splice(0)) u()
  usePlaybackStore().detach()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

function attach(session: LoadedSession = fixture) {
  rt = createReplayRuntime(session)
  usePlaybackStore().attach(rt)
}

/** La hoja y su botón, montados en la página (el foco necesita el documento). */
async function mountBoth() {
  const sheet = await mountSuspended(TzAnalysis, { attachTo: document.body })
  const button = await mountSuspended(TzAnalysisButton, { attachTo: document.body })
  unmounts.push(() => sheet.unmount(), () => button.unmount())
  return { sheet, button }
}

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)
const $$ = <T extends Element = HTMLElement>(sel: string) => [...document.querySelectorAll<T>(sel)]
const sheetEl = () => $('[data-testid="analysis-sheet"]')
const buttonEl = () => $<HTMLButtonElement>('[data-testid="analysis-button"]')!
const settle = async () => {
  await nextTick()
  await nextTick()
}

async function openSheet() {
  buttonEl().focus()
  buttonEl().click()
  await settle()
  expect(sheetEl()).not.toBeNull()
}

async function selectTab(tab: string) {
  $<HTMLButtonElement>(`[data-testid="analysis-tab-${tab}"]`)!.click()
  await settle()
}

/** Carrera sintética con los coches 1 y 3 del fixture, en la ventana de reproducción. */
function raceSession(): LoadedSession {
  const start = fixture.manifest.session.playback.startMs
  const timing = timingBuilder()
    .run(1, start, [100_000, 90_000, 90_000], { lap1NoTime: true, compound: 'MEDIUM', fresh: true, stint: 1, tyreLife: 1 })
    .run(3, start, [101_000, 91_000, 92_000], { lap1NoTime: true, compound: 'HARD', fresh: false, stint: 1, tyreLife: 3 })
    .build()
  const manifest = { ...fixture.manifest, session: { ...fixture.manifest.session, type: 'race' as const } }
  return { ...fixture, manifest, timing }
}

describe('abrir y cerrar', () => {
  it('el botón de la cabecera la abre, tapa la escena y la cierra; Esc la cierra antes que el seguimiento', async () => {
    attach()
    await mountBoth()
    expect(sheetEl()).toBeNull()
    expect(buttonEl().getAttribute('aria-expanded')).toBe('false')
    expect(buttonEl().getAttribute('aria-label')).toMatch(/Análisis|Analysis/)

    await openSheet()
    expect(rt.sceneHidden).toBe(true)
    expect(buttonEl().getAttribute('aria-expanded')).toBe('true')
    expect(sheetEl()!.getAttribute('role')).toBe('dialog')
    // Al abrir, el foco va a la pestaña activa.
    expect(document.activeElement?.getAttribute('role')).toBe('tab')
    expect(document.activeElement?.getAttribute('aria-selected')).toBe('true')

    // Con la cámara de seguimiento puesta, Esc cierra primero la hoja.
    let follow = true
    offs.push(registerEscape(ESC_PRIORITY.follow, { active: () => follow, run: () => (follow = false) }))
    expect(handleEscape()).toBe(true)
    await settle()
    expect(sheetEl()).toBeNull()
    expect(rt.sceneHidden).toBe(false)
    expect(follow).toBe(true)
    // El foco vuelve al botón.
    expect(document.activeElement).toBe(buttonEl())

    // El botón de la hoja y el × también la cierran.
    await openSheet()
    buttonEl().click()
    await settle()
    expect(sheetEl()).toBeNull()
    await openSheet()
    $<HTMLButtonElement>('[data-testid="analysis-close"]')!.click()
    await settle()
    expect(sheetEl()).toBeNull()
    expect(rt.sceneHidden).toBe(false)
  })

  it('al cerrarla con el foco en otro control (el dock), no se lo quita', async () => {
    attach()
    await mountBoth()
    await openSheet()
    const other = document.createElement('button')
    document.body.append(other)
    other.focus()
    useAnalysis().close()
    await settle()
    expect(sheetEl()).toBeNull()
    expect(document.activeElement).toBe(other)
  })

  it('al desechar el runtime con la hoja abierta, la escena no se queda tapada', async () => {
    attach()
    await mountBoth()
    await openSheet()
    const state = useAnalysis()
    state.dispose()
    expect(rt.sceneHidden).toBe(false)
  })

  it('pestañas con flechas, Inicio y Fin (y la flecha no llega al atajo de saltar en el tiempo)', async () => {
    attach()
    await mountBoth()
    await openSheet()
    const tablist = $('[role="tablist"]')!
    const key = (k: string) => {
      const event = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })
      document.activeElement!.dispatchEvent(event)
      return event
    }
    const order = ANALYSIS_TABS.map((x) => x.tab)
    expect(sheetEl()!.dataset.tab).toBe('pace')
    expect(key('ArrowRight').defaultPrevented).toBe(true)
    await settle()
    expect(sheetEl()!.dataset.tab).toBe(order[(order.indexOf('pace') + 1) % order.length])
    expect(document.activeElement?.getAttribute('aria-selected')).toBe('true')
    key('Home')
    await settle()
    expect(sheetEl()!.dataset.tab).toBe(order[0])
    key('End')
    await settle()
    expect(sheetEl()!.dataset.tab).toBe(order[order.length - 1])
    expect(tablist.querySelectorAll('[role="tab"][tabindex="0"]')).toHaveLength(1)
  })
})

describe('coche elegido en la hoja (D49)', () => {
  const chip = () => $('[data-testid="analysis-selection"]')
  const clear = () => $<HTMLButtonElement>('[data-testid="analysis-selection-clear"]')!
  const picker = () => $<HTMLButtonElement>('[data-testid="analysis-selection-picker"]')!
  const list = () => $('[data-testid="analysis-selection-list"]')
  const option = (car: string) => $<HTMLElement>(`[data-testid="analysis-selection-option"][data-car="${car}"]`)!
  const options = () => $$('[data-testid="analysis-selection-option"]')
  /** Una tecla en el elemento con el foco (como el teclado), con los atajos del replay escuchando en la ventana. */
  const press = (key: string) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
    document.activeElement!.dispatchEvent(event)
    return event
  }
  async function withShortcuts() {
    const Shortcuts = defineComponent({
      setup() {
        useReplayShortcuts()
        return () => null
      },
    })
    const w = await mountSuspended(Shortcuts, { attachTo: document.body })
    unmounts.push(() => w.unmount())
  }

  it('el chip dice qué coche está elegido y si la cámara lo sigue; su × lo quita sin cerrar la hoja y el foco va al selector', async () => {
    attach()
    const playback = usePlaybackStore()
    await mountBoth()
    await openSheet()
    // Sin coche elegido, el mismo control deja elegir uno: «Elegir piloto ▾», sin ×.
    expect(chip()!.dataset.car).toBeUndefined()
    expect(picker().textContent!.trim()).toMatch(/^(Elegir piloto|Choose a driver)$/)
    expect(picker().getAttribute('aria-haspopup')).toBe('listbox')
    expect(picker().getAttribute('aria-expanded')).toBe('false')
    expect($('[data-testid="analysis-selection-clear"]')).toBeNull()

    playback.selectCar('16')
    await settle()
    expect(chip()!.getAttribute('role')).toBe('group')
    expect(chip()!.getAttribute('aria-label')).toMatch(/Coche elegido: LEC|Selected car: LEC/)
    expect(chip()!.querySelector('.tz-aselect__label')!.textContent).toMatch(/^(Elegido|Selected)$/)
    expect(chip()!.querySelector('.tz-aselect__tla')!.textContent).toBe('LEC')
    expect(chip()!.querySelector('.tz-aselect__follow')).toBeNull()
    expect(chip()!.dataset.following).toBe('false')
    // El nombre del selector empieza por lo que se ve (WCAG 2.5.3) y dice qué hace.
    expect(picker().getAttribute('aria-label')).toMatch(/^(Elegido LEC: elegir otro piloto o ninguno|Selected LEC: choose another driver or none)$/)
    expect(clear().getAttribute('aria-label')).toMatch(/^(Quitar la selección de LEC|Clear the selection of LEC)$/)

    playback.setFollowing(true)
    await settle()
    expect(chip()!.dataset.following).toBe('true')
    expect(chip()!.textContent).toMatch(/la cámara lo sigue|camera following/)
    expect(picker().getAttribute('aria-label')).toMatch(/^(Elegido LEC · la cámara lo sigue|Selected LEC · camera following)/)
    expect(clear().getAttribute('aria-label')).toMatch(/y dejar de seguirlo|and stop following it/)

    clear().click()
    await settle()
    expect(playback.selectedCar).toBeNull()
    expect(playback.following).toBe(false)
    expect(sheetEl()).not.toBeNull()
    expect(chip()!.dataset.car).toBeUndefined()
    expect($('[data-testid="analysis-selection-clear"]')).toBeNull()
    expect(document.activeElement).toBe(picker())
    expect(picker().textContent!.trim()).toMatch(/^(Elegir piloto|Choose a driver)$/)
  })

  it('el selector: «Ninguno» y cada piloto con su puesto y su muestra; elegir a otro lo destaca y la cámara pasa a seguirlo', async () => {
    attach()
    const playback = usePlaybackStore()
    rt.clock.seek(rt.clock.endMs)
    playback.selectCar('16')
    playback.setFollowing(true)
    await mountBoth()
    await openSheet()
    picker().click()
    await settle()
    // Lista desplegada (listbox con el foco y la opción activa por aria-activedescendant), con el elegido marcado.
    expect(picker().getAttribute('aria-expanded')).toBe('true')
    expect(picker().getAttribute('aria-controls')).toBe(list()!.id)
    expect(list()!.getAttribute('role')).toBe('listbox')
    expect(document.activeElement).toBe(list())
    expect(options()).toHaveLength(rt.drivers.length + 1)
    expect(options()[0]!.dataset.car).toBe('')
    expect(options()[0]!.textContent).toMatch(/Ninguno|None/)
    expect(options()[0]!.textContent).toMatch(/quita la selección y el seguimiento|clears the selection and stops following/)
    expect(options().filter((o) => o.getAttribute('aria-selected') === 'true').map((o) => o.dataset.car)).toEqual(['16'])
    expect(list()!.getAttribute('aria-activedescendant')).toBe(option('16').id)
    // En el orden de la clasificación del instante, con su puesto («P1»…) si se conoce; la sigla y la muestra de equipo.
    const rows = rt.leaderboard.compute(rt.clock.timeMs, rt.model.states)
    expect(options().slice(1).map((o) => o.dataset.car)).toEqual(rows.map((r) => r.car))
    const known = rows.find((r) => r.positionKnown)!
    expect(option(known.car).querySelector('.tz-aselect__pos')!.textContent!.trim()).toBe(`P${known.position}`)
    const unknown = rows.find((r) => !r.positionKnown)
    if (unknown) expect(option(unknown.car).querySelector('.tz-aselect__pos')!.textContent).toMatch(/—\s*(posición sin dato|position: no data)/)
    const ham = rt.drivers.find((d) => d.tla === 'HAM')!
    expect(option(ham.number).querySelector('.tz-aselect__tla')!.textContent).toBe('HAM')
    expect(option(ham.number).querySelector('.tz-aselect__swatch')).not.toBeNull()

    // Otro piloto: elegido, la cámara lo sigue, la lista se cierra y el foco vuelve al selector (sin cerrar la hoja).
    option(ham.number).click()
    await settle()
    expect(playback.selectedCar).toBe(ham.number)
    expect(playback.following).toBe(true)
    expect(list()).toBeNull()
    expect(picker().getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(picker())
    expect(chip()!.dataset.car).toBe(ham.number)
    expect(chip()!.querySelector('.tz-aselect__tla')!.textContent).toBe('HAM')
    expect(sheetEl()).not.toBeNull()
    // Destacado en la gráfica abierta.
    expect($(`[data-testid="pace-chart"] [data-testid="analysis-legend-item"][data-car="${ham.number}"]`)!.classList).toContain('is-emphasis')
    expect($('[data-testid="pace-chart"] [data-testid="analysis-legend-item"][data-car="16"]')!.classList).not.toContain('is-emphasis')

    // Otro clic en el elegido no lo quita.
    picker().click()
    await settle()
    option(ham.number).click()
    await settle()
    expect(playback.selectedCar).toBe(ham.number)
    expect(playback.following).toBe(true)

    // «Ninguno»: como el ×, quita la selección y el seguimiento.
    picker().click()
    await settle()
    option('').click()
    await settle()
    expect(playback.selectedCar).toBeNull()
    expect(playback.following).toBe(false)
    expect(document.activeElement).toBe(picker())
    expect(picker().textContent!.trim()).toMatch(/^(Elegir piloto|Choose a driver)$/)

    // Sin coche elegido, se elige uno desde la hoja.
    picker().click()
    await settle()
    expect(options()[0]!.getAttribute('aria-selected')).toBe('true')
    option('16').click()
    await settle()
    expect(playback.selectedCar).toBe('16')
    expect(playback.following).toBe(false)
  })

  it('el selector con el teclado: ↓ lo abre, ↑/↓, Inicio, Fin y la sigla mueven, Intro elige; Esc lo cierra sin cerrar la hoja; ninguna tecla llega a los atajos', async () => {
    attach()
    const playback = usePlaybackStore()
    playback.selectCar('16')
    playback.setFollowing(true)
    await withShortcuts()
    await mountBoth()
    await openSheet()
    picker().focus()
    expect(press('ArrowDown').defaultPrevented).toBe(true)
    await settle()
    // La flecha abrió la lista (no eligió el coche siguiente).
    expect(playback.selectedCar).toBe('16')
    expect(document.activeElement).toBe(list())
    const ids = options().map((o) => o.id)
    const activeIndex = () => ids.indexOf(list()!.getAttribute('aria-activedescendant')!)
    const start = activeIndex()
    expect(options()[start]!.dataset.car).toBe('16')

    press('ArrowDown')
    await settle()
    expect(activeIndex()).toBe(Math.min(start + 1, ids.length - 1))
    press('Home')
    await settle()
    expect(activeIndex()).toBe(0)
    press('End')
    await settle()
    expect(activeIndex()).toBe(ids.length - 1)
    const lastCar = options()[ids.length - 1]!.dataset.car!
    press('ArrowDown')
    await settle()
    expect(activeIndex()).toBe(ids.length - 1)

    // Ni el tiempo, ni la velocidad, ni el play: ninguna tecla sale de la lista.
    const t0 = rt.clock.timeMs
    const rate = rt.clock.rate
    expect(press('ArrowLeft').defaultPrevented).toBe(false)
    press('3')
    // El espacio elige la opción activa (la última) y cierra la lista.
    press(' ')
    await settle()
    expect(rt.clock.timeMs).toBe(t0)
    expect(rt.clock.rate).toBe(rate)
    expect(rt.clock.playing).toBe(false)
    expect(list()).toBeNull()
    expect(playback.selectedCar).toBe(lastCar)
    expect(playback.following).toBe(true)
    expect(document.activeElement).toBe(picker())

    // Teclear la sigla: la siguiente que empieza por esa letra (otra vez la misma letra, la siguiente).
    const ver = rt.drivers.find((d) => d.tla === 'VER')!
    press('ArrowUp')
    await settle()
    expect(document.activeElement).toBe(list())
    press('v')
    await settle()
    const active = document.getElementById(list()!.getAttribute('aria-activedescendant')!)!
    expect(active.querySelector('.tz-aselect__tla')!.textContent!.startsWith('V')).toBe(true)
    // Otra «v» pasa a la siguiente que empieza por V (si hay más de una) hasta llegar a VER.
    for (let k = 0; k < rt.drivers.length && document.getElementById(list()!.getAttribute('aria-activedescendant')!)!.dataset.car !== ver.number; k++) {
      press('v')
      await settle()
    }
    press('Enter')
    await settle()
    expect(playback.selectedCar).toBe(ver.number)

    // Esc cierra la lista sin elegir, el foco vuelve al selector y la hoja sigue abierta; otro Esc ya cierra la hoja.
    press('ArrowUp')
    await settle()
    expect(document.activeElement).toBe(list())
    expect(press('Escape').defaultPrevented).toBe(true)
    await settle()
    expect(list()).toBeNull()
    expect(document.activeElement).toBe(picker())
    expect(sheetEl()).not.toBeNull()
    expect(playback.selectedCar).toBe(ver.number)
    expect(playback.following).toBe(true)
    press('Escape')
    await settle()
    expect(sheetEl()).toBeNull()
    expect(playback.following).toBe(true)
  })

  it('un clic fuera de la lista la cierra sin elegir', async () => {
    attach()
    await mountBoth()
    await openSheet()
    picker().click()
    await settle()
    expect(list()).not.toBeNull()
    $('.tz-analysis__title')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await settle()
    expect(list()).toBeNull()
    expect(usePlaybackStore().selectedCar).toBeNull()
  })

  it('en todas las pestañas', async () => {
    attach()
    usePlaybackStore().selectCar('16')
    await mountBoth()
    await openSheet()
    for (const tab of ANALYSIS_TABS.map((x) => x.tab)) {
      await selectTab(tab)
      expect(chip(), tab).not.toBeNull()
    }
  })

  it('Esc sigue cerrando primero la hoja; luego deja de seguir y después quita la selección', async () => {
    attach()
    const playback = usePlaybackStore()
    playback.selectCar('16')
    playback.setFollowing(true)
    // Los Esc del replay (useReplayShortcuts): seguimiento y selección.
    offs.push(registerEscape(ESC_PRIORITY.follow, { active: () => playback.following, run: () => playback.setFollowing(false) }))
    offs.push(registerEscape(ESC_PRIORITY.selection, { active: () => playback.selectedCar !== null, run: () => playback.selectCar(null) }))
    await mountBoth()
    await openSheet()
    expect(handleEscape()).toBe(true)
    await settle()
    expect(sheetEl()).toBeNull()
    expect(playback.following).toBe(true)
    handleEscape()
    expect(playback.following).toBe(false)
    expect(playback.selectedCar).toBe('16')
    handleEscape()
    expect(playback.selectedCar).toBeNull()
  })

  it('en «Ritmo», al quitarlo, sigue dibujado sin destacar (se congelan los visibles)', async () => {
    attach()
    const playback = usePlaybackStore()
    const withLaps = playback.order.filter((c) => rt.leaderboard.lapTable.cars.has(c))
    const other = withLaps[10]!
    playback.selectCar(other)
    const { sheet } = await mountBoth()
    await openSheet()
    await selectTab('pace')
    const pressed = () =>
      new Set($$('[data-testid="pace-chart"] [data-testid="analysis-legend-item"][aria-pressed="true"]').map((b) => b.dataset.car))
    const before = pressed()
    expect(before.has(other)).toBe(true)
    expect($(`[data-testid="pace-chart"] [data-car="${other}"]`)!.classList).toContain('is-emphasis')
    clear().click()
    await settle()
    expect(pressed()).toEqual(before)
    expect($(`[data-testid="pace-chart"] [data-car="${other}"]`)!.classList).not.toContain('is-emphasis')
    const spec = sheet.findComponent(TzAnalysisChart).props('spec') as ChartSpec
    expect(spec.groups.some((g) => g.emphasis)).toBe(false)
  })

  it('también si se quita desde otra pestaña («Ritmo» sin montar); con la hoja cerrada, «Ritmo» sigue a la selección', async () => {
    attach()
    const playback = usePlaybackStore()
    const withLaps = playback.order.filter((c) => rt.leaderboard.lapTable.cars.has(c))
    const [a, b] = [withLaps[10]!, withLaps[12]!]
    const pressed = () =>
      new Set($$('[data-testid="pace-chart"] [data-testid="analysis-legend-item"][aria-pressed="true"]').map((x) => x.dataset.car))
    // Con la hoja cerrada, quitar la selección no congela nada.
    playback.selectCar(b)
    playback.selectCar(null)
    expect(useAnalysis().shown.value.pace).toBeUndefined()

    playback.selectCar(a)
    await mountBoth()
    await openSheet()
    await selectTab('stints')
    clear().click()
    await settle()
    await selectTab('pace')
    expect(pressed().has(a)).toBe(true)
    expect($(`[data-testid="pace-chart"] [data-car="${a}"]`)!.classList).not.toContain('is-emphasis')
  })

  it('tras la ×, el coche que se elija después también sale en «Ritmo» (destacado) y el quitado sigue sin destacar; al cerrar la hoja, se olvida', async () => {
    attach()
    const playback = usePlaybackStore()
    const withLaps = playback.order.filter((c) => rt.leaderboard.lapTable.cars.has(c))
    const [a, b] = [withLaps[10]!, withLaps[12]!]
    const item = (car: string) => $(`[data-testid="pace-chart"] [data-car="${car}"]`)!
    playback.selectCar(a)
    await mountBoth()
    await openSheet()
    await selectTab('stints')
    clear().click()
    await settle()
    // Como una fila de «Momentos»: elegir otro coche con la hoja abierta.
    playback.selectCar(b)
    await settle()
    await selectTab('pace')
    expect(item(b).getAttribute('aria-pressed')).toBe('true')
    expect(item(b).classList).toContain('is-emphasis')
    expect(item(a).getAttribute('aria-pressed')).toBe('true')
    expect(item(a).classList).not.toContain('is-emphasis')
    // Lo que el usuario elige en la leyenda manda (y conserva a los dos).
    item(withLaps[11]!).click()
    await settle()
    expect(item(withLaps[11]!).getAttribute('aria-pressed')).toBe('true')
    expect(item(a).getAttribute('aria-pressed')).toBe('true')
    expect(item(b).getAttribute('aria-pressed')).toBe('true')

    // Al cerrar la hoja se olvida lo quitado (en otra sesión de la hoja, sin elección del usuario).
    useAnalysis().close()
    await settle()
    expect(useAnalysis().paceKept.value).toEqual([])
  })

  it('al elegir a otro con la hoja abierta, en «Ritmo» el anterior sigue dibujado y el nuevo se ve destacado', async () => {
    attach()
    const playback = usePlaybackStore()
    const withLaps = playback.order.filter((c) => rt.leaderboard.lapTable.cars.has(c))
    const [a, b] = [withLaps[10]!, withLaps[12]!]
    const pressed = () =>
      new Set($$('[data-testid="pace-chart"] [data-testid="analysis-legend-item"][aria-pressed="true"]').map((x) => x.dataset.car))
    playback.selectCar(a)
    await mountBoth()
    await openSheet()
    await selectTab('pace')
    expect(pressed().has(a)).toBe(true)
    expect(pressed().has(b)).toBe(false)
    picker().click()
    await settle()
    option(b).click()
    await settle()
    expect(pressed().has(a)).toBe(true)
    expect(pressed().has(b)).toBe(true)
    expect($(`[data-testid="pace-chart"] [data-car="${b}"]`)!.classList).toContain('is-emphasis')
    expect($(`[data-testid="pace-chart"] [data-car="${a}"]`)!.classList).not.toContain('is-emphasis')
  })

  it('un piloto que el usuario ocultó en la leyenda vuelve a verse al elegirlo (si no, se destacaría oculto)', async () => {
    attach()
    const playback = usePlaybackStore()
    const withLaps = playback.order.filter((c) => rt.leaderboard.lapTable.cars.has(c))
    const top = withLaps[0]!
    await mountBoth()
    await openSheet()
    await selectTab('pace')
    const key = () => $<HTMLButtonElement>(`[data-testid="pace-chart"] [data-testid="analysis-legend-item"][data-car="${top}"]`)!
    expect(key().getAttribute('aria-pressed')).toBe('true')
    key().click()
    await settle()
    expect(key().getAttribute('aria-pressed')).toBe('false')
    picker().click()
    await settle()
    option(top).click()
    await settle()
    expect(playback.selectedCar).toBe(top)
    expect(key().getAttribute('aria-pressed')).toBe('true')
    expect(key().classList).toContain('is-emphasis')
  })
})

describe('pestañas (hueco analysis-tabs)', () => {
  it('race trace, ritmo y neumáticos, en orden; en libres se abre la primera con datos', () => {
    expect(ANALYSIS_TABS.map((x) => x.tab).slice(0, 3)).toEqual(['raceTrace', 'pace', 'stints'])
    expect(ANALYSIS_TABS.find((x) => x.tab === 'raceTrace')!.raceOnly).toBe(true)
    expect(defaultTab(ANALYSIS_TABS, false)).toBe('pace')
    expect(defaultTab(ANALYSIS_TABS, true)).toBe('raceTrace')
  })

  it('contrato: id único y texto obligatorios', async () => {
    const { defineComponent } = await import('vue')
    const c = defineComponent({ render: () => null })
    const ok = { default: c, order: 1, tab: 'a', label: (t: (k: string) => string) => t('analysis.tabs.pace') }
    expect(analysisTabs(collectSlot({ 'x/TzA.vue': ok })).map((x) => x.tab)).toEqual(['a'])
    expect(() => analysisTabs(collectSlot({ 'x/TzA.vue': { ...ok, tab: undefined } }))).toThrow(/TzA\.vue.*tab/)
    expect(() => analysisTabs(collectSlot({ 'x/TzA.vue': ok, 'x/TzB.vue': { ...ok, order: 2 } }))).toThrow(/repetida/)
    expect(() => analysisTabs(collectSlot({ 'x/TzA.vue': { ...ok, label: 'x' } }))).toThrow(/label/)
  })
})

describe('libres (fixture)', () => {
  it('el race trace explica que solo hay en carrera y sprint', async () => {
    attach()
    await mountBoth()
    await openSheet()
    await selectTab('raceTrace')
    expect($('[data-testid="race-trace-only-race"]')!.textContent).toMatch(/carrera y sprint|races and sprints/)
    expect($('[data-testid="race-trace-chart"]')).toBeNull()
  })

  it('«Sin spoilers» activo por defecto: los stints y el ritmo se cortan en el reloj; desactivado, la sesión entera', async () => {
    attach()
    const w = await mountBoth()
    await openSheet()
    const spoilers = $('[data-testid="analysis-spoilers"]')!
    expect(spoilers.getAttribute('role')).toBe('switch')
    expect(spoilers.getAttribute('aria-checked')).toBe('true')

    // Ritmo, por instante (libres): menos puntos hasta el reloj que en la sesión entera.
    const points = () => Number($('[data-testid="pace-chart"]')!.getAttribute('data-points'))
    expect($('[data-testid="pace"]')!.dataset.axis).toBe('time')
    const cut = points()
    expect(cut).toBeGreaterThan(0)
    spoilers.click()
    await settle()
    expect(spoilers.getAttribute('aria-checked')).toBe('false')
    expect(points()).toBeGreaterThan(cut)

    await selectTab('stints')
    const all = $$('[data-testid="stint-bar"]').length
    spoilers.click()
    await settle()
    const upToNow = $$('[data-testid="stint-bar"]').length
    expect(upToNow).toBeGreaterThan(0)
    expect(upToNow).toBeLessThan(all)
    // Al avanzar el reloj, aparecen.
    rt.clock.seek(rt.clock.endMs)
    await settle()
    expect($$('[data-testid="stint-bar"]').length).toBeGreaterThan(upToNow)
    void w
  })

  it('ritmo: por defecto, el coche elegido y los cinco primeros; la leyenda (con siglas) muestra y oculta', async () => {
    attach()
    const playback = usePlaybackStore()
    const withLaps = playback.order.filter((c) => rt.leaderboard.lapTable.cars.has(c))
    const top = withLaps.slice(0, 5)
    const other = withLaps[10]!
    playback.selectCar(other)
    const { sheet } = await mountBoth()
    await openSheet()
    const pressed = () =>
      $$('[data-testid="pace-chart"] [data-testid="analysis-legend-item"][aria-pressed="true"]').map((b) => b.dataset.car)
    expect(new Set(pressed())).toEqual(new Set([...top, other]))
    // Cada entrada de la leyenda lleva la sigla del piloto (no solo un color).
    const tla = rt.drivers.find((d) => d.number === other)!.tla
    expect($(`[data-testid="pace-chart"] [data-car="${other}"]`)!.textContent!.trim()).toBe(tla)
    $<HTMLButtonElement>(`[data-testid="pace-chart"] [data-car="${other}"]`)!.click()
    await settle()
    expect(pressed()).not.toContain(other)
    // El coche elegido va destacado en la gráfica.
    const chart = sheet.findComponent(TzAnalysisChart)
    const spec = chart.props('spec') as ChartSpec
    expect(spec.groups.find((g) => g.key === other)!.emphasis).toBe(true)
    expect(spec.groups.filter((g) => g.emphasis)).toHaveLength(1)
  })

  it('el eje por hora (ritmo y neumáticos) se rotula con el reloj del dock, no con la hora interna de la sesión', async () => {
    attach()
    const s = rt.session.manifest.session
    const origin = clockOrigin(s.type, rt.session.timing, s.playback)
    // Si el origen fuera 0, la prueba no distinguiría las dos horas.
    expect(formatClock(origin + 90_000)).not.toBe(formatClock(90_000))
    const { sheet } = await mountBoth()
    await openSheet()
    // Ritmo: el eje va en el reloj del dock (sus marcas caen en minutos redondos del reproductor), con la línea del
    // instante actual en el mismo reloj.
    const chart = sheet.findComponent(TzAnalysisChart)
    const spec = chart.props('spec') as ChartSpec
    expect(spec.formatX(90_000)).toBe(formatClock(90_000))
    expect(chart.props('cursorX')).toBe(usePlaybackStore().timeMs - origin)
    expect(spec.xRange![0]).toBeLessThanOrEqual(chart.props('cursorX') as number)
    expect(spec.xRange![1]).toBeGreaterThanOrEqual(chart.props('cursorX') as number)

    // Neumáticos, con la sesión entera: el eje va del primer instante (reproducción o stint) al último.
    await selectTab('stints')
    $('[data-testid="analysis-spoilers"]')!.click()
    await settle()
    const all = stints(rt.leaderboard.lapTable).flatMap((c) => c.stints)
    const lo = Math.min(s.playback.startMs, ...all.map((x) => x.startMs).filter(Number.isFinite))
    const hi = Math.max(s.playback.endMs, ...all.map((x) => x.endMs).filter(Number.isFinite))
    const labels = $$('.tz-stints__axis span').map((e) => e.textContent!.trim())
    expect(labels).toEqual([formatClock(lo - origin), formatClock(hi - origin)])
  })

  it('un clic en una vuelta del ritmo salta a su inicio', async () => {
    attach()
    rt.clock.seek(rt.clock.endMs)
    const { sheet } = await mountBoth()
    await openSheet()
    const chart = sheet.findComponent(TzAnalysisChart)
    const spec = chart.props('spec') as ChartSpec
    // Las x van en el reloj del dock: el instante de sesión es x + origen.
    const s = rt.session.manifest.session
    const origin = clockOrigin(s.type, rt.session.timing, s.playback)
    // La última vuelta que acaba dentro de la reproducción.
    let i = -1
    spec.x.forEach((x, k) => {
      if (x + origin <= rt.clock.endMs && x + origin > rt.clock.startMs + 120_000) i = k
    })
    expect(i).toBeGreaterThan(0)
    chart.vm.$emit('pick', i)
    await settle()
    expect(rt.clock.timeMs).toBeLessThan(spec.x[i]! + origin)
    expect(rt.clock.timeMs).toBeGreaterThanOrEqual(rt.clock.startMs)
  })

  it('stints: nombre con piloto, compuesto, vueltas, edad del juego y nuevo/usado; pulsar uno salta a su salida', async () => {
    attach()
    await mountBoth()
    await openSheet()
    await selectTab('stints')
    const bars = $$<HTMLButtonElement>('[data-testid="stint-bar"]')
    expect(bars.length).toBeGreaterThan(0)
    for (const b of bars) {
      const text = b.getAttribute('aria-label')!
      const tla = rt.drivers.find((d) => d.number === b.closest<HTMLElement>('[data-car]')!.dataset.car)!.tla
      expect(text.startsWith(`${tla}:`)).toBe(true)
      expect(text).toMatch(/(vueltas? \d+|laps? \d+)/)
      expect(text).toMatch(/(juego con|edad del juego: sin dato|set with|set age: no data)/)
      expect(text).toMatch(/(nuevo|usado|sin dato|new|used|no data)/)
      expect(b.getAttribute('title')).toBe(text)
    }
    // TyreLife puede incluir otras sesiones: lo dice la pista ⓘ.
    expect($('[data-testid="stints-tyre-life-hint"]')).not.toBeNull()
    // El último stint que empieza dentro de la reproducción (hasta el reloj).
    rt.clock.seek(rt.clock.endMs)
    await settle()
    const target = $$<HTMLButtonElement>('[data-testid="stint-bar"]')
      .filter((b) => Number(b.dataset.startMs) > rt.clock.startMs)
      .sort((a, b) => Number(b.dataset.startMs) - Number(a.dataset.startMs))[0]!
    target.click()
    await settle()
    expect(rt.clock.timeMs).toBe(Number(target.dataset.startMs))
  })
})

describe('honestidad', () => {
  it('sin vueltas cronometradas: «sin dato» en cada pestaña', async () => {
    attach({ ...fixture, timing: timingBuilder().build() })
    await mountBoth()
    await openSheet()
    for (const tab of ['pace', 'stints']) {
      await selectTab(tab)
      expect($('[data-testid="analysis-no-laps"]')!.textContent).toMatch(/Sin dato|No data/)
    }
  })

  it('carrera: el race trace llega hasta el reloj; el ritmo dice que la vuelta 1 no tiene tiempo oficial', async () => {
    attach(raceSession())
    const { sheet } = await mountBoth()
    await openSheet()
    expect(sheetEl()!.dataset.tab).toBe('raceTrace')
    // Al principio nadie ha completado una vuelta: nada que dibujar todavía (con «Sin spoilers»).
    expect($('[data-testid="analysis-nothing-yet"]')).not.toBeNull()
    const start = rt.clock.startMs
    rt.clock.seek(start + 195_000)
    await settle()
    let spec = sheet.findComponent(TzAnalysisChart).props('spec') as ChartSpec
    expect(spec.x).toEqual([1, 2])
    // Primero arriba (eje invertido) y en segundos; el 3, a 1 y 2 s.
    expect(spec.yDir).toBe(-1)
    expect(spec.series.find((s) => s.group === '3')!.values).toEqual([1, 2])
    expect(spec.series.find((s) => s.group === '1')!.values).toEqual([0, 0])
    // La línea del instante actual, en la vuelta en curso del primero.
    expect(sheet.findComponent(TzAnalysisChart).props('cursorX')).toBe(3)
    // Sin «Sin spoilers», la carrera entera.
    $('[data-testid="analysis-spoilers"]')!.click()
    await settle()
    spec = sheet.findComponent(TzAnalysisChart).props('spec') as ChartSpec
    expect(spec.x).toEqual([1, 2, 3])

    await selectTab('pace')
    expect($('[data-testid="pace"]')!.dataset.axis).toBe('lap')
    expect($('[data-testid="pace-lap1"]')!.textContent).toMatch(/Vuelta 1|Lap 1/)
    // La nota de «Ritmo» describe su leyenda (plana, con «hasta Vn»), no la del race trace (por grupos, de arriba abajo).
    const note = $('[data-testid="pace-identify"]')!.textContent!
    expect(note).toMatch(/hasta qué vuelta llega|which lap it reaches/)
    expect(note).not.toMatch(/arriba abajo|top-to-bottom|junta aparte|groups them/)
    expect($('[data-testid="pace-no-time"]')!.textContent).toMatch(/2/)
  })

  it('una serie que acaba antes (el coche dejó de pasar por meta) dice en la leyenda hasta qué vuelta llega', async () => {
    const base = { color: '#123456', dash: false, visible: true, emphasis: false }
    const spec: ChartSpec = {
      x: [1, 2, 3, 4],
      series: [
        { group: '1', mark: 'line', values: [0, 0, 0, 0] },
        { group: '18', mark: 'line', values: [3, 4, null, null] },
      ],
      groups: [
        { ...base, key: '1', label: 'AAA' },
        { ...base, key: '18', label: 'BBB', stopped: true },
      ],
      xRange: null,
      yRange: null,
      yDir: -1,
      xIncrs: null,
      formatX: (v) => `V${v}`,
      formatY: String,
    }
    const chart = await mountSuspended(TzAnalysisChart, { props: { spec, cursorX: null, label: 'gráfica', legendLabel: 'pilotos' } })
    unmounts.push(() => chart.unmount())
    const until = chart.findAll('[data-testid="analysis-legend-until"]')
    expect(until).toHaveLength(1)
    expect(chart.find('[data-car="18"]').text()).toMatch(/^BBB\s+(hasta|to) V2$/)
    expect(chart.find('[data-car="1"]').text()).toBe('AAA')
  })

  it('ritmo por hora (solo puntos): la muestra de la leyenda es un punto, y un cuadrado para el segundo piloto de su equipo', async () => {
    attach()
    const { sheet } = await mountBoth()
    await openSheet()
    expect($('[data-testid="pace"]')!.dataset.axis).toBe('time')
    const spec = sheet.findComponent(TzAnalysisChart).props('spec') as ChartSpec
    const second = spec.groups.find((g) => g.dash)!
    const first = spec.groups.find((g) => !g.dash)!
    const swatch = (car: string) => $(`[data-testid="pace-chart"] [data-car="${car}"] .tz-achart__swatch`)!.classList
    expect(swatch(first.key).contains('is-point')).toBe(true)
    expect(swatch(first.key).contains('is-dash')).toBe(false)
    expect(swatch(second.key).contains('is-point')).toBe(true)
    expect(swatch(second.key).contains('is-dash')).toBe(true)
  })
})

describe('leyenda del race trace por grupos y ficha desde la leyenda (D49)', () => {
  /** NOR y VER acaban; ALB deja de cruzar tras la 3 y BOR y PER tras la 2 (BOR antes). El resto del manifest, sin vueltas. */
  function groupsRace(): LoadedSession {
    const S = fixture.manifest.session.playback.startMs
    return momentsRace(
      fixture,
      [
        { car: 1, lapMs: [60_000, 60_000, 60_000, 60_000, 60_000] },
        { car: 3, lapMs: [61_200, 60_000, 60_000, 60_000, 60_000] },
        { car: 23, lapMs: [62_000, 60_000, 60_000] },
        { car: 5, lapMs: [63_000, 60_000] },
        { car: 11, lapMs: [64_000, 60_000] },
      ],
      { raceControl: [rcMessage(S + 100_000, 'incident', 'TURN 1 INCIDENT INVOLVING CAR 23 (ALB) NOTED', ['23'])] },
    )
  }

  async function withShortcuts() {
    const Shortcuts = defineComponent({
      setup() {
        useReplayShortcuts()
        return () => null
      },
    })
    const w = await mountSuspended(Shortcuts, { attachTo: document.body })
    unmounts.push(() => w.unmount())
  }

  const groups = () => $$('[data-testid="race-trace-chart"] [data-testid="analysis-legend-group"]')
  const keysOf = (group: string) =>
    $$(`[data-testid="analysis-legend-group"][data-group="${group}"] [data-testid="analysis-legend-item"]`).map((b) => b.dataset.car)

  it('tres grupos con su rótulo: de arriba abajo, los que dejaron de pasar por meta y los que no tienen vueltas', async () => {
    attach(groupsRace())
    useAnalysis().noSpoilers.value = false
    await mountBoth()
    await openSheet()
    expect(groups().map((g) => g.dataset.group)).toEqual(['running', 'stopped', 'noLaps'])
    for (const g of groups()) {
      const label = document.getElementById(g.getAttribute('aria-labelledby')!)!
      expect(g.getAttribute('role')).toBe('group')
      expect(g.contains(label)).toBe(true)
    }
    expect(groups().map((g) => document.getElementById(g.getAttribute('aria-labelledby')!)!.textContent)).toEqual(
      expect.arrayContaining([expect.stringMatching(/De arriba abajo|Top to bottom/)]),
    )
    expect(keysOf('running')).toEqual(['1', '3'])
    // Por última vuelta y luego por su último paso: ALB (V3), BOR y PER (V2; BOR cruzó antes).
    expect(keysOf('stopped')).toEqual(['23', '5', '11'])
    expect($$('[data-group="stopped"] [data-testid="analysis-legend-until"]').map((u) => u.textContent)).toEqual([
      expect.stringMatching(/[VL]3$/),
      expect.stringMatching(/[VL]2$/),
      expect.stringMatching(/[VL]2$/),
    ])
    // Los del manifest sin vueltas: con su nombre, sin botón (no hay serie que mostrar u ocultar).
    const nodata = $$('[data-testid="analysis-legend-nodata"]')
    expect(nodata).toHaveLength(rt.drivers.length - 5)
    expect(nodata.every((n) => n.tagName === 'SPAN')).toBe(true)
    expect($('[data-testid="analysis-legend-nodata"][data-car="18"]')!.textContent!.trim()).toBe('STR')
    // Todos nombrados: tantos nombres como pilotos en el manifest.
    expect(keysOf('running').length + keysOf('stopped').length + nodata.length).toBe(rt.drivers.length)
  })

  it('el coche elegido conserva su entrada destacada en su grupo', async () => {
    attach(groupsRace())
    useAnalysis().noSpoilers.value = false
    usePlaybackStore().selectCar('23')
    await mountBoth()
    await openSheet()
    expect($('[data-group="stopped"] [data-car="23"]')!.classList).toContain('is-emphasis')
  })

  it('con el foco del teclado en un nombre: resalta su serie y enseña su ficha (tooltip descrito por el nombre); Esc la oculta y otro Esc cierra la hoja', async () => {
    attach(groupsRace())
    useAnalysis().noSpoilers.value = false
    await withShortcuts()
    await mountBoth()
    await openSheet()
    const chart = $('[data-testid="race-trace-chart"]')!
    const card = $('[data-testid="analysis-card"]')!
    expect(card.dataset.shown).toBe('false')
    const key = $<HTMLButtonElement>('[data-group="stopped"] [data-car="23"]')!
    key.focus()
    await settle()
    expect(chart.dataset.preview).toBe('23')
    expect(card.dataset.shown).toBe('true')
    expect(card.dataset.mode).toBe('legend')
    expect(card.getAttribute('role')).toBe('tooltip')
    expect(key.getAttribute('aria-describedby')).toBe(card.id)
    expect(card.textContent).toMatch(/ALB/)

    const esc = () => {
      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      document.activeElement!.dispatchEvent(event)
      return event
    }
    expect(esc().defaultPrevented).toBe(true)
    await settle()
    expect(card.dataset.shown).toBe('false')
    expect(chart.dataset.preview).toBeUndefined()
    expect(key.getAttribute('aria-describedby')).toBeNull()
    expect(sheetEl()).not.toBeNull()
    esc()
    await settle()
    expect(sheetEl()).toBeNull()
  })

  it('el círculo de cada nombre elige a su piloto (la cámara pasa a seguirlo); otro clic en el del elegido no lo quita', async () => {
    attach(groupsRace())
    useAnalysis().noSpoilers.value = false
    const playback = usePlaybackStore()
    playback.selectCar('3')
    playback.setFollowing(true)
    await mountBoth()
    await openSheet()
    const ring = (car: string) => $<HTMLButtonElement>(`[data-testid="race-trace-chart"] [data-testid="analysis-legend-pick"][data-pick="${car}"]`)!
    const key = (car: string) => $<HTMLButtonElement>(`[data-testid="race-trace-chart"] [data-testid="analysis-legend-item"][data-car="${car}"]`)!
    // Uno por piloto con serie (los que no tienen vueltas no tienen nada que destacar), fuera del orden de tabulación.
    expect($$('[data-testid="race-trace-chart"] [data-testid="analysis-legend-pick"]').map((b) => b.dataset.pick).sort()).toEqual(
      ['1', '3', '23', '5', '11'].sort(),
    )
    expect(ring('23').tabIndex).toBe(-1)
    expect(ring('23').getAttribute('aria-label')).toMatch(/^(Elegir ALB|Choose ALB)$/)
    expect(ring('23').getAttribute('aria-pressed')).toBe('false')
    expect(ring('3').getAttribute('aria-pressed')).toBe('true')
    ring('23').click()
    await settle()
    expect(playback.selectedCar).toBe('23')
    expect(playback.following).toBe(true)
    expect(ring('23').getAttribute('aria-pressed')).toBe('true')
    expect(ring('3').getAttribute('aria-pressed')).toBe('false')
    expect(key('23').classList).toContain('is-emphasis')
    // Mostrar u ocultar sigue siendo cosa del nombre: elegir no lo cambia.
    expect(key('23').getAttribute('aria-pressed')).toBe('true')
    ring('23').click()
    await settle()
    expect(playback.selectedCar).toBe('23')
    expect($('[data-testid="analysis-selection"]')!.dataset.car).toBe('23')
  })

  it('con el teclado: Intro en un nombre lo elige y espacio lo sigue mostrando u ocultando; la ficha del foco lo dice', async () => {
    attach(groupsRace())
    useAnalysis().noSpoilers.value = false
    const playback = usePlaybackStore()
    await withShortcuts()
    await mountBoth()
    await openSheet()
    const key = $<HTMLButtonElement>('[data-group="stopped"] [data-car="23"]')!
    key.focus()
    await settle()
    const keys = () => $('[data-testid="analysis-card-keys"]')
    expect(keys()!.textContent).toMatch(/^(Intro: elegir ALB · Espacio: mostrar u ocultar|Enter: choose ALB · Space: show or hide)$/)
    expect($('[data-testid="analysis-card-chosen"]')).toBeNull()
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    key.dispatchEvent(enter)
    await settle()
    // Intro no llega al clic del botón (que lo ocultaría): elige.
    expect(enter.defaultPrevented).toBe(true)
    expect(playback.selectedCar).toBe('23')
    expect(key.getAttribute('aria-pressed')).toBe('true')
    expect(document.activeElement).toBe(key)
    expect($('[data-testid="analysis-card"]')!.dataset.car).toBe('23')
    expect($('[data-testid="analysis-card-chosen"]')!.textContent).toMatch(/^(Elegido|Selected)$/)
    expect(keys()!.textContent).toMatch(/^(Espacio: mostrar u ocultar|Space: show or hide)$/)
    // El clic (lo que hace el espacio en un botón) sigue mostrando u ocultando la serie.
    key.click()
    await settle()
    expect(key.getAttribute('aria-pressed')).toBe('false')
    expect(playback.selectedCar).toBe('23')
  })

  it('al perder el foco, la ficha se va', async () => {
    attach(groupsRace())
    useAnalysis().noSpoilers.value = false
    await mountBoth()
    await openSheet()
    const card = $('[data-testid="analysis-card"]')!
    const key = $<HTMLButtonElement>('[data-group="running"] [data-car="3"]')!
    key.focus()
    await settle()
    expect(card.dataset.shown).toBe('true')
    key.blur()
    await settle()
    expect(card.dataset.shown).toBe('false')
  })

  it('Esc con una capa de más prioridad encima (una pista de la guía): primero ella, y la ficha sigue a la vista', async () => {
    attach(groupsRace())
    useAnalysis().noSpoilers.value = false
    await withShortcuts()
    await mountBoth()
    await openSheet()
    const card = $('[data-testid="analysis-card"]')!
    $<HTMLButtonElement>('[data-group="stopped"] [data-car="23"]')!.focus()
    await settle()
    expect(card.dataset.shown).toBe('true')
    let tipsOpen = true
    offs.push(registerEscape(ESC_PRIORITY.tips, { active: () => tipsOpen, run: () => (tipsOpen = false) }))
    const esc = () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    esc()
    await settle()
    expect(tipsOpen).toBe(false)
    expect(card.dataset.shown).toBe('true')
    esc()
    await settle()
    expect(card.dataset.shown).toBe('false')
    expect(sheetEl()).not.toBeNull()
  })

  it('con «Sin spoilers» y sin ver todos los pasos por meta, nadie «Sin vueltas en los datos»: van al final de «De arriba abajo»', async () => {
    attach(groupsRace())
    // A los 130 s: NOR y VER han cruzado la 2; los demás también (nadie se ha detenido aún).
    rt.clock.seek(rt.clock.startMs + 130_000)
    await mountBoth()
    await openSheet()
    expect(groups().map((g) => g.dataset.group)).toEqual(['running'])
    expect($$('[data-testid="analysis-legend-nodata"]')).toHaveLength(0)
    const running = keysOf('running')
    expect(running.slice(0, 5).sort()).toEqual(['1', '11', '23', '3', '5'])
    expect(running).toContain('18')
    expect(running).toHaveLength(rt.drivers.length)
    // Con el reloj al final (todos los pasos a la vista), el grupo aparte.
    rt.clock.seek(rt.clock.endMs)
    await settle()
    expect(groups().map((g) => g.dataset.group)).toEqual(['running', 'stopped', 'noLaps'])
    expect($('[data-testid="analysis-legend-nodata"][data-car="18"]')).not.toBeNull()
  })

  it('al final de la reproducción, con «Sin spoilers», se ve todo: también un paso por meta posterior al final (regla de fin de los datos)', async () => {
    // VER cruza la 5 a los 301,2 s, después del final de la reproducción (300,5 s); ALB dejó de cruzar tras la 3.
    const base = groupsRace()
    const S = base.manifest.session.playback.startMs
    const session = { ...base, manifest: { ...base.manifest, session: { ...base.manifest.session, playback: { ...base.manifest.session.playback, endMs: S + 300_500 } } } }
    attach(session)
    expect(useAnalysis().noSpoilers.value).toBe(true)
    await mountBoth()
    await openSheet()
    rt.clock.seek(S + 300_000)
    await settle()
    expect(useAnalysis().cutoffMs.value).toBe(S + 300_000)
    // NOR va solo dos vueltas por delante del último paso de ALB: aún no cuenta como detenido.
    expect(keysOf('stopped')).not.toContain('23')
    rt.clock.seek(rt.clock.endMs)
    await settle()
    expect(rt.clock.timeMs).toBe(S + 300_500)
    expect(useAnalysis().cutoffMs.value).toBe(Infinity)
    expect(keysOf('stopped')).toEqual(['23', '5', '11'])
  })

  it('mientras el puntero está sobre la leyenda, su orden no cambia; al salir, el nuevo', async () => {
    const base = { color: '#123456', dash: false, visible: true, emphasis: false }
    const spec = (running: string[]): ChartSpec => ({
      x: [1, 2],
      series: running.map((k, i) => ({ group: k, mark: 'line' as const, values: [i, i] })),
      groups: running.map((k) => ({ ...base, key: k, label: `C${k}`.padEnd(3, 'X') })),
      xRange: null,
      yRange: null,
      yDir: -1,
      xIncrs: null,
      formatX: (v) => `V${v}`,
      formatY: String,
      legend: { running, stopped: [], noLaps: [] },
    })
    const chart = await mountSuspended(TzAnalysisChart, { props: { spec: spec(['1', '2', '3']), cursorX: null, label: 'gráfica', legendLabel: 'pilotos' } })
    unmounts.push(() => chart.unmount())
    const order = () => chart.findAll('[data-testid="analysis-legend-item"]').map((b) => b.attributes('data-car'))
    const caption = chart.find('figcaption').element
    expect(order()).toEqual(['1', '2', '3'])
    caption.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }))
    await chart.setProps({ spec: spec(['3', '1', '2']) })
    await settle()
    expect(order()).toEqual(['1', '2', '3'])
    caption.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }))
    await settle()
    expect(order()).toEqual(['3', '1', '2'])
  })

  it('con el dedo: mantener pulsado un nombre de la leyenda fija su ficha (sin mostrar u ocultar); un toque corto lo muestra u oculta', async () => {
    const base = { color: '#123456', dash: false, visible: true, emphasis: false }
    const spec: ChartSpec = {
      x: [1, 2, 3],
      series: [
        { group: '1', mark: 'line', values: [0, 0, 0] },
        { group: '18', mark: 'line', values: [3, null, null] },
      ],
      groups: [
        { ...base, key: '1', label: 'AAA' },
        { ...base, key: '18', label: 'BBB', stopped: true },
      ],
      xRange: null,
      yRange: null,
      yDir: -1,
      xIncrs: null,
      formatX: (v) => `V${v}`,
      formatY: String,
    }
    const chart = await mountSuspended(TzAnalysisChart, {
      props: { spec, cursorX: null, label: 'gráfica', legendLabel: 'pilotos' },
      attachTo: document.body,
    })
    unmounts.push(() => chart.unmount())
    const card = () => chart.find('[data-testid="analysis-card"]').element as HTMLElement
    const key = chart.find('[data-car="18"]').element as HTMLButtonElement
    const touch = (type: string, x = 10) =>
      key.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: true, clientX: x, clientY: 10 }))

    // Toque corto: muestra u oculta, sin ficha.
    touch('pointerdown')
    touch('pointerup')
    key.click()
    await settle()
    expect(chart.emitted('toggle')).toEqual([['18']])
    expect(card().dataset.shown).toBe('false')

    // Pulsación larga: la ficha fija, en la vuelta de su último dato; el clic que la sigue no muestra ni oculta.
    touch('pointerdown')
    await new Promise((r) => setTimeout(r, 600))
    await settle()
    expect(card().dataset.shown).toBe('true')
    expect(card().dataset.mode).toBe('pinned')
    expect(card().textContent).toMatch(/BBB/)
    touch('pointerup')
    key.click()
    await settle()
    expect(chart.emitted('toggle')).toHaveLength(1)

    // Si el dedo se mueve (desplaza la leyenda), no es una pulsación larga.
    ;(chart.find('[data-testid="analysis-card-close"]').element as HTMLButtonElement).click()
    await settle()
    touch('pointerdown')
    touch('pointermove', 40)
    await new Promise((r) => setTimeout(r, 600))
    await settle()
    expect(card().dataset.shown).toBe('false')
  })
})
