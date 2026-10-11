/**
 * Mapa de calor (ítem 2, D32): la herramienta de escena (apagada por defecto, «Velocidad» con su escala y sin
 * «Estimado», «Minisectores» con el recuento de A, B, «igual» y «sin dato» y la etiqueta «Estimado», también en la fila
 * de la escena), lo que falta dicho con palabras, la preferencia por navegador, la vuelta elegida y los huecos donde se
 * montan capa y herramienta, con las banderas siempre por encima del calor.
 */
import { mountSuspended } from '@nuxt/test-utils/runtime'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import TzHeatTool from '~/components/scene-tools/TzHeatTool.vue'
import { renderOrder as drsOrder } from '~/components/scene-layers/TzDrsZones.vue'
import { renderOrder as heatOrder } from '~/components/scene-layers/TzTrackHeat.vue'
import { renderOrder as flagsOrder } from '~/components/TzTrackFlags.vue'
import { HEAT_GAP_MS, HEAT_MINISECTORS } from '~/engine/track/heat'
import { SCENE_LAYERS } from '~/slots/scene-layers'
import { SCENE_TOOLS } from '~/slots/scene-tools'
import { useCompareStore } from '~/stores/compare'
import { useHeatStore } from '~/stores/heat'
import { usePlaybackStore } from '~/stores/playback'
import { useSceneEstimatedStore } from '~/stores/sceneEstimated'
import { heatTestRuntime } from '~/testing/heat'

const KEY = 'trazada.heat'

function attach(type: 'race' | 'fp1' = 'race', estimated: readonly string[] = []) {
  const h = heatTestRuntime(type, estimated)
  usePlaybackStore().attach(h.rt as never)
  return h
}

/** Montados en el caso: se desmontan al acabar (comparten la Pinia de la app y seguirían reaccionando). */
const wrappers: VueWrapper[] = []

/**
 * La herramienta con el runtime de prueba. `mountSuspended` deja activo el Pinia de la app de Nuxt (el que usan los
 * componentes y que comparten todos los casos): después de montar se deja como al empezar y se engancha ahí el runtime.
 */
async function mountTool(type: 'race' | 'fp1' = 'race', estimated: readonly string[] = []) {
  const h = attach(type, estimated)
  const w = await mountSuspended(TzHeatTool)
  wrappers.push(w)
  const heat = useHeatStore()
  heat.setMode('off')
  heat.setPick(null)
  usePlaybackStore().attach(h.rt as never)
  localStorage.clear()
  await nextTick()
  return { h, w }
}

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
})
afterEach(() => {
  for (const w of wrappers.splice(0)) w.unmount()
  usePlaybackStore().detach()
})

const sceneLabels = () => useSceneEstimatedStore().labels.map((l) => l.field)

describe('herramienta del mapa de calor', () => {
  it('apagado por defecto: sin leyenda, sin nota, sin «Estimado» y sin vista', async () => {
    const { w } = await mountTool()
    const tool = w.find('[data-testid="heat-tool"]')
    expect(tool.attributes('data-mode')).toBe('off')
    expect(tool.attributes('data-status')).toBe('off')
    expect(w.find('[data-testid="heat-off"]').attributes('aria-pressed')).toBe('true')
    expect(w.find('[data-testid="heat-legend"]').exists()).toBe(false)
    expect(w.find('[data-testid="heat-note"]').exists()).toBe(false)
    expect(w.find('[data-testid="heat-pick-last"]').exists()).toBe(false)
    expect(w.find('[data-testid="estimated"]').exists()).toBe(false)
    expect(useHeatStore().view).toBeNull()
    expect(sceneLabels()).toEqual([])
  })

  it('velocidad: escala en km/h, «muestreo ~4 Hz», qué vuelta y sin «Estimado» (es dato real); se recuerda', async () => {
    const { h, w } = await mountTool()
    usePlaybackStore().selectCar('2')
    h.coarse(h.seen(2, 3))
    await w.find('[data-testid="heat-speed"]').trigger('click')
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ mode: 'speed', _v: 1 })
    expect(w.find('[data-testid="heat-tool"]').attributes('data-status')).toBe('ok')
    const legend = w.find('[data-testid="heat-legend"]')
    expect(legend.attributes('role')).toBe('group')
    expect(legend.attributes('aria-label')).toBeTruthy()
    // Lo que midió en la vuelta: de 100 a 300 km/h (diente de sierra del runtime de prueba).
    expect(w.find('[data-testid="heat-range"]').text()).toMatch(/^1\d\d–(299|300) km\/h$/)
    expect(legend.text()).toMatch(/(muestreo ~4 Hz|sampled at ~4 Hz)/)
    expect(legend.text()).toMatch(/(sin dato|no data)/)
    // En carrera, por defecto la última vuelta: la 3 de BBB.
    expect(w.find('[data-testid="heat-pick-last"]').attributes('aria-pressed')).toBe('true')
    expect(w.find('[data-testid="heat-laps"]').text()).toMatch(/^BBB · (vuelta|lap) 3 · 1:02[.,]83\d$/)
    expect(w.find('[data-testid="estimated"]').exists()).toBe(false)
    expect(sceneLabels()).toEqual([])

    // «Mejor»: todas iguales, la primera válida (la 2).
    await w.find('[data-testid="heat-pick-best"]').trigger('click')
    expect(w.find('[data-testid="heat-laps"]').text()).toMatch(/(vuelta|lap) 2 ·/)
  })

  it('la vista es la misma mientras no cambia la vuelta, y otra al cerrarse la siguiente', async () => {
    const h = attach()
    usePlaybackStore().selectCar('2')
    h.coarse(h.seen(2, 3))
    const heat = useHeatStore()
    heat.setMode('speed')
    const v = heat.view
    expect(v?.a?.lap).toBe(3)
    h.coarse(h.seen(2, 3) + 30_000)
    expect(heat.view).toBe(v)
    h.coarse(h.seen(2, 4))
    expect(heat.view).not.toBe(v)
    expect(heat.view?.a?.lap).toBe(4)
  })

  it('velocidad sin coche: la más rápida de la sesión, sin elegir vuelta; antes de la primera, lo dice', async () => {
    const { h, w } = await mountTool()
    useHeatStore().setMode('speed')
    h.coarse(1000)
    await nextTick()
    expect(w.find('[data-testid="heat-tool"]').attributes('data-status')).toBe('noLap')
    expect(w.find('[data-testid="heat-note"]').text()).toMatch(
      /^(Aún no hay ninguna vuelta válida completa en la sesión|There is no complete valid lap in the session yet)$/,
    )
    expect(w.find('[data-testid="heat-pick-last"]').exists()).toBe(false)
    h.coarse(h.seen(2, 2))
    await nextTick()
    expect(w.find('[data-testid="heat-laps"]').text()).toMatch(/^(Más rápida de la sesión|Fastest of the session): BBB · (vuelta|lap) 2/)
  })

  it('minisectores: sin comparación, cómo hacerla; con ella, recuento y «Estimado» (también en la fila de la escena)', async () => {
    const { h, w } = await mountTool()
    usePlaybackStore().selectCar('2')
    h.coarse(h.seen(7, 3))
    await w.find('[data-testid="heat-minisectors"]').trigger('click')
    expect(w.find('[data-testid="heat-tool"]').attributes('data-status')).toBe('noPair')
    expect(w.find('[data-testid="heat-note"]').text()).toMatch(/(Mayús\+clic|Shift\+click)/)
    expect(w.find('[data-testid="estimated"]').exists()).toBe(false)
    expect(sceneLabels()).toEqual([])

    useCompareStore().setCompareCar('7')
    await nextTick()
    expect(w.find('[data-testid="heat-tool"]').attributes('data-status')).toBe('ok')
    // BBB va 2 m/s más rápido: gana los 25, con la sigla junto al color (no solo color).
    expect(w.find('[data-testid="heat-count-a"]').text()).toBe(`BBB: ${HEAT_MINISECTORS}`)
    expect(w.find('[data-testid="heat-count-b"]').text()).toBe('GGG: 0')
    expect(w.find('[data-testid="heat-count-tie"]').text()).toMatch(/50 ms\): 0$/)
    expect(w.find('[data-testid="heat-count-none"]').text()).toMatch(/: 0$/)
    expect(w.find('[data-testid="heat-laps"]').text()).toMatch(/^A: BBB · (vuelta|lap) 3 · .+ — B: GGG · (vuelta|lap) 3 · /)
    const tag = w.find('[data-testid="heat-tool"] [data-testid="estimated"][data-field="minisectors"]')
    expect(tag.exists()).toBe(true)
    expect(sceneLabels()).toEqual(['minisectors'])

    // En velocidad no hay nada estimado que etiquetar.
    await w.find('[data-testid="heat-speed"]').trigger('click')
    expect(w.find('[data-testid="estimated"]').exists()).toBe(false)
    expect(sceneLabels()).toEqual([])
    await w.find('[data-testid="heat-minisectors"]').trigger('click')
    expect(sceneLabels()).toEqual(['minisectors'])
    // Al cerrar la comparación (Esc), vuelve la nota.
    useCompareStore().close()
    await nextTick()
    expect(w.find('[data-testid="heat-tool"]').attributes('data-status')).toBe('noPair')
    expect(sceneLabels()).toEqual([])
    useCompareStore().setCompareCar('7')
    await nextTick()
    expect(sceneLabels()).toEqual(['minisectors'])
    wrappers.splice(0).forEach((x) => x.unmount())
    // Sin la herramienta (otra sesión, sin escena), la etiqueta no se queda colgada.
    expect(sceneLabels()).toEqual([])
  })

  it('sin vuelta válida de alguno de los dos, dice de quién', async () => {
    const { h, w } = await mountTool()
    usePlaybackStore().selectCar('2')
    useCompareStore().setCompareCar('7')
    useHeatStore().setMode('minisectors')
    // BBB ya cerró su vuelta 2; GGG, no.
    h.coarse(h.seen(2, 2))
    await nextTick()
    expect(w.find('[data-testid="heat-tool"]').attributes('data-status')).toBe('noLap')
    expect(w.find('[data-testid="heat-note"]').text()).toMatch(/^GGG (aún no tiene|has no)/)
  })

  it('la pista explica la velocidad medida, los huecos de 2 s, los 25 minisectores y la banda de 50 ms', async () => {
    const { w } = await mountTool()
    expect(w.find('[data-testid="heat-hint"]').attributes('aria-label')).toBeTruthy()
    const text = w.find('[data-testid="heat-hint-panel"]').text()
    expect(text).toMatch(/~4 Hz/)
    expect(text).toMatch(/2 s/)
    expect(text).toMatch(/25/)
    expect(text).toMatch(/50 ms/)
    expect(text).toMatch(/(banderas|flags)/)
    expect(text).not.toMatch(/(reconstruida|reconstructed)/)
  })

  it('telemetría reconstruida (manifest de una sesión dev): la velocidad lleva «Estimado», también en la fila de la escena, y la pista lo dice', async () => {
    const { h, w } = await mountTool('race', ['positions', 'telemetry', 'trackStatus'])
    const { t } = useNuxtApp().$i18n
    usePlaybackStore().selectCar('2')
    h.coarse(h.seen(2, 3))
    // Apagado, nada que etiquetar.
    expect(sceneLabels()).toEqual([])
    expect(w.find('[data-testid="estimated"]').exists()).toBe(false)

    await w.find('[data-testid="heat-speed"]').trigger('click')
    expect(w.find('[data-testid="heat-tool"]').attributes('data-status')).toBe('ok')
    expect(useSceneEstimatedStore().labels).toEqual([{ field: 'telemetry' }])
    expect(w.find('[data-testid="heat-tool"] [data-testid="estimated"][data-field="telemetry"]').exists()).toBe(true)
    const text = w.find('[data-testid="heat-hint-panel"]').text()
    expect(text).toContain(t('heat.hintSpeedEstimated', { gap: HEAT_GAP_MS / 1000 }))
    expect(text).not.toMatch(/(midió el coche|as measured by the car)/)

    // Minisectores: el mismo dueño cambia de etiqueta (los dos modos nunca se pintan a la vez).
    useCompareStore().setCompareCar('7')
    h.coarse(h.seen(7, 3))
    await w.find('[data-testid="heat-minisectors"]').trigger('click')
    expect(sceneLabels()).toEqual(['minisectors'])
    expect(w.find('[data-testid="estimated"][data-field="telemetry"]').exists()).toBe(false)
    // De vuelta a velocidad, otra vez la de la telemetría; sin vuelta que pintar (antes de la primera), ninguna.
    await w.find('[data-testid="heat-speed"]').trigger('click')
    expect(sceneLabels()).toEqual(['telemetry'])
    h.coarse(1000)
    await nextTick()
    expect(w.find('[data-testid="heat-tool"]').attributes('data-status')).toBe('noLap')
    expect(sceneLabels()).toEqual([])
    h.coarse(h.seen(2, 3))
    await nextTick()
    expect(sceneLabels()).toEqual(['telemetry'])
    await w.find('[data-testid="heat-off"]').trigger('click')
    expect(sceneLabels()).toEqual([])
  })

  it('preferencia: un modo guardado se recupera; lo inválido o de otra versión, no; la vuelta vuelve a la de por defecto', async () => {
    localStorage.setItem(KEY, JSON.stringify({ mode: 'minisectors', _v: 1 }))
    attach('fp1')
    const heat = useHeatStore()
    heat.hydrate()
    expect(heat.mode).toBe('minisectors')
    // En libres, por defecto la más rápida.
    expect(heat.effectivePick).toBe('best')
    heat.setPick('last')
    expect(heat.effectivePick).toBe('last')
    usePlaybackStore().detach()
    expect(heat.pick).toBeNull()

    setActivePinia(createPinia())
    localStorage.setItem(KEY, JSON.stringify({ mode: 'lava', _v: 1 }))
    useHeatStore().hydrate()
    expect(useHeatStore().mode).toBe('off')
    setActivePinia(createPinia())
    localStorage.setItem(KEY, JSON.stringify({ mode: 'speed' }))
    useHeatStore().hydrate()
    expect(useHeatStore().mode).toBe('off')
  })
})

describe('huecos de la escena', () => {
  it('la herramienta va en «Capas» y la capa en la escena, debajo de las zonas de DRS y de las banderas', () => {
    expect(SCENE_TOOLS.find((g) => g.group === 'layers')!.tools.map((t) => t.name)).toContain('TzHeatTool')
    const layer = SCENE_LAYERS.find((l) => l.name === 'TzTrackHeat')
    expect(layer?.order).toBe(0.5)
    // La seguridad gana al mapa de calor: las banderas (TzTrackFlags) se pintan después y encima.
    expect(heatOrder).toBeLessThan(drsOrder)
    expect(heatOrder).toBeLessThan(flagsOrder)
    expect(heatOrder).toBeGreaterThan(0)
  })
})
