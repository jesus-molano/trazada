/**
 * Estelas (ítem 7): la herramienta de escena (apagadas por defecto, «No / Equipo / Velocidad», leyenda y pista que
 * explica qué es dato), su preferencia por navegador y los huecos reales donde se montan capa y herramienta.
 */
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import TzTrailsTool from '~/components/scene-tools/TzTrailsTool.vue'
import { TRAIL_SPEED_KMH } from '~/engine/replay/trail'
import { SCENE_LAYERS } from '~/slots/scene-layers'
import { SCENE_TOOLS } from '~/slots/scene-tools'
import { useTrailsStore } from '~/stores/trails'

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
