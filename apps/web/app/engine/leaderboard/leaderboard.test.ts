import type { DriverInfo, SessionEvents } from '@trazada/schema'
import { describe, expect, it } from 'vitest'
import { fakeTrzb, loadFixture } from '../../testing/fixture'
import { carTracks } from '../replay/motion'
import { type CarState, ReplayModel } from '../replay/ReplayModel'
import { circuitModel } from '../track/circuit'
import { BLUE_FLAG_MS, LeaderboardEngine } from './leaderboard'

const drivers: DriverInfo[] = ['1', '44', '16'].map((n) => ({
  number: n,
  tla: { '1': 'AAA', '44': 'BBB', '16': 'CCC' }[n]!,
  first: '',
  last: '',
  team: '',
  color: '#123456',
}))

const ev = (over: Partial<SessionEvents> = {}): SessionEvents => ({
  schema: 'trazada.events',
  schemaVersion: '1.0.0',
  raceControl: [],
  sectorFlags: [],
  windows: [],
  ...over,
})

const state = (car: string, s: number, visible = true, inPit = false): CarState => ({
  car,
  driver: null,
  visible,
  inPit,
  transition: false,
  s,
  speedMps: 0,
  x: 0,
  y: 0,
  z: 0,
  heading: 0,
})

// Carrera de 3 vueltas: 1 gana; 44 cae una vuelta (entra en boxes en la 2); 16 va 2.º desde la vuelta 2.
const timing = fakeTrzb('timing', {
  laps: {
    car: [1, 1, 1, 44, 44, 16, 16, 16],
    lap: [1, 2, 3, 1, 2, 1, 2, 3],
    startMs: [0, 90000, 180000, 0, 91000, 0, 92000, 183000],
    endMs: [90000, 180000, 270000, 91000, 260000, 92000, 183000, 275000],
    lapMs: [-1, 90000, 90000, -1, 169000, -1, 91000, 92000],
    s1Ms: [-1, -1, -1, -1, -1, -1, -1, -1],
    compound: [1, 1, 1, 2, 3, 2, 2, 2],
    tyreLife: [3, 4, 5, 1, 1, 10, 11, 12],
    pitInMs: [-1, -1, -1, -1, 150000, -1, -1, -1],
    pitOutMs: [-1, -1, -1, -1, -1, -1, -1, -1],
    position: [1, 1, 1, 2, 3, 3, 2, 2],
    deleted: [0, 0, 0, 0, 0, 0, 0, 0],
  },
  stream: { t: [], car: [], position: [], gapToLeaderMs: [], intervalMs: [], lapsBehind: [] },
})

describe('leaderboard sin torre (carrera)', () => {
  const lb = new LeaderboardEngine('race', timing, ev(), drivers)

  it('orden en la línea y gaps con los tiempos de paso', () => {
    const rows = lb.compute(185_000, [state('1', 3000), state('44', 2500), state('16', 2900)])
    expect(rows.map((r) => r.car)).toEqual(['1', '16', '44'])
    expect(rows.map((r) => r.position)).toEqual([1, 2, 3])
    expect(rows[0]!.gapMs).toBe(0)
    expect(rows[1]!.gapMs).toBe(3000) // 183000 − 180000 (vuelta 2)
    expect(rows[1]!.intervalMs).toBe(3000)
    expect(rows[2]!.lapsBehind).toBe(1) // 44 solo completó la vuelta 1
    expect(rows[2]!.gapMs).toBeNull()
    expect(rows[1]!.compound).toBe('MEDIUM')
    expect(rows[1]!.tyreLife).toBe(12)
  })

  it('compuesto de un coche en un instante (el de la clasificación; para la banda del neumático en 3D)', () => {
    const rows = lb.compute(185_000, [state('1', 3000), state('44', 2500), state('16', 2900)])
    for (const r of rows) expect(lb.compoundAt(r.car, 185_000)).toBe(r.compound)
    expect(lb.compoundAt('44', 50_000)).toBe('MEDIUM')
    expect(lb.compoundAt('44', 95_000)).toBe('HARD')
    expect(lb.compoundAt('99', 95_000)).toBe('UNKNOWN')
  })

  it('compuesto puesto en una parada con cambio: sin dato desde la entrada al pit hasta la salida', () => {
    // 7: vuelta 1 en medios, entra al pit a 85 s, cruza la línea a 87 s (empieza la 2, en duros) y sale a 105 s.
    const pit = fakeTrzb('timing', {
      laps: {
        car: [7, 7, 7],
        lap: [1, 2, 3],
        startMs: [0, 87000, 190000],
        endMs: [87000, 190000, 280000],
        lapMs: [-1, 103000, 90000],
        s1Ms: [-1, -1, -1],
        compound: [2, 3, 3],
        tyreLife: [1, 1, 2],
        pitInMs: [85000, -1, -1],
        pitOutMs: [-1, 105000, -1],
        position: [1, 1, 1],
        deleted: [0, 0, 0],
      },
      stream: { t: [], car: [], position: [], gapToLeaderMs: [], intervalMs: [], lapsBehind: [] },
    })
    const e = new LeaderboardEngine('race', pit, ev(), [{ ...drivers[0]!, number: '7' }])
    expect(e.compoundAt('7', 80_000)).toBe('MEDIUM')
    expect(e.compoundAt('7', 86_000)).toBe('UNKNOWN') // en el pit, antes de la línea
    expect(e.compoundAt('7', 95_000)).toBe('UNKNOWN') // cruzó la línea, aún parado
    expect(e.compoundAt('7', 106_000)).toBe('HARD')
    expect(e.compoundAt('7', 195_000)).toBe('HARD') // misma goma: sin hueco
  })

  it('al final de cada vuelta, la posición = Laps.Position', () => {
    const cases: [string, number, number][] = [
      ['1', 90000, 1],
      ['44', 91000, 2],
      ['16', 92000, 3],
      ['1', 180000, 1],
      ['16', 183000, 2],
      ['44', 260000, 3],
      ['1', 270000, 1],
      ['16', 275000, 2],
    ]
    for (const [car, t, pos] of cases) {
      const rows = lb.compute(t, [state('1', 0), state('44', 0), state('16', 0)])
      expect(rows.find((r) => r.car === car)!.position, `${car} @ ${t}`).toBe(pos)
    }
  })

  it('sin señal, pit y bandera azul (que caduca)', () => {
    const blue = new LeaderboardEngine(
      'race',
      timing,
      ev({
        raceControl: [
          {
            t: 100_000,
            lap: null,
            category: 'Flag',
            flag: 'BLUE',
            scope: 'Driver',
            sector: null,
            car: '44',
            text: 'WAVED BLUE FLAG FOR CAR 44 (BBB)',
            parsed: { kind: 'blue_flag', cars: ['44'], turn: null, lap: null },
          },
        ],
      }),
      drivers,
    )
    const rows = blue.compute(101_000, [state('1', 0), state('44', 0, true, true), state('16', 0, false)])
    const by = (c: string) => rows.find((r) => r.car === c)!
    expect(by('44').blueFlag).toBe(true)
    expect(by('44').inPit).toBe(true)
    expect(by('16').noSignal).toBe(true)
    expect(blue.compute(100_000 + BLUE_FLAG_MS + 1, [state('44', 0)]).find((r) => r.car === '44')!.blueFlag).toBe(false)
  })
})

describe('leaderboard con torre', () => {
  it('la posición y los gaps de la torre mandan; en libres sin gap, la diferencia de mejor vuelta', () => {
    const withStream = fakeTrzb('timing', {
      laps: timing.tables.laps!.columns as unknown as Record<string, ArrayLike<number>>,
      stream: {
        t: [1000, 1000, 1000, 200_000],
        car: [1, 44, 16, 44],
        position: [3, 2, 1, 1],
        gapToLeaderMs: [-1, -1, -1, -1],
        intervalMs: [-1, -1, -1, -1],
        lapsBehind: [0, 0, 0, 0],
      },
    })
    const lb = new LeaderboardEngine('fp1', withStream, ev(), drivers)
    const rows = lb.compute(200_500, [state('1', 0), state('44', 0), state('16', 0)])
    expect(rows.map((r) => r.car)).toEqual(['44', '16', '1'])
    // En t = 200,5 s, 44 aún no tiene vuelta válida; 16 lleva 91,000 y 1 lleva 90,000 (la mejor).
    expect(rows.map((r) => r.bestLapMs)).toEqual([null, 91000, 90000])
    expect(rows.map((r) => r.gapMs)).toEqual([null, 1000, 0])
  })
})

describe('leaderboard con el fixture real', () => {
  it('posiciones únicas 1…N y < 2 ms por actualización', async () => {
    const s = await loadFixture()
    const model = new ReplayModel(carTracks(s.motion, s.tangents), circuitModel(s.circuit), s.manifest.drivers)
    const lb = new LeaderboardEngine(s.manifest.session.type, s.timing, s.events, s.manifest.drivers)
    const { startMs, endMs } = s.manifest.session.playback
    const durations: number[] = []
    for (let t = startMs; t <= endMs; t += 2500) {
      model.update(t)
      const t0 = performance.now()
      const rows = lb.compute(t, model.states)
      durations.push(performance.now() - t0)
      expect(rows.map((r) => r.position)).toEqual(rows.map((_, i) => i + 1))
      expect(new Set(rows.map((r) => r.car)).size).toBe(s.manifest.drivers.length)
    }
    durations.sort((a, b) => a - b)
    expect(durations[Math.floor(durations.length * 0.95)]!).toBeLessThan(2)
  })
})
