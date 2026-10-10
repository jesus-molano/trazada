import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import TzLeaderboard from '~/components/TzLeaderboard.vue'
import { LEADERBOARD_INTERVAL_MS, RANK_ANNOUNCE_INTERVAL_MS } from '~/composables/useLeaderboard'
import { RANK_CHANGE_TTL_MS } from '~/engine/leaderboard/changes'
import type { LeaderboardRow } from '~/engine/leaderboard/leaderboard'
import type { ReplayRuntime } from '~/replay/runtime'
import { usePlaybackStore } from '~/stores/playback'
import { useSettingsStore } from '~/stores/settings'

const driver = (number: string, tla: string) => ({ number, tla, first: '', last: '', team: '', color: '#3366FF' })

const row = (car: string, tla: string, position: number, over: Partial<LeaderboardRow> = {}): LeaderboardRow => ({
  car,
  driver: driver(car, tla),
  position,
  positionKnown: true,
  gapMs: position === 1 ? 0 : 1234 * position,
  intervalMs: 1234,
  lapsBehind: 0,
  lap: 10,
  compound: 'MEDIUM',
  tyreLife: 7,
  bestLapMs: null,
  inPit: false,
  noSignal: false,
  blueFlag: false,
  ...over,
})

function fakeRuntime(rows: LeaderboardRow[]): ReplayRuntime {
  return {
    clock: { timeMs: 0, rate: 1, playing: false },
    model: { states: [] },
    leaderboard: { compute: () => rows },
    drivers: rows.map((r) => r.driver!),
    onFrame: () => () => {},
    onCoarse: (cb: (s: { timeMs: number; playing: boolean; rate: 1 }) => void) => {
      cb({ timeMs: 0, playing: false, rate: 1 })
      return () => {}
    },
    requestFrame: () => {},
    dispose: () => {},
  } as unknown as ReplayRuntime
}

// Se usa la instancia de Pinia de la app Nuxt de test (la misma que ve el componente).
describe('TzLeaderboard', () => {
  it('bandera azul en la fila del coche afectado, con filtro para ocultarla; "sin señal"', async () => {
    usePlaybackStore().attach(
      fakeRuntime([row('1', 'AAA', 1), row('44', 'BBB', 2, { blueFlag: true }), row('16', 'CCC', 3, { noSignal: true })]),
    )
    const settings = useSettingsStore()
    settings.setShowBlueFlags(true)
    const w = await mountSuspended(TzLeaderboard)
    expect(w.findAll('[data-car]').map((r) => r.attributes('data-position'))).toEqual(['1', '2', '3'])
    expect(w.find('[data-car="44"] [data-testid="blue-flag"]').exists()).toBe(true)
    expect(w.find('[data-car="1"] [data-testid="blue-flag"]').exists()).toBe(false)
    expect(w.find('[data-car="16"] [data-testid="no-signal"]').exists()).toBe(true)
    await w.find('[data-testid="toggle-blue-flags"]').setValue(false)
    expect(settings.showBlueFlags).toBe(false)
    expect(w.find('[data-testid="blue-flag"]').exists()).toBe(false)
  })

  it('gap al líder o intervalo, vueltas perdidas y neumático', async () => {
    usePlaybackStore().attach(
      fakeRuntime([row('1', 'AAA', 1), row('44', 'BBB', 2, { gapMs: 61_500 }), row('16', 'CCC', 3, { lapsBehind: 1 })]),
    )
    const w = await mountSuspended(TzLeaderboard)
    const gaps = () => w.findAll('.tz-lb__gap').map((g) => g.text())
    expect(gaps()[1]).toMatch(/^\+1:01[.,]500$/)
    expect(gaps()[2]).toMatch(/^\+1 [VL]$/)
    await w.find('[data-testid="gap-interval"]').trigger('click')
    expect(gaps()[1]).toMatch(/^\+1[.,]234$/)
    expect(w.find('[data-car="44"] .tz-lb__compound').text()).toBe('M')
    // Plural de la edad del neumático (y sin dato, sin número inventado)
    expect(w.find('[data-car="44"] .tz-lb__tyre').attributes('title')).toMatch(/7 (vueltas|laps)$/)
  })

  it('posición sin dato: «—» en vez del puesto en la lista, y sin «LÍDER»', async () => {
    usePlaybackStore().attach(
      fakeRuntime([
        row('1', 'AAA', 1, { positionKnown: false, gapMs: null, intervalMs: null }),
        row('44', 'BBB', 2, { positionKnown: false, gapMs: null, intervalMs: null }),
      ]),
    )
    const w = await mountSuspended(TzLeaderboard)
    expect(w.findAll('[data-testid="lb-position"]').map((p) => p.text())).toEqual(['—', '—'])
    expect(w.findAll('[data-car]').map((r) => r.attributes('data-position-known'))).toEqual(['false', 'false'])
    expect(w.findAll('.tz-lb__gap').map((g) => g.text())).toEqual(['—', '—'])
  })

  it('un gap o intervalo negativo no se pinta nunca (sin dato)', async () => {
    usePlaybackStore().attach(
      fakeRuntime([row('1', 'AAA', 1), row('44', 'BBB', 2, { gapMs: -970, intervalMs: -970 })]),
    )
    const settings = useSettingsStore()
    settings.setGapMode('leader')
    const w = await mountSuspended(TzLeaderboard)
    const gap = () => w.find('[data-car="44"] .tz-lb__gap').text()
    expect(gap()).toBe('—')
    await w.find('[data-testid="gap-interval"]').trigger('click')
    expect(gap()).toBe('—')
    settings.setGapMode('leader')
  })

  it('edad del neumático en singular y sin dato', async () => {
    usePlaybackStore().attach(
      fakeRuntime([row('1', 'AAA', 1, { tyreLife: 1 }), row('44', 'BBB', 2, { tyreLife: null, compound: 'UNKNOWN' })]),
    )
    const w = await mountSuspended(TzLeaderboard)
    expect(w.find('[data-car="1"] .tz-lb__tyre').attributes('title')).toMatch(/1 (vuelta|lap)$/)
    expect(w.find('[data-car="44"] .tz-lb__tyre').attributes('title')).toMatch(/(sin dato|unknown)$/)
  })
})

/**
 * Runtime falso con reproducción que se controla a mano: `frame()` avanza el reloj de sesión (100 ms, lo que avanza
 * un frame a ×1) y el de pared (lo justo para que el leaderboard se recalcule), y `seek()` salta.
 */
function liveRuntime(initial: LeaderboardRow[], opts: { race?: boolean; rate?: number } = {}) {
  let current = initial
  let wall = 1_000
  vi.spyOn(performance, 'now').mockImplementation(() => wall)
  const listeners = new Set<(t: number) => void>()
  const clock = { timeMs: 10_000, rate: opts.rate ?? 1, playing: true }
  const rt = {
    clock,
    model: { states: [] },
    leaderboard: { race: opts.race ?? true, compute: () => current },
    drivers: initial.map((r) => r.driver!),
    onFrame: (cb: (t: number) => void) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    onCoarse: (cb: (s: { timeMs: number; playing: boolean; rate: number }) => void) => {
      cb({ timeMs: clock.timeMs, playing: true, rate: clock.rate })
      return () => {}
    },
    requestFrame: () => {},
    dispose: () => {},
  } as unknown as ReplayRuntime
  const emit = () => {
    for (const l of listeners) l(clock.timeMs)
  }
  return {
    rt,
    clock,
    show(rows: LeaderboardRow[]) {
      current = rows
    },
    /** Un frame de reproducción continua, `wallMs` después del anterior. */
    async frame(wallMs = LEADERBOARD_INTERVAL_MS) {
      wall += wallMs
      clock.timeMs += 100 * clock.rate
      emit()
      await nextTick()
    },
    async seek(to: number) {
      wall += 16
      clock.timeMs = to
      emit()
      await nextTick()
    },
    advanceWall(ms: number) {
      wall += ms
    },
  }
}

const standings = (cars: [string, string][], over: Record<string, Partial<LeaderboardRow>> = {}) =>
  cars.map(([car, tla], i) => row(car, tla, i + 1, over[car]))

const GAINED_1 = /^(ganó 1 posición|gained 1 place)$/
const LOST_1 = /^(perdió 1 posición|lost 1 place)$/

describe('TzLeaderboard: clasificación animada (ítem 8)', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    usePlaybackStore().detach()
  })

  const A: [string, string] = ['1', 'AAA']
  const B: [string, string] = ['44', 'BBB']
  const C: [string, string] = ['16', 'CCC']

  it('sin flechas al cargar; un adelantamiento confirmado deja ↑ y ↓ con cifra y texto (no solo el color)', async () => {
    const live = liveRuntime(standings([A, B, C]))
    usePlaybackStore().attach(live.rt)
    const w = await mountSuspended(TzLeaderboard)
    await live.frame()
    expect(w.findAll('[data-testid="rank-change"]')).toHaveLength(0)
    expect(w.findAll('[data-car]').map((r) => r.attributes('data-change'))).toEqual([undefined, undefined, undefined])

    // CCC pasa a BBB: la lista se reordena al momento y con FLIP (move-class con transición)…
    live.show(standings([A, C, B]))
    await live.frame()
    expect(w.findAll('[data-car]').map((r) => r.attributes('data-car'))).toEqual(['1', '16', '44'])
    expect(w.find('[data-testid="lb-rows"]').attributes('moveclass')).toBe('tz-lb-move')
    // …pero la flecha espera a que el orden se mantenga (filtra los vaivenes de la torre).
    expect(w.findAll('[data-testid="rank-change"]')).toHaveLength(0)
    await live.frame()
    expect(w.find('[data-testid="lb-rows"]').attributes('moveclass')).toBe('tz-lb-still')

    const up = w.find('[data-car="16"]')
    const down = w.find('[data-car="44"]')
    expect(up.attributes('data-change')).toBe('up')
    expect(down.attributes('data-change')).toBe('down')
    expect(w.find('[data-car="1"]').attributes('data-change')).toBeUndefined()
    // Forma (icono), cifra y texto oculto para lectores de pantalla.
    expect(up.find('[data-testid="rank-change"] [data-icon="gain"]').exists()).toBe(true)
    expect(down.find('[data-testid="rank-change"] [data-icon="loss"]').exists()).toBe(true)
    expect(up.find('[data-testid="rank-change"] span[aria-hidden="true"]').text()).toBe('1')
    expect(up.find('[data-testid="rank-change"] .tz-visually-hidden').text()).toMatch(GAINED_1)
    expect(down.find('[data-testid="rank-change"] .tz-visually-hidden').text()).toMatch(LOST_1)
    // En carrera, el título dice con qué se compara: el orden anterior, nunca la parrilla.
    expect(up.find('[data-testid="rank-change"]').attributes('title')).toMatch(/parrilla|grid/)
    // Destello (a ×1 y sin reduced motion), del color del cambio.
    expect(up.find('[data-testid="rank-flash"]').classes()).toContain('is-gain')
    expect(down.find('[data-testid="rank-flash"]').classes()).toContain('is-loss')
  })

  it('las flechas caducan a los pocos segundos de pared, también en pausa', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const live = liveRuntime(standings([A, B]))
    usePlaybackStore().attach(live.rt)
    const w = await mountSuspended(TzLeaderboard)
    await live.frame()
    live.show(standings([B, A]))
    await live.frame()
    await live.frame()
    expect(w.findAll('[data-testid="rank-change"]')).toHaveLength(2)
    // Pausa: sin frames, la flecha se quita con su temporizador.
    live.clock.playing = false
    live.advanceWall(RANK_CHANGE_TTL_MS)
    vi.advanceTimersByTime(RANK_CHANGE_TTL_MS + 5)
    await nextTick()
    expect(w.findAll('[data-testid="rank-change"]')).toHaveLength(0)
  })

  it('tras un seek no hay flechas ni animación, aunque el orden cambie', async () => {
    const live = liveRuntime(standings([A, B, C]))
    usePlaybackStore().attach(live.rt)
    const w = await mountSuspended(TzLeaderboard)
    await live.frame()
    live.show(standings([A, C, B]))
    await live.frame()
    await live.frame()
    expect(w.findAll('[data-testid="rank-change"]')).toHaveLength(2)

    live.show(standings([C, B, A]))
    await live.seek(60_000)
    expect(w.findAll('[data-testid="rank-change"]')).toHaveLength(0)
    expect(w.find('[data-testid="lb-rows"]').attributes('moveclass')).toBe('tz-lb-still')
    await live.frame()
    await live.frame()
    expect(w.findAll('[data-testid="rank-change"]')).toHaveLength(0)
    expect(w.find('[data-testid="rank-live"]').text()).toBe('')
  })

  it('a ×16, flechas sí pero sin deslizar ni destello', async () => {
    const live = liveRuntime(standings([A, B]), { rate: 16 })
    usePlaybackStore().attach(live.rt)
    const w = await mountSuspended(TzLeaderboard)
    await live.frame()
    live.show(standings([B, A]))
    await live.frame()
    expect(w.find('[data-testid="lb-rows"]').attributes('moveclass')).toBe('tz-lb-still')
    await live.frame()
    expect(w.find('[data-car="44"]').attributes('data-change')).toBe('up')
    expect(w.findAll('[data-testid="rank-flash"]')).toHaveLength(0)
  })

  it('«—» nunca gana puestos: un coche que pasa de sin dato a un puesto no lleva flecha', async () => {
    const live = liveRuntime(standings([A, B, C], { '16': { positionKnown: false } }))
    usePlaybackStore().attach(live.rt)
    const w = await mountSuspended(TzLeaderboard)
    await live.frame()
    live.show(standings([C, A, B]))
    await live.frame()
    await live.frame()
    expect(w.find('[data-car="16"]').attributes('data-change')).toBeUndefined()
    expect(w.find('[data-car="1"]').attributes('data-change')).toBe('down')
  })

  it('libres y clasificación: la primera vuelta cronometrada no cuenta; el título habla del orden por mejor vuelta', async () => {
    const lap = { bestLapMs: 100_000 }
    const live = liveRuntime(standings([A, B, C], { '1': lap, '44': lap }), { race: false })
    usePlaybackStore().attach(live.rt)
    const w = await mountSuspended(TzLeaderboard)
    await live.frame()
    live.show(standings([C, A, B], { '1': lap, '44': lap, '16': { bestLapMs: 99_000 } }))
    await live.frame()
    await live.frame()
    expect(w.find('[data-car="16"]').attributes('data-change')).toBeUndefined()
    const down = w.find('[data-car="1"] [data-testid="rank-change"]')
    expect(down.attributes('title')).toMatch(/mejor vuelta|best-lap/i)
  })

  it('aviso aria-live: nombre, cambio y puesto nuevo, como mucho uno cada pocos segundos', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const live = liveRuntime(standings([A, B, C]))
    usePlaybackStore().attach(live.rt)
    const w = await mountSuspended(TzLeaderboard)
    const region = () => w.find('[data-testid="rank-live"]')
    expect(region().attributes('aria-live')).toBe('polite')
    await live.frame()
    live.show(standings([A, C, B]))
    await live.frame()
    await live.frame()
    expect(region().text()).toMatch(/CCC.*(ganó 1 posición|gained 1 place).*(2\.º|P2).*BBB.*(perdió 1 posición|lost 1 place)/)
    const first = region().text()

    // Otro cambio enseguida: no se anuncia hasta que pase el intervalo.
    live.show(standings([C, A, B]))
    await live.frame()
    await live.frame()
    expect(region().text()).toBe(first)
    live.advanceWall(RANK_ANNOUNCE_INTERVAL_MS)
    vi.advanceTimersByTime(RANK_ANNOUNCE_INTERVAL_MS)
    await nextTick()
    expect(region().text()).toMatch(/CCC.*(1\.º|P1).*AAA/)
  })
})
