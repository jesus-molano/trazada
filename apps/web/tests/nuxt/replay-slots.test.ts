/**
 * Huecos por glob (D29) de la página del replay y de la escena, con un componente de prueba en cada uno: la
 * cabecera y los superpuestos solo con el runtime enganchado y en su sitio; las capas de la escena dentro del grupo
 * de la pista, después de los coches y con `model`, `flat` y `yScale`. (`vi.mock` vale para todo el fichero: los
 * huecos reales vacíos se prueban en slots-empty.test.ts.)
 */
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { markRaw, nextTick } from 'vue'
import TzScene from '~/components/TzScene.vue'
import ReplayPage from '~/pages/replay.vue'
import { createReplayRuntime } from '~/replay/runtime'
import { usePlaybackStore } from '~/stores/playback'
import { useSessionStore } from '~/stores/session'
import { useSettingsStore } from '~/stores/settings'
import { loadFixture } from '~/testing/fixture'

/** Componente de prueba: pinta su nombre y, si las recibe, las props de una capa. */
async function fake(name: string, props: string[] = []) {
  const { defineComponent, h } = await import('vue')
  return defineComponent({
    name,
    props: Object.fromEntries(props.map((p) => [p, { type: null, required: true }])),
    setup(p) {
      return () =>
        h('span', {
          'data-fake': name,
          'data-props': props.length ? JSON.stringify({ model: !!p.model, flat: p.flat, yScale: p.yScale }) : undefined,
        })
    },
  })
}

vi.mock('~/slots/replay', async () => {
  const { collectSlot } = await import('~/slots/collect')
  return {
    REPLAY_HEADER: collectSlot({
      'replay-header/TzWeatherChip.vue': { default: await fake('TzWeatherChip'), order: 2 },
      'replay-header/TzAnalysisButton.vue': { default: await fake('TzAnalysisButton'), order: 1 },
    }),
    REPLAY_OVERLAYS: collectSlot({ 'replay-overlays/TzSummaryCard.vue': { default: await fake('TzSummaryCard'), order: 1 } }),
  }
})

vi.mock('~/slots/scene-layers', async () => {
  const { collectSlot } = await import('~/slots/collect')
  return {
    SCENE_LAYERS: collectSlot(
      {
        'scene-layers/TzTrails.vue': { default: await fake('TzTrails', ['model', 'flat', 'yScale']), renderOrder: 4 },
        'scene-layers/TzDrsZones.vue': { default: await fake('TzDrsZones', ['model', 'flat', 'yScale']), renderOrder: -10 },
      },
      'renderOrder',
    ),
  }
})

const fakes = (root: Element) => [...root.querySelectorAll('[data-fake]')].map((e) => e.getAttribute('data-fake'))

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  usePlaybackStore().detach()
  document.body.innerHTML = ''
})

describe('huecos de la página del replay', () => {
  it('cabecera y superpuestos: solo con el runtime enganchado, en orden y en su sitio', async () => {
    const session = useSessionStore()
    // Sin carga real: la página no pasa por «cargando» ni suelta el runtime de prueba.
    vi.spyOn(session, 'load').mockResolvedValue()
    const stubs = Object.fromEntries(
      ['TzSessionNotes', 'TzTrackStatus', 'TzLoadPanel', 'TzLeaderboard', 'TzTelemetry', 'TzRaceControl', 'TzReplayDock', 'TzBench'].map(
        (n) => [n, true],
      ),
    )
    const w = await mountSuspended(ReplayPage, { global: { stubs } })
    expect(w.findAll('[data-fake]')).toHaveLength(0)

    usePlaybackStore().attach(createReplayRuntime(await loadFixture()))
    await nextTick()
    const bar = w.find('header.tz-replay__bar').element
    expect(fakes(bar)).toEqual(['TzAnalysisButton', 'TzWeatherChip'])
    // Entre el estado de pista y las herramientas de la escena (que la escena teletransporta al final).
    const children = [...bar.children]
    const tools = children.findIndex((e) => e.id === 'tz-scene-tools')
    expect(children.findIndex((e) => e.getAttribute('data-fake') === 'TzWeatherChip')).toBe(tools - 1)
    // Los superpuestos van fuera de la cabecera, detrás del dock.
    const page = w.find('.tz-replay').element
    const overlay = page.querySelector('[data-fake="TzSummaryCard"]')!
    expect(overlay.parentElement).toBe(page)
    expect(bar.contains(overlay)).toBe(false)

    usePlaybackStore().detach()
    await nextTick()
    expect(w.findAll('[data-fake]')).toHaveLength(0)
  })
})

describe('capas de la escena', () => {
  it('dentro del grupo de la pista, después de los coches, en orden de renderOrder y con sus props', async () => {
    const data = await loadFixture()
    useSessionStore().data = markRaw(data)
    usePlaybackStore().attach(createReplayRuntime(data))
    // WebGL 2 «disponible» para que la escena monte su lienzo (que aquí es un stub que pinta su contenido).
    const getContext = HTMLCanvasElement.prototype.getContext
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement, kind: string) {
      return kind === 'webgl2' ? ({ getExtension: () => null } as unknown as RenderingContext) : getContext.call(this, kind)
    } as typeof getContext)
    const { defineComponent, h } = await import('vue')
    const TresCanvas = defineComponent({ setup: (_, { slots }) => () => h('div', { 'data-stub': 'canvas' }, slots.default?.()) })
    const stubs = { TresCanvas, TzCameraRig: true, TzTrack: true, TzTrackFlags: true, TzCars: true, TzSceneLabels: true, TzCarLabels: true }
    // Destino de las herramientas de la escena (en la página, la cabecera).
    const tools = document.createElement('div')
    tools.id = 'tz-scene-tools'
    document.body.append(tools)
    const w = await mountSuspended(TzScene, { global: { stubs: { ...stubs, TzSceneTools: true } }, attachTo: document.body })
    await nextTick()

    const layers = w.findAll('[data-fake]')
    expect(layers.map((l) => l.attributes('data-fake'))).toEqual(['TzDrsZones', 'TzTrails'])
    const group = layers[0]!.element.parentElement!
    expect(group.tagName.toLowerCase()).toBe('tresgroup')
    const siblings = [...group.children].map((e) => e.tagName.toLowerCase())
    expect(siblings.indexOf('tz-cars-stub')).toBeLessThan(siblings.indexOf('span'))
    const flat = data.manifest.channels.elevation === 'flat'
    for (const l of layers) {
      expect(JSON.parse(l.attributes('data-props')!)).toEqual({ model: true, flat, yScale: flat ? 1 : useSettingsStore().elevationScale })
    }
    w.unmount()
  })
})
