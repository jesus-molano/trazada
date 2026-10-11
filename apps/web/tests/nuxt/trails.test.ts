/**
 * Estelas (ítem 7): la herramienta de escena (apagadas por defecto, «No / Equipo / Velocidad», leyenda y pista que
 * explica qué es dato; con la telemetría reconstruida del manifest, «Estimado» también en la fila de la escena), su
 * preferencia por navegador y los huecos reales donde se montan capa y herramienta.
 */
import { mountSuspended } from '@nuxt/test-utils/runtime'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import TzHeatTool from '~/components/scene-tools/TzHeatTool.vue'
import TzTrailsTool from '~/components/scene-tools/TzTrailsTool.vue'
import { TRAIL_SPEED_KMH } from '~/engine/replay/trail'
import { MAX_SAMPLE_AGE_MS } from '~/engine/telemetry/telemetry'
import { SCENE_LAYERS } from '~/slots/scene-layers'
import { SCENE_TOOLS } from '~/slots/scene-tools'
import { useHeatStore } from '~/stores/heat'
import { usePlaybackStore } from '~/stores/playback'
import { useSceneEstimatedStore } from '~/stores/sceneEstimated'
import { useTrailsStore } from '~/stores/trails'
import { heatTestRuntime } from '~/testing/heat'

const KEY = 'trazada.trails'

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
})

describe('herramienta de estelas', () => {
  it('apagadas por defecto; cada modo se elige con su botón y se guarda por navegador', async () => {
    const w = await mountSuspended(TzTrailsTool)
    const pressed = () => w.findAll('button[aria-pressed="true"]').map((b) => b.attributes('data-testid'))
    expect(w.findAll('[data-testid^="trails-"][aria-pressed]').map((b) => b.attributes('data-testid'))).toEqual([
      'trails-off',
      'trails-team',
      'trails-speed',
    ])
    expect(pressed()).toEqual(['trails-off'])
    expect(w.find('[data-testid="trails-legend"]').exists()).toBe(false)

    await w.find('[data-testid="trails-team"]').trigger('click')
    expect(pressed()).toEqual(['trails-team'])
    expect(useTrailsStore().mode).toBe('team')
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ mode: 'team', _v: 1 })
    expect(w.find('[data-testid="trails-legend"]').exists()).toBe(false)

    await w.find('[data-testid="trails-speed"]').trigger('click')
    const legend = w.find('[data-testid="trails-legend"]')
    expect(legend.exists()).toBe(true)
    expect(legend.attributes('role')).toBe('group')
    expect(legend.attributes('aria-label')).toBeTruthy()
    expect(legend.text()).toContain(`${TRAIL_SPEED_KMH.min}–${TRAIL_SPEED_KMH.max} km/h`)
    expect(legend.text()).toMatch(/(sin dato|no data)/)

    await w.find('[data-testid="trails-off"]').trigger('click')
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ mode: 'off', _v: 1 })
    expect(w.find('[data-testid="trails-legend"]').exists()).toBe(false)
  })

  it('la pista dice qué es dato: línea central, cortes en los huecos y velocidad sin interpolar de hace ≤ 2 s', async () => {
    const w = await mountSuspended(TzTrailsTool)
    const button = w.find('[data-testid="trails-hint"]')
    expect(button.attributes('aria-label')).toMatch(/(estelas|trails)/i)
    const text = w.find('[data-testid="trails-hint-panel"]').text()
    expect(text).toMatch(/(línea central|centre line)/)
    expect(text).toMatch(/(se corta|stops)/)
    expect(text).toMatch(/(nunca se rellena|never filled in)/)
    expect(text).toMatch(/(sin interpolar|not interpolated)/)
    expect(text).toMatch(/2 s/)
    expect(text).toMatch(/3 s/)
    expect(text).not.toMatch(/(real position|posición real|exact|exacta)/)
  })
})

describe('estelas por velocidad y telemetría reconstruida', () => {
  /** Montados en el caso: se desmontan al acabar (comparten la Pinia de la app y seguirían reaccionando). */
  const wrappers: VueWrapper[] = []
  /** Una sesión con su manifest (`quality.estimated`) y la herramienta montada; las estelas, apagadas. */
  async function mountWith(estimated: readonly string[]) {
    const h = heatTestRuntime('race', estimated)
    usePlaybackStore().attach(h.rt as never)
    const w = await mountSuspended(TzTrailsTool)
    wrappers.push(w)
    useTrailsStore().setMode('off')
    return { h, w }
  }
  const labels = () => useSceneEstimatedStore().labels
  afterEach(() => {
    for (const w of wrappers.splice(0)) w.unmount()
    useTrailsStore().setMode('off')
    useHeatStore().setMode('off')
    usePlaybackStore().detach()
  })

  it('con la telemetría medida: sin «Estimado» y la pista habla de la velocidad medida', async () => {
    const { w } = await mountWith([])
    await w.find('[data-testid="trails-speed"]').trigger('click')
    expect(w.find('[data-testid="trails-legend"]').exists()).toBe(true)
    expect(w.find('[data-testid="estimated"]').exists()).toBe(false)
    expect(labels()).toEqual([])
    const text = w.find('[data-testid="trails-hint-panel"]').text()
    expect(text).toMatch(/(velocidad medida|measured speed)/)
    expect(text).not.toMatch(/(reconstruida|reconstructed)/)
  })

  it('con la telemetría reconstruida (manifest de una sesión dev): por velocidad, «Estimado» junto a la leyenda y en la fila de la escena; la pista lo dice', async () => {
    const { w } = await mountWith(['positions', 'telemetry', 'trackStatus'])
    const { t } = useNuxtApp().$i18n
    const tag = () => w.find('[data-testid="trails-tool"] [data-testid="estimated"][data-field="telemetry"]')
    expect(labels()).toEqual([])
    // Por equipo no se pinta ninguna velocidad: nada que etiquetar.
    await w.find('[data-testid="trails-team"]').trigger('click')
    expect(tag().exists()).toBe(false)
    expect(labels()).toEqual([])

    await w.find('[data-testid="trails-speed"]').trigger('click')
    expect(tag().exists()).toBe(true)
    expect(labels()).toEqual([{ field: 'telemetry' }])
    const text = w.find('[data-testid="trails-hint-panel"]').text()
    expect(text).toContain(t('trails.hintSpeedEstimated', { age: MAX_SAMPLE_AGE_MS / 1000 }))
    expect(text).not.toMatch(/(velocidad medida|measured speed)/)

    await w.find('[data-testid="trails-off"]').trigger('click')
    expect(labels()).toEqual([])
    // Sin la herramienta (otra sesión, sin escena), la etiqueta no se queda colgada.
    await w.find('[data-testid="trails-speed"]').trigger('click')
    expect(labels()).toEqual([{ field: 'telemetry' }])
    wrappers.splice(0).forEach((x) => x.unmount())
    expect(labels()).toEqual([])
  })

  it('mapa de calor y estelas por velocidad a la vez: una sola etiqueta en la escena, mientras pinte alguna de las dos', async () => {
    const { h } = await mountWith(['telemetry'])
    wrappers.push(await mountSuspended(TzHeatTool))
    // La Pinia de la app (la de los componentes) con el runtime, un coche y su vuelta 3 ya vista.
    usePlaybackStore().attach(h.rt as never)
    usePlaybackStore().selectCar('2')
    h.coarse(h.seen(2, 3))
    useHeatStore().setMode('speed')
    useTrailsStore().setMode('speed')
    await nextTick()
    expect(useHeatStore().view?.status).toBe('ok')
    expect(labels()).toEqual([{ field: 'telemetry' }])
    useTrailsStore().setMode('off')
    await nextTick()
    expect(labels()).toEqual([{ field: 'telemetry' }])
    useTrailsStore().setMode('speed')
    useHeatStore().setMode('off')
    await nextTick()
    expect(labels()).toEqual([{ field: 'telemetry' }])
    useTrailsStore().setMode('team')
    await nextTick()
    expect(labels()).toEqual([])
  })
})

describe('preferencia de estelas', () => {
  it('recupera lo guardado y descarta lo que no entiende (otro modo u otra versión del formato)', () => {
    localStorage.setItem(KEY, JSON.stringify({ mode: 'speed', _v: 1 }))
    const store = useTrailsStore()
    store.hydrate()
    expect(store.mode).toBe('speed')

    for (const raw of [{ mode: 'rainbow', _v: 1 }, { mode: 'team', _v: 2 }, { mode: 'team' }, 'no json']) {
      setActivePinia(createPinia())
      localStorage.setItem(KEY, typeof raw === 'string' ? raw : JSON.stringify(raw))
      const s = useTrailsStore()
      s.hydrate()
      expect(s.mode, JSON.stringify(raw)).toBe('off')
    }
  })

  it('una elección hecha antes de hidratar no la pisa lo guardado', () => {
    localStorage.setItem(KEY, JSON.stringify({ mode: 'speed', _v: 1 }))
    const store = useTrailsStore()
    store.setMode('team')
    store.hydrate()
    expect(store.mode).toBe('team')
  })
})

describe('huecos reales', () => {
  it('la capa va en la escena con renderOrder 4 y la herramienta en «Capas»', () => {
    const layer = SCENE_LAYERS.find((l) => l.name === 'TzTrails')
    expect(layer?.order).toBe(4)
    const layers = SCENE_TOOLS.find((g) => g.group === 'layers')
    expect(layers?.tools.map((t) => t.name)).toContain('TzTrailsTool')
  })
})
