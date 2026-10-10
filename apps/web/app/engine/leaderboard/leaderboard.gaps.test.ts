/**
 * Datos honestos en el leaderboard: posición sin dato cuando no la da ningún dato de cronometraje, vueltas
 * anuladas desde el mensaje de dirección de carrera, nunca un gap o intervalo negativo y, en clasificación,
 * gaps con la mejor vuelta de la tanda en curso (Q1/Q2/Q3).
 */
import type { DriverInfo, RaceControlEvent, SessionEvents } from '@trazada/schema'
import { describe, expect, it } from 'vitest'
import { fakeTrzb } from '../../testing/fixture'
import type { CarState } from '../replay/ReplayModel'
import { type LeaderboardRow, LeaderboardEngine, qualifyingSegments } from './leaderboard'

const drivers: DriverInfo[] = ['1', '44', '16'].map((n) => ({
  number: n,
  tla: { '1': 'AAA', '44': 'BBB', '16': 'CCC' }[n]!,
  first: '',
  last: '',
  team: '',
  color: '#123456',
}))

const ev = (raceControl: RaceControlEvent[] = []): SessionEvents => ({
  schema: 'trazada.events',
  schemaVersion: '1.0.0',
  raceControl,
  sectorFlags: [],
  windows: [],
})

const rc = (t: number, kind: string, text: string, cars: string[] = []): RaceControlEvent => ({
  t,
  lap: null,
  category: 'Other',
  flag: null,
  scope: null,
  sector: null,
  car: null,
  text,
  parsed: { kind, cars, turn: null, lap: null },
})

const state = (car: string): CarState => ({
  car,
  driver: null,
  visible: true,
  inPit: false,
  transition: false,
  s: 0,
  speedMps: 0,
  x: 0,
  y: 0,
  z: 0,
  heading: 0,
})
const states = drivers.map((d) => state(d.number))

type Tower = { t: number[]; car: number[]; position: number[] }
const noTower: Tower = { t: [], car: [], position: [] }

/** Tabla de vueltas mínima, filas [coche, vuelta, inicio, fin, tiempo, anulada?], y torre opcional (sin gaps). */
function timing(rows: [number, number, number, number, number, number?][], tower: Tower = noTower) {
  const col = (k: number) => rows.map((r) => r[k] ?? 0)
  const none = (n: number) => Array.from({ length: n }, () => -1)
  return fakeTrzb('timing', {
    laps: {
      car: col(0),
      lap: col(1),
      startMs: col(2),
      endMs: col(3),
      lapMs: col(4),
      s1Ms: none(rows.length),
      compound: rows.map(() => 2),
      tyreLife: rows.map(() => 1),
      pitInMs: none(rows.length),
      pitOutMs: none(rows.length),
      position: rows.map(() => 0),
      deleted: col(5),
    },
    stream: {
      ...tower,
      gapToLeaderMs: none(tower.t.length),
      intervalMs: none(tower.t.length),
      lapsBehind: tower.t.map(() => 0),
    },
  })
}

const at = (rows: LeaderboardRow[], car: string) => rows.find((r) => r.car === car)!

describe('posición sin dato (ni torre, ni paso por meta, ni vuelta válida)', () => {
  it('carrera sin torre: antes de pasar por meta, el puesto en la lista no es una posición', () => {
    const race = timing([
      [1, 1, 0, 90_000, -1],
      [44, 1, 0, 91_000, -1],
      [16, 1, 0, 92_000, -1],
    ])
    const lb = new LeaderboardEngine('race', race, ev(), drivers)
    // Antes de la salida (p. ej. Suzuka dev): el orden sería el de los dorsales, no una clasificación.
    expect(lb.compute(50_000, states).map((r) => r.positionKnown)).toEqual([false, false, false])
    expect(lb.compute(90_500, states).map((r) => [r.car, r.positionKnown])).toEqual([
      ['1', true],
      ['44', false],
      ['16', false],
    ])
    expect(lb.compute(95_000, states).every((r) => r.positionKnown)).toBe(true)
  })

  it('libres sin torre: sin vuelta válida, sin posición', () => {
    const fp = timing([
      [1, 1, 0, 90_000, 90_000],
      [44, 1, 0, 95_000, -1],
    ])
    const rows = new LeaderboardEngine('fp1', fp, ev(), drivers).compute(100_000, states)
    expect(rows.map((r) => [r.car, r.positionKnown])).toEqual([
      ['1', true],
      ['44', false],
      ['16', false],
    ])
  })

  it('con torre: un coche que la torre no lista no tiene posición', () => {
    const fp = timing([[1, 1, 0, 90_000, 90_000]], { t: [1000, 1000], car: [1, 44], position: [1, 2] })
    const rows = new LeaderboardEngine('fp1', fp, ev(), drivers).compute(100_000, states)
    expect(rows.map((r) => [r.car, r.position, r.positionKnown])).toEqual([
      ['1', 1, true],
      ['44', 2, true],
      ['16', 3, false],
    ])
  })
})

describe('vueltas anuladas e intervalos', () => {
  // 1 hace 1:30.000 en su vuelta 2 (acaba a los 180 s) y se la anulan con un mensaje a los 250 s; 16 hace 1:31.000.
  const fp = timing([
    [1, 1, 0, 90_000, -1],
    [1, 2, 90_000, 180_000, 90_000, 1],
    [16, 1, 0, 92_000, -1],
    [16, 2, 92_000, 183_000, 91_000],
  ])
  const msg = rc(250_000, 'lap_deleted', 'CAR 1 (AAA) TIME 1:30.000 DELETED - TRACK LIMITS AT TURN 4 LAP 3 13:40:24', ['1'])

  it('la vuelta anulada cuenta hasta el mensaje de dirección de carrera, no desde que acaba', () => {
    const lb = new LeaderboardEngine('fp1', fp, ev([msg]), drivers)
    const before = lb.compute(200_000, states)
    expect(before.slice(0, 2).map((r) => r.car)).toEqual(['1', '16'])
    expect(at(before, '1').bestLapMs).toBe(90_000)
    expect(at(before, '16').gapMs).toBe(1000)
    const after = lb.compute(250_000, states)
    expect(after[0]!.car).toBe('16')
    expect(at(after, '1').bestLapMs).toBeNull()
    expect(at(after, '1').positionKnown).toBe(false)
  })

  it('sin mensaje de anulación, la vuelta cuenta como anulada desde que acaba (el dato no dice cuándo)', () => {
    const rows = new LeaderboardEngine('fp1', fp, ev(), drivers).compute(200_000, states)
    expect(rows[0]!.car).toBe('16')
    expect(at(rows, '1').bestLapMs).toBeNull()
  })

  it('torre y mejores vueltas desacompasadas: el intervalo negativo queda sin dato', () => {
    // La torre aún pone a 1 delante, pero según la tabla de vueltas 16 tiene mejor tiempo.
    const tower = timing(
      [
        [1, 2, 90_000, 180_000, 91_000],
        [16, 2, 92_000, 183_000, 90_030],
      ],
      { t: [1000, 1000], car: [1, 16], position: [1, 2] },
    )
    const rows = new LeaderboardEngine('fp1', tower, ev(), drivers).compute(200_000, states)
    expect(rows.slice(0, 2).map((r) => r.car)).toEqual(['1', '16'])
    expect(at(rows, '16').intervalMs).toBeNull()
    for (const r of rows) {
      expect(r.gapMs === null || r.gapMs >= 0).toBe(true)
      expect(r.intervalMs === null || r.intervalMs >= 0).toBe(true)
    }
  })
})

describe('clasificación: gaps por tanda (Q1/Q2/Q3)', () => {
  // Q1 acaba con la bandera a cuadros a los 1000 s; Q2 empieza con la luz verde a los 1400 s (con una bandera
  // roja y otra luz verde a mitad, sin bandera a cuadros: sigue siendo Q2) y acaba a los 2000 s.
  const events = ev([
    rc(1_000_000, 'chequered_flag', 'CHEQUERED FLAG'),
    rc(1_400_000, 'green_light', 'GREEN LIGHT - PIT EXIT OPEN'),
    rc(1_620_000, 'red_flag', 'RED FLAG'),
    rc(1_640_000, 'green_light', 'GREEN LIGHT - PIT EXIT OPEN'),
    rc(2_000_000, 'chequered_flag', 'CHEQUERED FLAG'),
  ])
  const laps: [number, number, number, number, number][] = [
    // 1: 1:30.000 en Q1; 1:29.000 lanzada antes de la bandera a cuadros (cuenta en Q1); 1:30.500 en Q2.
    [1, 2, 410_000, 500_000, 90_000],
    [1, 3, 950_000, 1_039_000, 89_000],
    [1, 4, 1_500_000, 1_590_500, 90_500],
    // 44: 1:30.800 en Q1 y 1:30.200 en Q2.
    [44, 2, 420_000, 510_800, 90_800],
    [44, 4, 1_510_000, 1_600_200, 90_200],
    // 16: 1:31.500 en Q1; eliminado (sin vueltas en Q2).
    [16, 2, 430_000, 521_500, 91_500],
  ]
  const q = timing(laps)

  it('tandas: la bandera a cuadros cierra; la luz verde siguiente abre (tras una roja, sigue la misma)', () => {
    expect(qualifyingSegments(events.raceControl)).toEqual({ starts: [-Infinity, 1_400_000], ends: [1_000_000, 2_000_000] })
    const lb = new LeaderboardEngine('q', q, events, drivers)
    expect([0, 1_100_000, 1_400_000, 1_700_000, 2_100_000].map((t) => lb.segmentAt(t))).toEqual([0, 0, 1, 1, 1])
    // Fuera de clasificación no hay tandas.
    expect(new LeaderboardEngine('fp1', q, events, drivers).segmentAt(1_700_000)).toBe(0)
  })

  it('en Q2 con torre, el gap es con la mejor vuelta de Q2 (no la de toda la sesión) y nunca negativo', () => {
    const tower = timing(laps, { t: [1_600_300, 1_600_300, 1_600_300], car: [44, 1, 16], position: [1, 2, 3] })
    const rows = new LeaderboardEngine('q', tower, events, drivers).compute(1_650_000, states)
    expect(rows.map((r) => r.car)).toEqual(['44', '1', '16'])
    expect(rows.map((r) => r.bestLapMs)).toEqual([90_200, 90_500, null])
    expect(rows.map((r) => r.gapMs)).toEqual([0, 300, null])
    expect(rows.map((r) => r.intervalMs)).toEqual([null, 300, null])
  })

  it('entre Q1 y Q2 sigue mandando Q1 (también la vuelta lanzada antes de la bandera a cuadros)', () => {
    const rows = new LeaderboardEngine('q', q, events, drivers).compute(1_100_000, states)
    expect(rows.map((r) => r.car)).toEqual(['1', '44', '16'])
    expect(rows.map((r) => r.gapMs)).toEqual([0, 1800, 2500])
  })

  it('sin torre, en Q2: primero los que tienen tiempo en Q2; después, por su tiempo de Q1 y sin gap', () => {
    const lb = new LeaderboardEngine('q', q, events, drivers)
    const rows = lb.compute(1_650_000, states)
    expect(rows.map((r) => [r.car, r.positionKnown])).toEqual([
      ['44', true],
      ['1', true],
      ['16', true],
    ])
    expect(rows.map((r) => r.gapMs)).toEqual([0, 300, null])
    // Antes de que nadie marque en Q2, nadie tiene gap (no se mezclan tiempos de Q1 con los de Q2).
    const early = lb.compute(1_450_000, states)
    expect(early.map((r) => r.car)).toEqual(['1', '44', '16'])
    expect(early.map((r) => r.gapMs)).toEqual([null, null, null])
  })
})
