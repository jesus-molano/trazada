/**
 * Principio de datos honestos: cada campo del registro de estimaciones se pinta con su etiqueta
 * "Estimado". Hay un caso por campo; si se añade uno al registro sin su caso, este test falla.
 */
import { mountSuspended } from '@nuxt/test-utils/runtime'
import type { VueWrapper } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import TzLapInfo from '~/components/TzLapInfo.vue'
import TzSceneTools from '~/components/TzSceneTools.vue'
import TzTelemetry from '~/components/TzTelemetry.vue'
import TzTrackStatus from '~/components/TzTrackStatus.vue'
import type { LoadedSession } from '~/data/types'
import { ESTIMATED_FIELDS, type EstimatedField } from '~/engine/estimated'
import { createReplayRuntime } from '~/replay/runtime'
import { usePlaybackStore } from '~/stores/playback'
import { useSettingsStore } from '~/stores/settings'
import { fakeTrzb, loadFixture } from '~/testing/fixture'

/** Runtime real sobre el fixture, con `quality.estimated` sustituido. */
async function fixtureRuntime(estimated: string[]) {
  const s = await loadFixture()
  const session: LoadedSession = { ...s, manifest: { ...s.manifest, quality: { ...s.manifest.quality, estimated } } }
  const rt = createReplayRuntime(session)
  usePlaybackStore().attach(rt)
  return rt
}

/** Carrera mínima: vuelta 1 sin tiempo oficial (salida en t = 1000) y vuelta 2 con tiempo. */
function raceRuntime(timeMs: number) {
  const timing = fakeTrzb('timing', {
    laps: {
      car: [1, 1],
      lap: [1, 2],
      startMs: [-1, 91_000],
      endMs: [91_000, 181_000],
      lapMs: [-1, 90_000],
      pitInMs: [-1, -1],
      pitOutMs: [-1, -1],
      position: [1, 1],
      compound: [2, 2],
      deleted: [0, 0],
    },
  })
  usePlaybackStore().attach({
    session: { manifest: { session: { type: 'race', playback: { startMs: 0, endMs: 300_000, lightsOutMs: 1000 } } }, timing },
    drivers: [],
    clock: { timeMs },
    onCoarse: (cb: (s: { timeMs: number; playing: boolean; rate: 1 }) => void) => (cb({ timeMs, playing: false, rate: 1 }), () => {}),
    dispose: () => {},
  } as never)
}

const label = (w: VueWrapper, field: EstimatedField) => w.find(`[data-testid="estimated"][data-field="${field}"]`)

const CASES: Record<EstimatedField, () => Promise<void>> = {
  async elevation() {
    const settings = useSettingsStore()
    settings.setElevationScale(2)
    const w = await mountSuspended(TzSceneTools, { props: { flat: false, estimated: [] } })
    expect(label(w, 'elevation').text()).toMatch(/×2/)
    settings.setElevationScale(1)
    await nextTick()
    expect(label(w, 'elevation').exists()).toBe(false)
    // Plana: no hay exageración posible, ni etiqueta.
    settings.setElevationScale(3)
    const flat = await mountSuspended(TzSceneTools, { props: { flat: true, estimated: [] } })
    expect(label(flat, 'elevation').exists()).toBe(false)
    settings.setElevationScale(1)
  },
  async separation() {
    const settings = useSettingsStore()
    const w = await mountSuspended(TzSceneTools, { props: { flat: false, estimated: [] } })
    expect(label(w, 'separation').exists()).toBe(false)
    await w.find('[data-testid="toggle-separation"]').trigger('click')
    expect(settings.separation).toBe(true)
    expect(label(w, 'separation').exists()).toBe(true)
    settings.setSeparation(false)
  },
  async lap1() {
    raceRuntime(100_000)
    const settings = useSettingsStore()
    settings.setEstimateLap1(false)
    const w = await mountSuspended(TzLapInfo, { props: { car: '1' } })
    expect(w.find('[data-testid="lap-last"]').text()).toBe('—')
    expect(label(w, 'lap1').exists()).toBe(false)
    await w.find('[data-testid="toggle-lap1"]').trigger('click')
    // El tiempo estimado (91 000 − 1000 = 1:30.000) solo aparece junto a su etiqueta.
    expect(w.find('[data-testid="lap-last"]').text()).toMatch(/^1:30[.,]000$/)
    expect(label(w, 'lap1').exists()).toBe(true)
    settings.setEstimateLap1(false)
  },
  async positions() {
    const w = await mountSuspended(TzSceneTools, { props: { flat: false, estimated: ['positions', 'gaps'] } })
    expect(label(w, 'positions').exists()).toBe(true)
    // Un campo que este front no conoce (datos más nuevos) también se marca, con su nombre.
    expect(w.find('[data-testid="estimated"][data-field="gaps"]').text()).toContain('gaps')
  },
  async telemetry() {
    const rt = await fixtureRuntime(['telemetry'])
    usePlaybackStore().selectCar(rt.drivers[0]!.number)
    const w = await mountSuspended(TzTelemetry, { global: { stubs: { TzMiniChart: true } } })
    expect(label(w, 'telemetry').exists()).toBe(true)
    usePlaybackStore().detach()
  },
  async trackStatus() {
    await fixtureRuntime(['trackStatus'])
    const w = await mountSuspended(TzTrackStatus)
    expect(label(w, 'trackStatus').exists()).toBe(true)
    usePlaybackStore().detach()
    await fixtureRuntime([])
    const clean = await mountSuspended(TzTrackStatus)
    expect(clean.find('[data-testid="estimated"]').exists()).toBe(false)
    usePlaybackStore().detach()
  },
}

describe('etiqueta Estimado', () => {
  it('hay un caso por cada campo del registro', () => {
    expect(Object.keys(CASES).sort()).toEqual([...ESTIMATED_FIELDS].sort())
  })

  it.each(ESTIMATED_FIELDS)('%s: se pinta con su etiqueta', async (field) => {
    await CASES[field]()
  })
})
