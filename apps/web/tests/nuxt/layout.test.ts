/**
 * Diseños del replay (ítem 15): el asa de un panel (teclado, puntero y doble clic), el estado guardado por navegador
 * (stores/layout.ts, D41), el cambio de diseño de la cabecera y las columnas opcionales de la clasificación en
 * «Análisis» (mejor vuelta, última vuelta y entradas en el pit lane), con «—» sin dato y la vuelta 1 estimada solo con
 * la opción y su etiqueta «Estimado».
 */
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { createPinia, getActivePinia, type Pinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import TzLeaderboard from '~/components/TzLeaderboard.vue'
import TzResizeHandle from '~/components/TzResizeHandle.vue'
import TzLayoutSwitch from '~/components/replay-header/TzLayoutSwitch.vue'
import type { LeaderboardRow } from '~/engine/leaderboard/leaderboard'
import { buildTimelineMarkers } from '~/engine/timeline/markers'
import { commandServices } from '~/replay/commands'
import { findShortcut } from '~/replay/keys'
import type { ReplayRuntime } from '~/replay/runtime'
import { LAYOUT_SETTLED_EVENT, RESIZING_ATTR, useLayoutStore } from '~/stores/layout'
import { usePlaybackStore } from '~/stores/playback'
import { useSettingsStore } from '~/stores/settings'
import { sessionEvents, timingBuilder } from '~/testing/laps'
import { testLapTable, withExt } from '~/testing/runtime'

afterEach(() => {
  usePlaybackStore().detach()
  try {
    localStorage.clear()
  } catch {
    // sin almacenamiento
  }
})

/** El asa con su ancho en un ref, como en la página: confirma y restablece. */
function handleHost(initial = 300, edge: 'start' | 'end' = 'end') {
  const value = ref(initial)
  const resets = ref(0)
  const target = document.createElement('div')
  const Host = defineComponent({
    setup: () => () =>
      h(TzResizeHandle, {
        panel: 'lb',
        edge,
        value: value.value,
        min: 280,
        max: 480,
        label: 'Ancho de la clasificación',
        hint: 'Arrastra',
        controls: 'tz-leaderboard',
        target,
        cssVar: '--replay-lb-w',
        onCommit: (w: number) => (value.value = w),
        onReset: () => {
          resets.value++
          value.value = initial
        },
      }),
  })
  return { Host, value, resets, target }
}

describe('asa de un panel (ítem 15)', () => {
  it('es un separador accesible con su ancho, sus límites y lo que controla', async () => {
    const { Host } = handleHost()
    const w = await mountSuspended(Host)
    const sep = w.find('[data-testid="resize-lb"]')
    expect(sep.attributes('role')).toBe('separator')
    expect(sep.attributes('tabindex')).toBe('0')
    expect(sep.attributes('aria-orientation')).toBe('vertical')
    expect(sep.attributes('aria-valuenow')).toBe('300')
    expect(sep.attributes('aria-valuemin')).toBe('280')
    expect(sep.attributes('aria-valuemax')).toBe('480')
    expect(sep.attributes('aria-controls')).toBe('tz-leaderboard')
    expect(sep.attributes('aria-label')).toBe('Ancho de la clasificación')
    expect(sep.attributes('aria-valuetext')).toMatch(/^300 px$/)
  })

  it('con el teclado, ← y → cambian aria-valuenow (Mayús: más), sin pasar de los límites; Inicio, Fin e Intro', async () => {
    const { Host, resets } = handleHost(300, 'end')
    const w = await mountSuspended(Host)
    const sep = () => w.find('[data-testid="resize-lb"]')
    const now = () => Number(sep().attributes('aria-valuenow'))
    await sep().trigger('keydown', { key: 'ArrowRight' })
    expect(now()).toBe(316)
    await sep().trigger('keydown', { key: 'ArrowRight', shiftKey: true })
    expect(now()).toBe(380)
    await sep().trigger('keydown', { key: 'ArrowLeft' })
    expect(now()).toBe(364)
    await sep().trigger('keydown', { key: 'End' })
    expect(now()).toBe(480)
    await sep().trigger('keydown', { key: 'ArrowRight' })
    expect(now()).toBe(480)
    await sep().trigger('keydown', { key: 'Home' })
    expect(now()).toBe(280)
    await sep().trigger('keydown', { key: 'ArrowLeft' })
    expect(now()).toBe(280)
    await sep().trigger('keydown', { key: 'Enter' })
    expect(resets.value).toBe(1)
    expect(now()).toBe(300)
  })

  it('las flechas se atienden en el asa: no llegan a los atajos del replay (no mueven el reloj)', async () => {
    const { Host } = handleHost()
    const w = await mountSuspended(Host)
    const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })
    w.find('[data-testid="resize-lb"]').element.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    // Otra tecla (espacio) sigue su camino.
    const space = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })
    w.find('[data-testid="resize-lb"]').element.dispatchEvent(space)
    expect(space.defaultPrevented).toBe(false)
  })

  it('en el borde izquierdo de un panel (columna derecha), ← lo ensancha', async () => {
    const { Host } = handleHost(300, 'start')
    const w = await mountSuspended(Host)
    await w.find('[data-testid="resize-lb"]').trigger('keydown', { key: 'ArrowLeft' })
    expect(w.find('[data-testid="resize-lb"]').attributes('aria-valuenow')).toBe('316')
  })

  it('al arrastrar escribe el ancho en la variable CSS (sin Vue) y lo confirma al soltar; la escena espera a soltar', async () => {
    const { Host, value, target } = handleHost(300, 'end')
    const w = await mountSuspended(Host)
    const sep = w.find('[data-testid="resize-lb"]')
    let settled = 0
    const onSettled = () => settled++
    window.addEventListener(LAYOUT_SETTLED_EVENT, onSettled)
    await sep.trigger('pointerdown', { button: 0, pointerId: 1, clientX: 100 })
    expect(target.hasAttribute(RESIZING_ATTR)).toBe(true)
    await sep.trigger('pointermove', { pointerId: 1, clientX: 140 })
    expect(target.style.getPropertyValue('--replay-lb-w')).toBe('340px')
    expect(sep.attributes('aria-valuenow')).toBe('340')
    // Nada confirmado aún: ni el estado ni el almacenamiento se enteran por cada movimiento.
    expect(value.value).toBe(300)
    await sep.trigger('pointermove', { pointerId: 1, clientX: 900 })
    expect(target.style.getPropertyValue('--replay-lb-w')).toBe('480px')
    await sep.trigger('pointerup', { pointerId: 1, clientX: 900 })
    expect(value.value).toBe(480)
    expect(target.hasAttribute(RESIZING_ATTR)).toBe(false)
    expect(settled).toBe(1)
    window.removeEventListener(LAYOUT_SETTLED_EVENT, onSettled)
  })

  it('doble clic: el ancho por defecto', async () => {
    const { Host, resets } = handleHost(300)
    const w = await mountSuspended(Host)
    await w.find('[data-testid="resize-lb"]').trigger('dblclick')
    expect(resets.value).toBe(1)
  })
})

describe('estado del diseño por navegador (trazada.layout, D41)', () => {
  // Cada `useLayoutStore(createPinia())` deja esa Pinia como activa: después, la de la app (la que ven los componentes).
  let appPinia: Pinia | undefined
  beforeEach(() => {
    appPinia = getActivePinia() ?? (useNuxtApp().$pinia as Pinia)
  })
  afterEach(() => {
    if (appPinia) setActivePinia(appPinia)
  })

  it('se guarda versionado y se recupera; lo corrupto vuelve al valor por defecto', () => {
    const a = useLayoutStore(createPinia())
    a.hydrate()
    a.setPreset('analysis')
    a.setWidth('side', 400)
    a.setWidth('lb', 9999)
    a.setRcOpen(false)
    const saved = JSON.parse(localStorage.getItem('trazada.layout')!)
    expect(saved._v).toBe(1)
    expect(saved.preset).toBe('analysis')
    expect(saved.presets.analysis).toEqual({ lb: null, side: 400, rcOpen: false })

    const b = useLayoutStore(createPinia())
    b.hydrate()
    expect(b.preset).toBe('analysis')
    expect(b.current).toEqual({ lb: null, side: 400, rcOpen: false })
    expect(b.customized).toBe(true)
    b.resetWidths()
    expect(b.current.side).toBeNull()
    expect(b.customized).toBe(false)

    localStorage.setItem('trazada.layout', JSON.stringify({ _v: 1, preset: 'tv', presets: { spectator: { lb: 'ancho', side: -3 } } }))
    const c = useLayoutStore(createPinia())
    c.hydrate()
    expect(c.preset).toBe('spectator')
    expect(c.current).toEqual({ lb: null, side: null, rcOpen: true })

    // Otra versión del formato: como si no hubiera nada.
    localStorage.setItem('trazada.layout', JSON.stringify({ _v: 99, preset: 'analysis' }))
    const d = useLayoutStore(createPinia())
    d.hydrate()
    expect(d.preset).toBe('spectator')
  })
})

describe('cambio de diseño en la cabecera', () => {
  it('dos opciones con su nombre accesible; la elegida, pulsada; la tecla L y la paleta cambian de diseño', async () => {
    const layout = useLayoutStore()
    layout.setPreset('spectator')
    const w = await mountSuspended(TzLayoutSwitch)
    const group = w.find('[data-testid="layout-switch"]')
    expect(group.attributes('role')).toBe('group')
    const spectator = w.find('[data-testid="layout-spectator"]')
    const analysis = w.find('[data-testid="layout-analysis"]')
    expect(spectator.attributes('aria-label')).toMatch(/^(Espectador|Spectator)$/)
    expect(analysis.attributes('aria-label')).toMatch(/^(Análisis|Analysis)$/)
    expect(spectator.attributes('aria-pressed')).toBe('true')
    await analysis.trigger('click')
    expect(layout.preset).toBe('analysis')
    expect(w.find('[data-testid="layout-analysis"]').attributes('aria-pressed')).toBe('true')

    // Tecla L (registro de atajos del replay).
    const run = findShortcut(new KeyboardEvent('keydown', { key: 'l' }), false)
    expect(run).not.toBeNull()
    run!(new KeyboardEvent('keydown', { key: 'l' }))
    expect(layout.preset).toBe('spectator')

    // Servicio de la paleta (engine/commands/builtin/layout.ts).
    const service = commandServices().layout!
    expect(service.preset).toBe('spectator')
    service.setPreset('analysis')
    expect(layout.preset).toBe('analysis')
    w.unmount()
    expect(commandServices().layout).toBeUndefined()
    layout.setPreset('spectator')
  })

  it('forma compacta (táctil por debajo de 1360 px): un botón que alterna, pulsado con «Análisis», con su nombre y la tecla L', async () => {
    const layout = useLayoutStore()
    layout.setPreset('spectator')
    const w = await mountSuspended(TzLayoutSwitch)
    const toggle = () => w.find('[data-testid="layout-toggle"]')
    expect(toggle().element.tagName).toBe('BUTTON')
    expect(toggle().attributes('aria-label')).toMatch(/^(Diseño «Análisis»|“Analysis” layout)$/)
    expect(toggle().attributes('aria-keyshortcuts')).toBe('L')
    expect(toggle().attributes('title')).toMatch(/Espectador|Spectator/)
    expect(toggle().attributes('aria-pressed')).toBe('false')
    await toggle().trigger('click')
    expect(layout.preset).toBe('analysis')
    expect(toggle().attributes('aria-pressed')).toBe('true')
    // El segmentado y el botón dicen lo mismo (uno de los dos está oculto por CSS según el ancho y el puntero).
    expect(w.find('[data-testid="layout-analysis"]').attributes('aria-pressed')).toBe('true')
    await toggle().trigger('click')
    expect(layout.preset).toBe('spectator')
    expect(toggle().attributes('aria-pressed')).toBe('false')
    w.unmount()
  })
})

describe('columnas opcionales de la clasificación en «Análisis»', () => {
  const driver = (number: string, tla: string) => ({ number, tla, first: '', last: '', team: '', color: '' })
  const row = (car: string, tla: string, position: number, over: Partial<LeaderboardRow> = {}): LeaderboardRow => ({
    car,
    driver: driver(car, tla),
    position,
    positionKnown: true,
    gapMs: null,
    intervalMs: null,
    lapsBehind: 0,
    lap: 2,
    compound: 'MEDIUM',
    tyreLife: null,
    bestLapMs: null,
    inPit: false,
    noSignal: false,
    blueFlag: false,
    ...over,
  })

  /**
   * Carrera con salida a 60 s: el 1 da la vuelta 1 (sin tiempo oficial, hasta 155 s), la 2 en 90 s (entra en boxes a
   * 240 s) y la 3; el 2, dos vueltas; el 3 no tiene ninguna.
   */
  function race() {
    const timing = timingBuilder()
      .run(1, 60_000, [95_000, 90_000, 90_000], {
        lap1NoTime: true,
        each: (i) => (i === 1 ? { pitInMs: 240_000 } : i === 2 ? { pitOutMs: 262_000 } : {}),
      })
      .run(2, 60_000, [96_000, 91_000], { lap1NoTime: true })
      .build()
    const events = sessionEvents()
    const rows = [row('1', 'AAA', 1, { bestLapMs: 90_000 }), row('2', 'BBB', 2), row('3', 'CCC', 3)]
    let coarse: ((s: { timeMs: number; playing: boolean; rate: 1 }) => void) | null = null
    const rt = withExt({
      clock: { timeMs: 0, rate: 1, playing: false },
      model: { states: [] },
      session: {
        manifest: { session: { type: 'race', season: 2026, playback: { startMs: 0, endMs: 600_000, lightsOutMs: 60_000 } } },
        timing,
        events,
      },
      markers: buildTimelineMarkers('race', timing, events, 600_000),
      leaderboard: { compute: () => rows, lapTable: testLapTable('race', timing), race: true },
      drivers: rows.map((r) => r.driver!),
      onFrame: () => () => {},
      onCoarse: (cb: typeof coarse) => {
        coarse = cb
        cb!({ timeMs: 0, playing: false, rate: 1 })
        return () => {}
      },
      requestFrame: () => {},
      dispose: () => {},
    }) as unknown as ReplayRuntime
    const at = async (t: number) => {
      coarse?.({ timeMs: t, playing: false, rate: 1 })
      await nextTick()
    }
    return { rt, at }
  }

  const cell = (w: Awaited<ReturnType<typeof mountSuspended>>, car: string, id: string) => w.find(`[data-car="${car}"] [data-testid="${id}"]`)
  const shown = (w: Awaited<ReturnType<typeof mountSuspended>>, car: string, id: string) =>
    cell(w, car, id).find('[aria-hidden="true"]').text()

  it('en «Espectador» no salen (ni sus rótulos): la clasificación de siempre', async () => {
    const { rt } = race()
    usePlaybackStore().attach(rt)
    const w = await mountSuspended(TzLeaderboard)
    expect(w.find('[data-testid="lb-columns"]').exists()).toBe(false)
    expect(w.find('[data-testid="lb-best"]').exists()).toBe(false)
    expect(w.find('[data-testid="lb-last"]').exists()).toBe(false)
    expect(w.find('[data-testid="lb-pits"]').exists()).toBe(false)
  })

  it('mejor vuelta, última vuelta y entradas en el pit lane, con su rótulo; sin dato, «—» y su título', async () => {
    const { rt, at } = race()
    usePlaybackStore().attach(rt)
    useSettingsStore().setEstimateLap1(false)
    const w = await mountSuspended(TzLeaderboard, { props: { preset: 'analysis' } })
    const heads = w.findAll('[data-testid="lb-columns"] .tz-lb__col').map((c) => c.text())
    expect(heads.slice(1)).toEqual([
      expect.stringMatching(/^(Mejor|Best)$/),
      expect.stringMatching(/^(Última|Last)$/),
      expect.stringMatching(/^Pit$/),
    ])

    await at(200_000)
    // Mejor vuelta: la de la clasificación (dato oficial); sin vuelta válida, «—».
    expect(shown(w, '1', 'lb-best')).toMatch(/^1:30[.,]000$/)
    expect(shown(w, '2', 'lb-best')).toBe('—')
    expect(cell(w, '2', 'lb-best').attributes('title')).toMatch(/(sin dato|no data)/)
    // Última vuelta: la 1 de carrera no trae tiempo oficial (y sin la opción, no se estima).
    expect(shown(w, '1', 'lb-last')).toBe('—')
    expect(cell(w, '1', 'lb-last').attributes('title')).toMatch(/\(1\).*(sin tiempo oficial|no official time)/)
    expect(w.find('[data-testid="lb-estimated"]').exists()).toBe(false)
    // Entradas en el pit lane: 0 antes de la del 1; el 3 no tiene vueltas: sin dato.
    expect(shown(w, '1', 'lb-pits')).toBe('0')
    expect(shown(w, '3', 'lb-pits')).toBe('—')
    expect(cell(w, '3', 'lb-pits').attributes('title')).toMatch(/(sin dato|no data)/)

    await at(250_000)
    expect(shown(w, '1', 'lb-last')).toMatch(/^1:30[.,]000$/)
    expect(cell(w, '1', 'lb-last').attributes('data-lap')).toBe('2')
    expect(shown(w, '1', 'lb-pits')).toBe('1')
    // Cada celda lleva su texto para lectores de pantalla (el visible es decorativo).
    expect(cell(w, '1', 'lb-pits').find('.tz-visually-hidden').text()).toMatch(/1/)
  })

  it('la vuelta 1 solo se estima con la opción, en el color de «Estimado» y con su etiqueta en el pie', async () => {
    const { rt, at } = race()
    usePlaybackStore().attach(rt)
    const settings = useSettingsStore()
    settings.setEstimateLap1(true)
    const w = await mountSuspended(TzLeaderboard, { props: { preset: 'analysis' } })
    await at(200_000)
    // De la salida (60 s) al paso por meta (155 s): 1:35.000, marcada como estimación.
    const last = cell(w, '1', 'lb-last')
    expect(shown(w, '1', 'lb-last')).toMatch(/^1:35[.,]000$/)
    expect(last.attributes('data-estimated')).toBe('true')
    expect(last.classes()).toContain('is-estimated')
    expect(last.attributes('title')).toMatch(/^(Estimado|Estimated)/)
    const tag = w.find('[data-testid="lb-estimated"] [data-testid="estimated"]')
    expect(tag.exists()).toBe(true)
    expect(tag.attributes('data-field')).toBe('lap1')
    // Cuando ya no la enseña ninguna fila (vuelta 2 con tiempo oficial), la etiqueta se va.
    await at(260_000)
    expect(w.find('[data-testid="lb-estimated"]').exists()).toBe(false)
    settings.setEstimateLap1(false)
  })
})
