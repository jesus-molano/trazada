/**
 * Reanudar donde lo dejaste (ítem 13, D41): la página del replay aplica lo guardado (instante, coche, seguimiento y
 * velocidad; `?t=` manda; el bench no lo usa) y lo guarda al salir; el aviso «Retomado en …» y la tarjeta «Seguir
 * viendo» de la portada (solo sesiones del catálogo, estado vacío y olvidar).
 */
import { readFileSync } from 'node:fs'
import type { Catalog } from '@trazada/schema'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, markRaw, nextTick } from 'vue'
import TzContinue from '~/components/TzContinue.vue'
import TzResumeToast from '~/components/replay-overlays/TzResumeToast.vue'
import type { LoadedSession } from '~/data/types'
import { formatClock } from '~/engine/format/time'
import ReplayPage from '~/pages/replay.vue'
import {
  RESUME_EXT,
  RESUME_TOAST_MS,
  type ResumeApplied,
  type ResumeEntry,
  resumeAt,
  resumeEntry,
  resumeInfo,
  resumeStore,
} from '~/replay/resume'
import { createReplayRuntime, defaultInitialMs } from '~/replay/runtime'
import { useCatalogStore } from '~/stores/catalog'
import { getRuntime, usePlaybackStore } from '~/stores/playback'
import { useSessionStore } from '~/stores/session'
import { FIXTURE_FP1, FIXTURE_ROOT, loadFixture } from '~/testing/fixture'

// Solo el aviso en los huecos de la página: otras funciones que añadan los suyos no cambian este test.
vi.mock('~/slots/replay', async () => {
  const { collectSlot } = await import('~/slots/collect')
  const toast = await import('~/components/replay-overlays/TzResumeToast.vue')
  return { REPLAY_HEADER: [], REPLAY_OVERLAYS: collectSlot({ 'replay-overlays/TzResumeToast.vue': toast }) }
})

/** El dock de verdad no hace falta: solo su sección, destino del aviso. */
const Dock = defineComponent({ name: 'TzReplayDock', setup: () => () => h('section', { 'data-testid': 'replay-dock' }) })
const stubs = {
  ...Object.fromEntries(
    ['TzSessionNotes', 'TzTrackStatus', 'TzLoadPanel', 'TzLeaderboard', 'TzTelemetry', 'TzRaceControl', 'TzBench'].map((n) => [n, true]),
  ),
  TzReplayDock: Dock,
}

let fixture: LoadedSession
const pb = () => fixture.manifest.session.playback
/** Una entrada como la que guarda el replay, a `offsetMs` del inicio. */
function saved(offsetMs: number, state: Partial<{ car: string | null; follow: boolean; rate: 1 | 2 | 4 | 8 | 16 }> = {}): ResumeEntry {
  const rt = createReplayRuntime(fixture)
  const info = resumeInfo(fixture, rt.markers, defaultInitialMs(pb()))
  rt.dispose()
  return resumeEntry(info, { t: pb().startMs + offsetMs, car: '1', follow: false, rate: 1, ...state }, Date.now() - 2 * 3_600_000)
}

/** requestAnimationFrame a mano: la página monta el runtime en un frame y la escena en el siguiente (que no se corre). */
let frames: FrameRequestCallback[] = []
const runFrames = () => {
  for (const cb of frames.splice(0)) cb(performance.now())
}

const toast = () => document.querySelector<HTMLElement>('[data-testid="resume-toast"]')
/** Lo retomado al abrir (en el runtime enganchado, lo mismo que lee el aviso). */
const getApplied = () => getRuntime()?.ext<ResumeApplied | null>(RESUME_EXT, () => null) ?? null
let unmount: (() => void) | null = null

beforeEach(async () => {
  fixture ??= await loadFixture()
  localStorage.clear()
  frames = []
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb))
  vi.stubGlobal('cancelAnimationFrame', () => {})
})
afterEach(() => {
  unmount?.()
  unmount = null
  usePlaybackStore().detach()
  useSessionStore().unload()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
  document.body.innerHTML = ''
})

/** Monta el replay en `route` con la sesión del fixture «lista», hasta el frame en que se engancha el runtime. */
async function openReplay(route = `/replay?s=${FIXTURE_FP1}`) {
  const session = useSessionStore()
  vi.spyOn(session, 'load').mockResolvedValue()
  const w = await mountSuspended(ReplayPage, { route, global: { stubs }, attachTo: document.body })
  unmount = () => w.unmount()
  frames = []
  session.data = markRaw(fixture)
  session.status = 'ready'
  await nextTick()
  runFrames()
  await nextTick()
  await nextTick()
  return w
}

describe('la página del replay retoma lo guardado', () => {
  it('en pausa, en el instante guardado, con el coche, el seguimiento y la velocidad, y el aviso', async () => {
    resumeStore.put(saved(200_000, { car: '1', follow: true, rate: 4 }))
    await openReplay()
    const playback = usePlaybackStore()
    expect(playback.attached).toBe(true)
    expect(playback.timeMs).toBe(pb().startMs + 200_000)
    expect(playback.playing).toBe(false)
    expect(playback.rate).toBe(4)
    expect(playback.selectedCar).toBe('1')
    expect(playback.following).toBe(true)
    const applied = getApplied()
    expect(applied?.plan).toEqual({ t: pb().startMs + 200_000, car: '1', follow: true, rate: 4 })
    // El aviso, encima del dock, con el reloj visible del dock en ese instante.
    const el = toast()
    expect(el).not.toBeNull()
    expect(el!.closest('[data-testid="replay-dock"]')).not.toBeNull()
    const clock = formatClock(resumeAt(applied!.info, applied!.plan.t).clockMs)
    expect(el!.textContent).toMatch(new RegExp(`(Retomado en|Resumed at) ${clock}`))
  })

  it('un coche que ya no está en la sesión se ignora; el instante, no', async () => {
    resumeStore.put(saved(200_000, { car: '999', follow: true }))
    await openReplay()
    const playback = usePlaybackStore()
    expect(playback.timeMs).toBe(pb().startMs + 200_000)
    expect(playback.selectedCar).toBeNull()
    expect(playback.following).toBe(false)
  })

  it('?t= manda sobre lo guardado (sin aviso); al salir, se guarda dónde se quedó', async () => {
    resumeStore.put(saved(200_000))
    await openReplay(`/replay?s=${FIXTURE_FP1}&t=${pb().startMs + 300_000}`)
    const playback = usePlaybackStore()
    expect(playback.timeMs).toBe(pb().startMs + 300_000)
    expect(playback.selectedCar).toBeNull()
    expect(getApplied()).toBeNull()
    expect(toast()).toBeNull()
    playback.seek(pb().startMs + 320_000)
    unmount!()
    unmount = null
    expect(resumeStore.get(FIXTURE_FP1)).toMatchObject({ t: pb().startMs + 320_000, car: null, follow: false })
  })

  it('con ?bench=1, ni se retoma ni se guarda', async () => {
    const before = saved(200_000)
    resumeStore.put(before)
    await openReplay(`/replay?s=${FIXTURE_FP1}&bench=1`)
    const playback = usePlaybackStore()
    expect(playback.timeMs).toBe(defaultInitialMs(pb()))
    expect(toast()).toBeNull()
    playback.seek(pb().startMs + 400_000)
    unmount!()
    unmount = null
    expect(resumeStore.get(FIXTURE_FP1)).toEqual(before)
  })

  it('sin nada guardado, empieza como siempre; casi al final, la sesión cuenta como vista y se olvida', async () => {
    await openReplay()
    const playback = usePlaybackStore()
    expect(playback.timeMs).toBe(defaultInitialMs(pb()))
    expect(toast()).toBeNull()
    playback.seek(pb().endMs - 10_000)
    unmount!()
    unmount = null
    expect(resumeStore.get(FIXTURE_FP1)).toBeNull()
  })
})

describe('aviso «Retomado en …»', () => {
  async function mountToast(entry: ResumeEntry) {
    const rt = createReplayRuntime(fixture, { initialMs: entry.t })
    const info = resumeInfo(fixture, rt.markers, defaultInitialMs(pb()))
    rt.ext<ResumeApplied | null>(RESUME_EXT, () => ({ plan: { t: entry.t, car: entry.car, follow: entry.follow, rate: entry.rate }, info }))
    rt.clock.setRate(entry.rate)
    const playback = usePlaybackStore()
    playback.attach(rt)
    if (entry.car) playback.selectCar(entry.car)
    const dock = document.createElement('section')
    dock.dataset.testid = 'replay-dock'
    const play = document.createElement('button')
    play.dataset.testid = 'play-toggle'
    dock.append(play)
    document.body.append(dock)
    const w = await mountSuspended(TzResumeToast, { attachTo: document.body })
    unmount = () => w.unmount()
    await nextTick()
    await nextTick()
    return { w, info }
  }

  it('«Empezar desde el principio»: instante por defecto, sin coche, a ×1, y lo guardado se olvida', async () => {
    const entry = saved(200_000, { car: '1', rate: 8 })
    resumeStore.put(entry)
    const { info } = await mountToast(entry)
    expect(toast()).not.toBeNull()
    document.querySelector<HTMLButtonElement>('[data-testid="resume-restart"]')!.click()
    await nextTick()
    const playback = usePlaybackStore()
    expect(playback.timeMs).toBe(info.defaultMs)
    expect(playback.selectedCar).toBeNull()
    expect(playback.rate).toBe(1)
    expect(resumeStore.get(FIXTURE_FP1)).toBeNull()
    await vi.waitFor(() => expect(toast()).toBeNull())
  })

  it('se va solo a los 8 s, pero no con el puntero encima', async () => {
    const timeouts = vi.spyOn(window, 'setTimeout')
    const clears = vi.spyOn(window, 'clearTimeout')
    await mountToast(saved(200_000))
    const armed = () => timeouts.mock.calls.filter(([, ms]) => ms === RESUME_TOAST_MS)
    expect(armed()).toHaveLength(1)
    const el = toast()!
    el.dispatchEvent(new Event('pointerenter'))
    expect(clears).toHaveBeenCalled()
    el.dispatchEvent(new Event('pointerleave'))
    expect(armed()).toHaveLength(2)
    // Vence el plazo: se oculta.
    ;(armed()[1]![0] as () => void)()
    await vi.waitFor(() => expect(toast()).toBeNull())
  })

  it('× con el foco dentro: se cierra y el foco pasa al botón de reproducir; lo guardado sigue', async () => {
    const entry = saved(200_000)
    resumeStore.put(entry)
    await mountToast(entry)
    const close = document.querySelector<HTMLButtonElement>('[data-testid="resume-close"]')!
    close.focus()
    close.click()
    await nextTick()
    await nextTick()
    expect(document.activeElement?.getAttribute('data-testid')).toBe('play-toggle')
    await vi.waitFor(() => expect(toast()).toBeNull())
    // Cerrar no olvida lo guardado (solo «Empezar desde el principio»).
    expect(resumeStore.get(FIXTURE_FP1)).toEqual(entry)
  })

  it('sin nada retomado no pinta nada', async () => {
    usePlaybackStore().attach(createReplayRuntime(fixture))
    const dock = document.createElement('section')
    dock.dataset.testid = 'replay-dock'
    document.body.append(dock)
    const w = await mountSuspended(TzResumeToast, { attachTo: document.body })
    unmount = () => w.unmount()
    await nextTick()
    expect(toast()).toBeNull()
    expect(dock.children).toHaveLength(0)
  })
})

describe('«Seguir viendo» en la portada', () => {
  const catalogJson = (): Catalog => JSON.parse(readFileSync(`${FIXTURE_ROOT}v1/catalog.json`, 'utf8')) as Catalog

  function setCatalog(value: Catalog | null) {
    const catalog = useCatalogStore()
    vi.spyOn(catalog, 'load').mockResolvedValue()
    catalog.catalog = value ? markRaw(value) : null
    catalog.status = value ? 'ready' : 'loading'
  }

  it('sin nada guardado, no hay tarjeta', async () => {
    setCatalog(catalogJson())
    const w = await mountSuspended(TzContinue)
    expect(w.find('[data-testid="continue"]').exists()).toBe(false)
  })

  it('solo las sesiones que siguen en el catálogo y se pueden reproducir; con dónde se dejaron y cuándo', async () => {
    setCatalog(catalogJson())
    resumeStore.put({ ...saved(200_000), id: '2026/11-nowhere/race', savedAt: Date.now() })
    resumeStore.put({ ...saved(200_000), id: '2026/10-spa-francorchamps/fp2', savedAt: Date.now() })
    resumeStore.put(saved(200_000))
    const w = await mountSuspended(TzContinue)
    await nextTick()
    const items = w.findAll('[data-session]')
    expect(items.map((i) => i.attributes('data-session'))).toEqual([FIXTURE_FP1])
    const link = items[0]!.find('[data-testid="continue-link"]')
    expect(link.attributes('href')).toBe(`/replay?s=${FIXTURE_FP1}`)
    expect(link.text()).toContain('Belgian Grand Prix')
    const where = items[0]!.find('[data-testid="continue-where"]').text()
    const clock = formatClock(saved(200_000).clockMs)
    expect(where).toMatch(new RegExp(`(Libres 1 · 2026 en|Practice 1 · 2026 at) ${clock}`))
    expect(link.text()).toMatch(/(hace 2 h|2 hr\. ago)/)
    // Es la posición dentro de la sesión (200 s de 540), no lo que se ha visto.
    expect(link.text()).toMatch(/(en el 37\s?% de la sesión|at 37\s?% of the session)/)
    expect(link.text()).not.toMatch(/(visto|watched)/)
  })

  it('con el catálogo aún sin cargar, nada', async () => {
    setCatalog(null)
    resumeStore.put(saved(200_000))
    const w = await mountSuspended(TzContinue)
    expect(w.find('[data-testid="continue"]').exists()).toBe(false)
  })

  it('× la olvida (del almacenamiento también) y la tarjeta desaparece', async () => {
    setCatalog(catalogJson())
    resumeStore.put(saved(200_000))
    const w = await mountSuspended(TzContinue, { attachTo: document.body })
    unmount = () => w.unmount()
    await nextTick()
    const forget = w.find('[data-testid="continue-forget"]')
    expect(forget.attributes('aria-label')).toMatch(/(Olvidar|Forget) Belgian Grand Prix/)
    await forget.trigger('click')
    await nextTick()
    expect(resumeStore.get(FIXTURE_FP1)).toBeNull()
    expect(w.find('[data-testid="continue"]').exists()).toBe(false)
  })
})
