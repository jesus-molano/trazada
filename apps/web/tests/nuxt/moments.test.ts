/**
 * Momentos (ítem 5, D35) con una carrera sintética sobre el fixture (Spa 2026): VER (3) adelanta a NOR (1) en la
 * vuelta 2 y desde ahí NOR le sigue a 0,5 s en la línea (duelo de las vueltas 2 a 8). La pestaña «Momentos» lista
 * adelantamientos y duelos con «Sin spoilers» y salta al pulsar (5 s antes, eligiendo al que adelanta o persigue); el
 * instante GPS lleva «Estimado» y, sin GPS, «momento exacto: sin dato». Los botones del dock (y la coma y el punto)
 * saltan entre momentos, de todas las clases o de la elegida; el carril del timeline marca los adelantamientos. En
 * libres (el fixture), las listas explican que solo hay en carrera. Sin bucle de frames (requestAnimationFrame
 * sustituido: el estado grueso llega con los avisos del reloj).
 */
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
// El hueco de pestañas antes que una de ellas: el hueco importa las pestañas y cada pestaña usa la hoja (useAnalysis).
import { ANALYSIS_TABS, defaultTab } from '~/slots/analysis-tabs'
import TzMomentsTab from '~/components/analysis-tabs/TzMomentsTab.vue'
import TzJumpButtons from '~/components/replay-dock/TzJumpButtons.vue'
import TzOvertakeLane from '~/components/timeline-lanes/TzOvertakeLane.vue'
import { useAnalysis } from '~/composables/useAnalysis'
import type { LoadedSession } from '~/data/types'
import { JUMP_LEAD_MS } from '~/engine/moments/jumps'
import { findShortcut } from '~/replay/keys'
import { createReplayRuntime, type ReplayRuntime } from '~/replay/runtime'
import { useCompareStore } from '~/stores/compare'
import { useMomentsStore } from '~/stores/moments'
import { usePlaybackStore } from '~/stores/playback'
import { loadFixture } from '~/testing/fixture'
import { rcMessage } from '~/testing/laps'
import { type RaceCar, raceSession } from '~/testing/moments'

let fixture: LoadedSession
let rt: ReplayRuntime
let S = 0
const unmounts: (() => void)[] = []

const NOR: RaceCar = { car: 1, lapMs: [60_000, 60_000, 60_000, 60_000, 60_000, 60_000, 60_000, 60_000] }
const VER: RaceCar = { car: 3, lapMs: [60_500, 59_000, 60_000, 60_000, 60_000, 60_000, 60_000, 60_000] }
/**
 * Vuelta 2: NOR va de S + 60,0 s a S + 120,0 s y VER de S + 60,5 s a S + 119,5 s; a velocidad constante se cruzan en
 * S + 90 s. La línea lo confirma cuando cruza NOR (S + 120 s). El duelo empieza con VER en la línea al acabar la vuelta
 * 2 (S + 119,5 s) y es duelo desde la tercera vuelta (la 4 de NOR, S + 240 s).
 */
const PASS_AT = 90_000
const CONFIRMED = 120_000
const DUEL_START = 119_500
const DUEL_CONFIRMED = 240_000

beforeEach(async () => {
  fixture ??= await loadFixture()
  S = fixture.manifest.session.playback.startMs
  vi.stubGlobal('requestAnimationFrame', () => 0)
  vi.stubGlobal('cancelAnimationFrame', () => {})
})
afterEach(() => {
  for (const u of unmounts.splice(0)) u()
  usePlaybackStore().detach()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

function attach(session: LoadedSession) {
  rt = createReplayRuntime(session)
  usePlaybackStore().attach(rt)
}

/** La carrera de NOR y VER, con un SC en S + 300 s y un incidente en S + 400 s. */
function attachRace(cars: RaceCar[] = [NOR, VER]) {
  attach(
    raceSession(fixture, cars, {
      windows: [{ kind: 'sc', fromMs: S + 300_000, toMs: S + 330_000 }],
      raceControl: [rcMessage(S + 400_000, 'incident', 'INCIDENT INVOLVING CAR 1 (NOR) NOTED', ['1'])],
    }),
  )
}

async function mount<T>(component: T) {
  const w = await mountSuspended(component as never, { attachTo: document.body })
  unmounts.push(() => w.unmount())
  return w
}

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)
const $$ = <T extends Element = HTMLElement>(sel: string) => [...document.querySelectorAll<T>(sel)]
const settle = async () => {
  await nextTick()
  await nextTick()
}
async function seek(t: number) {
  rt.clock.seek(t)
  await settle()
}
const time = () => usePlaybackStore().timeMs

describe('pestaña «Momentos» (hueco analysis-tabs)', () => {
  it('va detrás de las de vueltas y solo tiene listas en carrera y sprint', () => {
    const tab = ANALYSIS_TABS.find((x) => x.tab === 'moments')!
    expect(tab.raceOnly).toBe(true)
    expect(ANALYSIS_TABS.map((x) => x.tab).indexOf('moments')).toBe(ANALYSIS_TABS.length - 1)
    expect(defaultTab(ANALYSIS_TABS, false)).not.toBe('moments')
  })

  it('en libres explica que solo hay en carrera; los saltos siguen (sin adelantamientos ni duelos entre los que elegir)', async () => {
    attach(fixture)
    await mount(TzMomentsTab)
    expect($('[data-testid="moments-only-race"]')!.textContent).toMatch(/carrera y sprint|races and sprints/)
    expect($('[data-testid="overtake-row"]')).toBeNull()
    const filter = (f: string) => $<HTMLButtonElement>(`[data-testid="moments-filter"] [data-filter="${f}"]`)!
    expect(filter('all').disabled).toBe(false)
    expect(filter('overtake').disabled).toBe(true)
    expect(filter('duel').disabled).toBe(true)
    // El fixture trae mensajes destacados de dirección de carrera dentro de la reproducción (bandera a cuadros…).
    expect(filter('raceControl').disabled).toBe(false)
  })

  it('«Sin spoilers»: nada hasta que la línea lo confirma; el duelo, «en curso» hasta saber cómo acaba', async () => {
    attachRace()
    await mount(TzMomentsTab)
    expect($('[data-testid="overtakes-nothing-yet"]')).not.toBeNull()
    expect($('[data-testid="duels-nothing-yet"]')).not.toBeNull()

    await seek(S + CONFIRMED - 1)
    expect($$('[data-testid="overtake-row"]')).toHaveLength(0)
    await seek(S + CONFIRMED)
    const rows = $$('[data-testid="overtake-row"]')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.dataset).toMatchObject({ passer: '3', passed: '1', lap: '2', located: 'true' })
    expect(rows[0]!.textContent).toMatch(/VER adelanta a NOR|VER passes NOR/)
    expect(rows[0]!.textContent).toContain('≈')
    expect($('[data-testid="duels-nothing-yet"]')).not.toBeNull()

    await seek(S + DUEL_CONFIRMED + 10_000)
    const duel = $$('[data-testid="duel-row"]')
    expect(duel).toHaveLength(1)
    expect(duel[0]!.dataset).toMatchObject({ leader: '3', chaser: '1', firstLap: '2', lastLap: '4', open: 'true' })
    expect(duel[0]!.textContent).toMatch(/en curso|ongoing/)
    expect(duel[0]!.textContent).toMatch(/0[.,]500/)

    // Sin «Sin spoilers», toda la carrera: el duelo llega a la vuelta 8 y ya no está en curso.
    useAnalysis().noSpoilers.value = false
    await settle()
    expect($('[data-testid="duel-row"]')!.dataset).toMatchObject({ lastLap: '8', open: 'false' })
  })

  it('pulsar un adelantamiento salta 5 s antes de su instante y elige al que adelanta; un duelo, al perseguidor comparado', async () => {
    attachRace()
    useAnalysis().noSpoilers.value = false
    await mount(TzMomentsTab)
    $<HTMLButtonElement>('[data-testid="overtake-row"]')!.click()
    await settle()
    expect(Math.abs(time() - (S + PASS_AT - JUMP_LEAD_MS))).toBeLessThan(100)
    expect(usePlaybackStore().selectedCar).toBe('3')

    $<HTMLButtonElement>('[data-testid="duel-row"]')!.click()
    await settle()
    expect(time()).toBe(S + DUEL_START - JUMP_LEAD_MS)
    expect(usePlaybackStore().selectedCar).toBe('1')
    expect(useCompareStore().compareCar).toBe('3')
    expect(useCompareStore().comparing).toBe(true)
    // La fila del coche elegido se destaca.
    expect($('[data-testid="duel-row"]')!.classList).toContain('is-involved')
  })

  it('el instante GPS lleva «Estimado»; sin GPS en el cruce, «momento exacto: sin dato» y salta al inicio de la vuelta', async () => {
    attachRace()
    useAnalysis().noSpoilers.value = false
    const w = await mount(TzMomentsTab)
    expect(w.find('[data-testid="estimated"][data-field="overtakeTime"]').exists()).toBe(true)
    w.unmount()
    unmounts.splice(0)
    usePlaybackStore().detach()

    // VER sin GPS entre S + 80 s y S + 100 s: el cruce cae en el hueco.
    attachRace([NOR, { ...VER, gaps: [[S + 80_000, S + 100_000]] }])
    useAnalysis().noSpoilers.value = false
    const g = await mount(TzMomentsTab)
    const row = $('[data-testid="overtake-row"]')!
    expect(row.dataset.located).toBe('false')
    expect(row.textContent).toMatch(/momento exacto: sin dato|exact moment: no data/)
    expect(g.find('[data-testid="estimated"][data-field="overtakeTime"]').exists()).toBe(false)
    ;(row as HTMLButtonElement).click()
    await settle()
    // El inicio de la vuelta 2 del que adelanta: su paso por meta de la vuelta 1 (S + 60,5 s).
    expect(time()).toBe(S + 60_500 - JUMP_LEAD_MS)
  })
})

describe('botones de saltos (hueco replay-dock)', () => {
  const prev = () => $<HTMLButtonElement>('[data-testid="jump-prev"]')!
  const next = () => $<HTMLButtonElement>('[data-testid="jump-next"]')!

  it('siguiente y anterior recorren todos los momentos, 5 s antes de cada uno; deshabilitados en los bordes', async () => {
    attachRace()
    await mount(TzJumpButtons)
    expect(next().getAttribute('aria-label')).toMatch(/Momento siguiente \(todos\)|Next moment \(all\)/)
    expect(prev().getAttribute('aria-label')).toMatch(/Momento anterior|Previous moment/)
    expect(next().getAttribute('aria-keyshortcuts')).toBe('.')
    expect(prev().disabled).toBe(true)

    const stops: number[] = []
    while (!next().disabled) {
      next().click()
      await settle()
      stops.push(time() - S)
    }
    expect(stops[0]).toBeCloseTo(PASS_AT - JUMP_LEAD_MS, -2)
    expect(stops.slice(1)).toEqual([DUEL_START - JUMP_LEAD_MS, 300_000 - JUMP_LEAD_MS, 400_000 - JUMP_LEAD_MS])
    // Al ir a un adelantamiento o a un duelo, se elige al que adelanta o persigue; a un incidente, no cambia.
    expect(usePlaybackStore().selectedCar).toBe('1')

    prev().click()
    await settle()
    expect(time()).toBe(S + 300_000 - JUMP_LEAD_MS)
  })

  it('con una clase elegida en la pestaña, solo esa; la coma y el punto hacen lo mismo que los botones', async () => {
    attachRace()
    await mount(TzJumpButtons)
    const moments = useMomentsStore()
    moments.setFilter('neutralisation')
    await settle()
    expect(next().getAttribute('aria-label')).toMatch(/neutralizaciones|neutralisations/)
    next().click()
    await settle()
    expect(time()).toBe(S + 300_000 - JUMP_LEAD_MS)
    expect(next().disabled).toBe(true)

    moments.setFilter('overtake')
    await settle()
    const key = (k: string) => findShortcut(new KeyboardEvent('keydown', { key: k }), false)
    key(',')!(new KeyboardEvent('keydown', { key: ',' }))
    await settle()
    expect(Math.abs(time() - (S + PASS_AT - JUMP_LEAD_MS))).toBeLessThan(100)
    moments.setFilter('all')
    key('.')!(new KeyboardEvent('keydown', { key: '.' }))
    await settle()
    expect(time()).toBe(S + DUEL_START - JUMP_LEAD_MS)
  })

  it('al cambiar de sesión, la clase vuelve a «todos»', async () => {
    attachRace()
    useMomentsStore().setFilter('duel')
    usePlaybackStore().detach()
    await settle()
    expect(useMomentsStore().filter).toBe('all')
  })
})

describe('carril de adelantamientos (hueco timeline-lanes)', () => {
  it('con «Sin spoilers», solo los confirmados hasta el reloj; sin él, todos, en su instante GPS', async () => {
    attachRace()
    await mount(TzOvertakeLane)
    const lane = () => $('[data-testid="overtake-lane"]')!
    expect(lane().dataset.ticks).toBe('0')
    await seek(S + CONFIRMED)
    expect(lane().dataset.ticks).toBe('1')
    const tick = $('[data-marker="overtake"]')!
    expect(tick.dataset.located).toBe('true')
    const left = Number.parseFloat(tick.style.left)
    expect(left).toBeCloseTo(((PASS_AT) / rt.clock.duration) * 100, 0)
    expect(tick.getAttribute('title')).toMatch(/VER adelanta a NOR|VER passes NOR/)

    await seek(S)
    useAnalysis().noSpoilers.value = false
    await settle()
    expect(lane().dataset.ticks).toBe('1')
  })

  it('fuera de carrera, sin carril', async () => {
    attach(fixture)
    await mount(TzOvertakeLane)
    expect($('[data-testid="overtake-lane"]')).toBeNull()
  })
})
