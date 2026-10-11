/**
 * Ambiente (ítem 10, D37): la herramienta de escena (activo por defecto, «No / Sí», fase y altura del sol, aviso de
 * que es decorativo y pista con el cálculo), la escena neutra sin ubicación o sin hora, el estado compartido por
 * runtime (`useSceneAmbience`), su preferencia por navegador y los huecos reales donde se montan capa y herramienta.
 */
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import TzAmbienceTool from '~/components/scene-tools/TzAmbienceTool.vue'
import { createSceneAmbience } from '~/composables/useSceneAmbience'
import type { ReplayRuntime } from '~/replay/runtime'
import { SCENE_LAYERS } from '~/slots/scene-layers'
import { SCENE_TOOLS } from '~/slots/scene-tools'
import { useAmbienceStore } from '~/stores/ambience'
import { usePlaybackStore } from '~/stores/playback'
import { withExt } from '~/testing/runtime'

const KEY = 'trazada.ambience'
/** FP1 de Spa 2026 (el fixture): t0 a las 11:16 UTC; a 4 230 000 ms de sesión son las 12:27 UTC. */
const SPA = { t0Utc: '2026-07-17T11:16:23.172Z', season: 2026, round: 10, slug: 'spa-francorchamps' }
const START_MS = 4_230_000

function fakeRuntime(session: Partial<typeof SPA>, timeMs = START_MS) {
  let frames = 0
  const rt = withExt({
    session: { manifest: { session } },
    clock: { timeMs },
    drivers: [],
    onCoarse: (cb: (s: { timeMs: number; playing: boolean; rate: 1 }) => void) => (cb({ timeMs, playing: false, rate: 1 }), () => {}),
    requestFrame: () => frames++,
    dispose: () => {},
  })
  return { rt: rt as unknown as ReplayRuntime, frames: () => frames }
}

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
})
afterEach(() => {
  usePlaybackStore().detach()
  // El store de la app (el de los componentes montados) se comparte entre tests: se deja como por defecto.
  useAmbienceStore().setOn(true)
})

describe('herramienta de ambiente', () => {
  it('activo por defecto: fase y altura del sol, y que es decorativo; «No» lo apaga y se guarda', async () => {
    usePlaybackStore().attach(fakeRuntime(SPA).rt)
    const w = await mountSuspended(TzAmbienceTool)
    const tool = w.find('[data-testid="ambience-tool"]')
    expect(tool.attributes('data-status')).toBe('ok')
    expect(tool.attributes('data-phase')).toBe('day')
    expect(w.find('[data-testid="ambience-on"]').attributes('aria-pressed')).toBe('true')
    expect(w.find('[data-testid="ambience-sun"]').text()).toMatch(/^(Día · sol a|Day · sun at) (59|60)°$/)
    expect(w.find('[data-testid="ambience-decorative"]').text()).toMatch(
      /^(Decorativo: posición del sol, no el tiempo|Decorative: sun position, not the weather)$/,
    )
    expect(w.find('[data-testid="ambience-note"]').exists()).toBe(false)

    await w.find('[data-testid="ambience-off"]').trigger('click')
    expect(useAmbienceStore().on).toBe(false)
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ on: false, _v: 1 })
    expect(w.find('[data-testid="ambience-off"]').attributes('aria-pressed')).toBe('true')
    expect(w.find('[data-testid="ambience-sun"]').exists()).toBe(false)
    // Sigue diciendo que es decorativo (y se puede volver a encender).
    expect(w.find('[data-testid="ambience-decorative"]').exists()).toBe(true)
  })

  it('la pista explica el cálculo (hora UTC, posición del circuito, NOAA) y que no es el tiempo', async () => {
    usePlaybackStore().attach(fakeRuntime(SPA).rt)
    const w = await mountSuspended(TzAmbienceTool)
    const text = w.find('[data-testid="ambience-hint-panel"]').text()
    expect(text).toMatch(/UTC/)
    expect(text).toMatch(/NOAA/)
    expect(text).toMatch(/bacinger\/f1-circuits/)
    expect(text).toMatch(/(No es el tiempo que hacía|It is not the weather)/)
    expect(text).toMatch(/25 ?%/)
    expect(text).toMatch(/(-6|−6)°/)
  })

  it('de noche: «Noche» y la altura negativa', async () => {
    usePlaybackStore().attach(fakeRuntime({ ...SPA, t0Utc: '2026-07-17T22:00:00Z' }).rt)
    const w = await mountSuspended(TzAmbienceTool)
    expect(w.find('[data-testid="ambience-tool"]').attributes('data-phase')).toBe('night')
    expect(w.find('[data-testid="ambience-sun"]').text()).toMatch(/^(Noche · sol a|Night · sun at) -\d+°$/)
  })

  it('sede desconocida o sin hora: «sin dato», sin botones; la escena se queda neutra', async () => {
    usePlaybackStore().attach(fakeRuntime({ ...SPA, slug: 'atlantis' }).rt)
    const place = await mountSuspended(TzAmbienceTool)
    expect(place.find('[data-testid="ambience-tool"]').attributes('data-status')).toBe('no-location')
    expect(place.find('[data-testid="ambience-note"]').text()).toMatch(/^(Sin dato de ubicación|No location data): /)
    expect(place.find('[data-testid="ambience-on"]').exists()).toBe(false)
    expect(place.find('[data-testid="ambience-sun"]').exists()).toBe(false)
    expect(place.find('[data-testid="ambience-hint-panel"]').text()).toMatch(/bacinger/)

    usePlaybackStore().attach(fakeRuntime({ ...SPA, t0Utc: 'no es una fecha' }).rt)
    const time = await mountSuspended(TzAmbienceTool)
    expect(time.find('[data-testid="ambience-tool"]').attributes('data-status')).toBe('no-time')
    expect(time.find('[data-testid="ambience-note"]').text()).toMatch(/^(Sin dato de hora|No time data): /)
  })

  it('sin runtime no pinta nada', async () => {
    const w = await mountSuspended(TzAmbienceTool)
    expect(w.find('[data-testid="ambience-tool"]').exists()).toBe(false)
  })
})

describe('estado del ambiente por runtime', () => {
  it('lo que pinta la escena cambia por pasos de sol (mismo objeto dentro de un paso); apagado o sin ubicación, null', () => {
    const { rt } = fakeRuntime(SPA)
    const amb = createSceneAmbience(rt)
    expect(amb.status).toBe('ok')
    const a = amb.look(START_MS)!
    expect(a.phase).toBe('day')
    expect(amb.look(START_MS + 1000)).toBe(a) // 1 s de reloj: el sol no cambia de paso
    expect(amb.look(START_MS + 3_600_000)).not.toBe(a)
    amb.enabled = false
    expect(amb.look(START_MS)).toBeNull()
    expect(amb.sunAt(START_MS)!).toBeGreaterThan(55)

    const unknown = createSceneAmbience(fakeRuntime({ ...SPA, slug: 'atlantis' }).rt)
    expect(unknown.status).toBe('no-location')
    expect(unknown.look(START_MS)).toBeNull()
    expect(unknown.sunAt(START_MS)).toBeNull()
    // Un runtime sin manifest (pruebas) tampoco inventa nada.
    expect(createSceneAmbience({ session: {} } as unknown as ReplayRuntime).status).toBe('no-location')
  })

  it('la preferencia llega a la escena y pide un frame; uno por runtime', async () => {
    const fake = fakeRuntime(SPA)
    usePlaybackStore().attach(fake.rt)
    await mountSuspended(TzAmbienceTool)
    const amb = fake.rt.ext('ambience', createSceneAmbience)
    expect(amb.enabled).toBe(true)
    const before = fake.frames()
    useAmbienceStore().setOn(false)
    await nextTick()
    expect(amb.enabled).toBe(false)
    expect(fake.frames()).toBe(before + 1)
  })
})

describe('preferencia de ambiente', () => {
  it('activo por defecto; recupera lo guardado y descarta lo que no entiende', () => {
    const store = useAmbienceStore()
    store.hydrate()
    expect(store.on).toBe(true)

    setActivePinia(createPinia())
    localStorage.setItem(KEY, JSON.stringify({ on: false, _v: 1 }))
    const saved = useAmbienceStore()
    saved.hydrate()
    expect(saved.on).toBe(false)

    for (const raw of [{ on: 'no', _v: 1 }, { on: false, _v: 2 }, { on: false }, 'no json']) {
      setActivePinia(createPinia())
      localStorage.setItem(KEY, typeof raw === 'string' ? raw : JSON.stringify(raw))
      const s = useAmbienceStore()
      s.hydrate()
      expect(s.on, JSON.stringify(raw)).toBe(true)
    }
  })
})

describe('huecos reales', () => {
  it('el cielo es la primera capa de la escena (renderOrder −10) y la herramienta va en «Capas»', () => {
    expect(SCENE_LAYERS[0]?.name).toBe('TzSky')
    expect(SCENE_LAYERS[0]?.order).toBe(-10)
    const layers = SCENE_TOOLS.find((g) => g.group === 'layers')
    expect(layers?.tools.map((t) => t.name)).toContain('TzAmbienceTool')
  })
})
