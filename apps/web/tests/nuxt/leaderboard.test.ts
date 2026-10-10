import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import TzLeaderboard from '~/components/TzLeaderboard.vue'
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
