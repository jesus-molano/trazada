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

  it('el chip dice qué coche está elegido y si la cámara lo sigue; su × lo quita sin cerrar la hoja y lleva el foco a «Sin spoilers»', async () => {
    attach()
    const playback = usePlaybackStore()
    await mountBoth()
    await openSheet()
    expect(chip()).toBeNull()

    playback.selectCar('16')
    await settle()
    expect(chip()!.getAttribute('role')).toBe('group')
    expect(chip()!.getAttribute('aria-label')).toMatch(/Coche elegido: LEC|Selected car: LEC/)
    expect(chip()!.querySelector('.tz-aselect__label')!.textContent).toMatch(/^(Elegido|Selected)$/)
    expect(chip()!.querySelector('.tz-aselect__tla')!.textContent).toBe('LEC')
    expect(chip()!.querySelector('.tz-aselect__follow')).toBeNull()
    expect(chip()!.dataset.following).toBe('false')
    expect(clear().getAttribute('aria-label')).toMatch(/^(Quitar la selección de LEC|Clear the selection of LEC)$/)

    playback.setFollowing(true)
    await settle()
    expect(chip()!.dataset.following).toBe('true')
    expect(chip()!.textContent).toMatch(/la cámara lo sigue|camera following/)
    expect(clear().getAttribute('aria-label')).toMatch(/y dejar de seguirlo|and stop following it/)

    clear().click()
    await settle()
    expect(playback.selectedCar).toBeNull()
    expect(playback.following).toBe(false)
    expect(sheetEl()).not.toBeNull()
    expect(chip()).toBeNull()
    expect(document.activeElement).toBe($('[data-testid="analysis-spoilers"]'))
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
})
