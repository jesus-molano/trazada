/**
 * Zonas de DRS (ítem 11, D38): la herramienta de escena (por qué no hay zonas en 2026, sin canal o sin aperturas;
 * «No / Sí», leyenda y «Estimado» cuando las hay), la etiqueta a la vista en la fila de la escena mientras se pintan,
 * la preferencia por navegador y los huecos reales donde se montan capa y herramienta.
 */
import { mountSuspended } from '@nuxt/test-utils/runtime'
import type { SessionWindow } from '@trazada/schema'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import TzDrsTool from '~/components/scene-tools/TzDrsTool.vue'
import { type DrsZones, noDrsZones } from '~/engine/drs/zones'
import { SCENE_LAYERS } from '~/slots/scene-layers'
import { SCENE_TOOLS } from '~/slots/scene-tools'
import { useDrsStore } from '~/stores/drs'
import { usePlaybackStore } from '~/stores/playback'
import { useSceneEstimatedStore } from '~/stores/sceneEstimated'

const KEY = 'trazada.drs'

const DEDUCED: DrsZones = {
  status: 'deduced',
  spans: Float64Array.from([1200, 1900, 6800, 150]),
  passes: Int32Array.from([73, 41]),
  cars: 18,
  discardedCars: 1,
}
const DRS_WINDOW: SessionWindow = { kind: 'drs', fromMs: 0, toMs: null }

/** Runtime mínimo con lo que lee la herramienta: zonas, temporada y ventanas de dirección de carrera. */
function attach(drsZones: DrsZones, opts: { season?: number; windows?: SessionWindow[] } = {}) {
  usePlaybackStore().attach({
    session: {
      drsZones,
      manifest: { session: { season: opts.season ?? 2024 } },
      events: { windows: opts.windows ?? [DRS_WINDOW] },
    },
    drivers: [],
    onCoarse: (cb: (s: { timeMs: number; playing: boolean; rate: 1 }) => void) => (cb({ timeMs: 0, playing: false, rate: 1 }), () => {}),
    dispose: () => {},
  } as never)
}

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
})
afterEach(() => usePlaybackStore().detach())

const sceneLabels = () => useSceneEstimatedStore().labels.map((l) => l.field)

describe('herramienta de zonas de DRS', () => {
  it('con zonas: visibles por defecto, con leyenda y «Estimado» (también en la fila de la escena); «No» las quita', async () => {
    attach(DEDUCED)
    const w = await mountSuspended(TzDrsTool)
    expect(w.find('[data-testid="drs-tool"]').attributes('data-status')).toBe('deduced')
    expect(w.find('[data-testid="drs-on"]').attributes('aria-pressed')).toBe('true')
    expect(w.find('[data-testid="drs-off"]').attributes('aria-pressed')).toBe('false')
    const legend = w.find('[data-testid="drs-legend"]')
    expect(legend.attributes('role')).toBe('group')
    expect(legend.attributes('aria-label')).toBeTruthy()
    expect(legend.text()).toMatch(/(DRS activado|DRS enabled)/)
    expect(w.find('[data-testid="estimated"][data-field="drsZones"]').exists()).toBe(true)
    expect(w.find('[data-testid="drs-note"]').exists()).toBe(false)
    expect(sceneLabels()).toEqual(['drsZones'])

    await w.find('[data-testid="drs-off"]').trigger('click')
    expect(useDrsStore().show).toBe(false)
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ show: false, _v: 1 })
    expect(w.find('[data-testid="drs-off"]').attributes('aria-pressed')).toBe('true')
    expect(w.find('[data-testid="drs-legend"]').exists()).toBe(false)
    expect(w.find('[data-testid="estimated"][data-field="drsZones"]').exists()).toBe(false)
    expect(sceneLabels()).toEqual([])

    await w.find('[data-testid="drs-on"]').trigger('click')
    expect(sceneLabels()).toEqual(['drsZones'])
    w.unmount()
    // Sin la herramienta (otra sesión, sin escena), la etiqueta no se queda colgada.
    expect(sceneLabels()).toEqual([])
  })

  it('la pista dice que son deducidas, no oficiales, de cuántos coches y qué significa la intensidad', async () => {
    attach(DEDUCED)
    const w = await mountSuspended(TzDrsTool)
    expect(w.find('[data-testid="drs-hint"]').attributes('aria-label')).toMatch(/DRS/)
    const text = w.find('[data-testid="drs-hint-panel"]').text()
    expect(text).toMatch(/(telemetría|telemetry)/)
    expect(text).toMatch(/(no son las líneas oficiales|not the official)/)
    expect(text).toMatch(/18 (coches|cars)/)
    // Los coches con el canal atascado no cuentan, y se dice.
    expect(text).toMatch(/1 (coche con el canal de DRS inverosímil|car with an implausible DRS channel)/)
    expect(text).toMatch(/(dirección de carrera tiene el DRS activado|race control has DRS enabled)/)
    expect(text).toMatch(/(solo se ve en su feed|only shows in its feed)/)
  })

  it('sin ventanas de DRS de dirección de carrera, sin leyenda de intensidad: la pista avisa de que siempre son tenues', async () => {
    attach(DEDUCED, { windows: [] })
    const w = await mountSuspended(TzDrsTool)
    expect(w.find('[data-testid="drs-legend"]').exists()).toBe(false)
    expect(w.find('[data-testid="estimated"][data-field="drsZones"]').exists()).toBe(true)
    expect(w.find('[data-testid="drs-hint-panel"]').text()).toMatch(/(no anunció el DRS|did not announce DRS)/)
  })

  it('2026: ni botones ni «Estimado»; la leyenda dice que no hay datos de zonas', async () => {
    attach(noDrsZones('season'), { season: 2026, windows: [] })
    const w = await mountSuspended(TzDrsTool)
    expect(w.find('[data-testid="drs-tool"]').attributes('data-status')).toBe('season')
    expect(w.find('[data-testid="drs-note"]').text()).toMatch(
      /^(En 2026 no hay datos de zonas ni de modo adelantamiento por coche|In 2026 there is no zone or per-car overtake mode data)$/,
    )
    expect(w.find('[data-testid="drs-on"]').exists()).toBe(false)
    expect(w.find('[data-testid="estimated"]').exists()).toBe(false)
    expect(w.find('[data-testid="drs-hint-panel"]').text()).toMatch(/2026/)
    expect(sceneLabels()).toEqual([])
  })

  it('sin canal o sin aperturas suficientes: «sin dato», con el porqué en la pista', async () => {
    attach(noDrsZones('no-channel'))
    const none = await mountSuspended(TzDrsTool)
    expect(none.find('[data-testid="drs-note"]').text()).toMatch(/^(Sin dato|No data):/)
    expect(none.find('[data-testid="drs-hint-panel"]').text()).toMatch(/(canal|channel)/)
    expect(none.find('[data-testid="estimated"]').exists()).toBe(false)

    attach(noDrsZones('insufficient', 3, 0))
    const few = await mountSuspended(TzDrsTool)
    expect(few.find('[data-testid="drs-note"]').text()).toMatch(/^(Sin dato|No data):/)
    const hint = few.find('[data-testid="drs-hint-panel"]').text()
    expect(hint).toMatch(/3 (pasadas|passes)/)
    expect(hint).toMatch(/2 (coches|cars)/)
    expect(sceneLabels()).toEqual([])
  })

  it('sin runtime no pinta nada', async () => {
    const w = await mountSuspended(TzDrsTool)
    expect(w.find('[data-testid="drs-tool"]').exists()).toBe(false)
  })
})

describe('preferencia de zonas de DRS', () => {
  it('visibles por defecto; recupera lo guardado y descarta lo que no entiende', () => {
    const store = useDrsStore()
    store.hydrate()
    expect(store.show).toBe(true)

    setActivePinia(createPinia())
    localStorage.setItem(KEY, JSON.stringify({ show: false, _v: 1 }))
    const saved = useDrsStore()
    saved.hydrate()
    expect(saved.show).toBe(false)

    for (const raw of [{ show: 'no', _v: 1 }, { show: false, _v: 2 }, { show: false }, 'no json']) {
      setActivePinia(createPinia())
      localStorage.setItem(KEY, typeof raw === 'string' ? raw : JSON.stringify(raw))
      const s = useDrsStore()
      s.hydrate()
      expect(s.show, JSON.stringify(raw)).toBe(true)
    }
  })
})

describe('etiquetas de las capas', () => {
  it('una por campo aunque la declaren dos dueños; se quita al dejar de pintarla', () => {
    const store = useSceneEstimatedStore()
    store.set('a', { field: 'drsZones' })
    store.set('b', { field: 'drsZones' })
    store.set('c', { field: 'minisectors' })
    expect(store.labels.map((l) => l.field)).toEqual(['drsZones', 'minisectors'])
    store.set('a', null)
    expect(store.labels.map((l) => l.field)).toEqual(['drsZones', 'minisectors'])
    store.set('b', null)
    store.set('c', null)
    expect(store.labels).toEqual([])
  })
})

describe('huecos reales', () => {
  it('la capa va en la escena con renderOrder 0,7 (entre el calor y las banderas) y la herramienta en «Capas»', () => {
    expect(SCENE_LAYERS.find((l) => l.name === 'TzDrsZones')?.order).toBe(0.7)
    const layers = SCENE_TOOLS.find((g) => g.group === 'layers')
    expect(layers?.tools.map((t) => t.name)).toContain('TzDrsTool')
    // Antes en el orden de pintado que las estelas (4): las estelas van por encima.
    const names = SCENE_LAYERS.map((l) => l.name)
    expect(names.indexOf('TzDrsZones')).toBeLessThan(names.indexOf('TzTrails'))
  })
})
