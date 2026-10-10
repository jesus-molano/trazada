import { describe, expect, it } from 'vitest'
import { fakeTrzb, loadFixture } from '../../testing/fixture'
import { timingBuilder } from '../../testing/laps'
import { constantSpeed, syntheticTracks } from '../../testing/motion'
import { buildLapTable } from '../analysis/lapTable'
import { carTracks } from '../replay/motion'
import { circuitModel } from '../track/circuit'
import { roundDelta } from './delta'
import { CompareSession, createCompare } from './session'
import { traceCount } from './trace'

const L = 3000

/** Telemetría de los coches dados, una muestra por segundo de 0 a `toMs`. */
function carTelemetry(cars: number[], toMs: number) {
  const t: number[] = []
  const car: number[] = []
  const start: number[] = []
  const count: number[] = []
  for (const c of cars) {
    car.push(c)
    start.push(t.length)
    let n = 0
    for (let x = 0; x <= toMs; x += 1000, n++) t.push(x)
    count.push(n)
  }
  return fakeTrzb('car', {
    cars: { car, start, count },
    tel: {
      t,
      speed: t.map(() => 200),
      rpm: t.map(() => 10_000),
      gear: t.map(() => 7),
      throttle: t.map(() => 90),
      brake: t.map(() => 0),
      drs: t.map(() => 255),
    },
  })
}

/**
 * Carrera sintética: el coche 1 a 50 m/s (vueltas de 60 s), el 2 a 40 m/s (vueltas de 75 s) y el 3 con vueltas pero
 * sin posiciones. Las vueltas de 3000 m.
 */
function syntheticSession() {
  const timing = timingBuilder()
    .run(1, 0, [60_000, 60_000, 60_000, 60_000])
    .run(2, 0, [75_000, 75_000, 75_000])
    .run(3, 0, [70_000, 70_000])
    .build()
  const tracks = syntheticTracks([
    constantSpeed(1, { fromMs: 0, toMs: 250_000, stepMs: 250, speedMps: 50 }),
    constantSpeed(2, { fromMs: 0, toMs: 250_000, stepMs: 250, speedMps: 40 }),
  ])
  return createCompare({
    session: { manifest: { session: { type: 'race' } }, car: carTelemetry([1, 2], 250_000) },
    model: { tracks },
    leaderboard: { lapTable: buildLapTable('race', timing, []) },
    circuit: { centerline: { length: L } },
  })
}

describe('comparación en una sesión', () => {
  it('misma vuelta (por defecto en carrera) con B por detrás: diferencia en la distancia de B; el fantasma sería el futuro', () => {
    const cmp = syntheticSession()
    expect(cmp.defaultRef).toBe('same')
    const f = cmp.frame('1', '2', 'same', 90_000)
    expect(f.missing).toBeNull()
    expect([f.lapA, f.lapB]).toEqual([2, 2])
    expect(f.delta.state).toBe('ok')
    expect(f.delta.dA).toBeCloseTo(1500, 6)
    expect(f.delta.at).toBeCloseTo(600, 6)
    expect(f.delta.ms).toBeCloseTo(-3000, 3)
    expect(f.ghost.state).toBe('notYet')
  })

  it('mejor y última vuelta: fijadas al empezar A su vuelta, nunca la 1; fantasma de B desplazado en el tiempo', () => {
    const cmp = syntheticSession()
    // A en su vuelta 3 (desde 120 s): B solo había completado la 1, que no cuenta.
    expect(cmp.frame('1', '2', 'best', 130_000).missing).toBe('noLap')
    expect(cmp.frame('1', '2', 'last', 130_000).missing).toBe('noLap')
    // A en su vuelta 4 (desde 180 s): la 2 de B (75–150 s).
    for (const mode of ['best', 'last'] as const) {
      const f = cmp.frame('1', '2', mode, 200_000)
      expect(f.missing).toBeNull()
      expect([f.lapA, f.lapB, f.lapMsB]).toEqual([4, 2, 75_000])
      expect(f.delta.ms).toBeCloseTo(20_000 - 25_000, 3)
      expect(f.ghost.state).toBe('visible')
      expect(f.ghost.t).toBe(95_000)
      expect(f.ghost.sample.s).toBeCloseTo(3800, 6)
    }
  })

  it('sin dato, con su motivo: B sin posiciones, B sin vueltas, A fuera de vuelta', () => {
    const cmp = syntheticSession()
    expect(cmp.frame('1', '3', 'same', 90_000).missing).toBe('noPosition')
    expect(cmp.frame('1', '9', 'same', 90_000).missing).toBe('noLap')
    expect(cmp.frame('3', '1', 'same', 90_000).missing).toBe('noLapA')
    // A ya no está en ninguna vuelta (tras cerrar la última).
    expect(cmp.frame('1', '2', 'same', 245_000).missing).toBe('noLapA')
    // Misma vuelta que B aún no ha empezado: la 4 de A (180 s) frente a la 4 de B, que no existe.
    expect(cmp.frame('1', '2', 'same', 200_000).missing).toBe('noLap')
    // Sin referencia, el cursor de las gráficas sigue sabiendo dónde va A.
    const f = cmp.frame('1', '9', 'same', 90_000)
    expect(f.delta.state).toBe('noData')
    expect(f.delta.dA).toBeCloseTo(1500, 6)
  })

  it('memoizada por argumentos: el panel y el fantasma comparten el cálculo del frame', () => {
    const cmp = syntheticSession()
    const f = cmp.frame('1', '2', 'same', 90_000)
    const ms = f.delta.ms
    expect(cmp.frame('1', '2', 'same', 90_000)).toBe(f)
    expect(f.delta.ms).toBe(ms)
    cmp.frame('1', '2', 'same', 95_000)
    expect(f.delta.ms).not.toBe(ms)
  })

  it('diferencia oficial al cerrar la vuelta: tiempos de vuelta (dato real), pendiente hasta que B cierre la suya', () => {
    const cmp = syntheticSession()
    expect(cmp.official('1', '2', 'same', 50_000)).toBeNull()
    expect(cmp.official('1', '2', 'same', 130_000)).toMatchObject({ lapA: 2, lapB: 2, msA: 60_000, msB: null, diffMs: null, pending: true })
    expect(cmp.official('1', '2', 'same', 160_000)).toMatchObject({ lapA: 2, lapB: 2, diffMs: -15_000, pending: false, missing: null })
    expect(cmp.official('1', '2', 'best', 200_000)).toMatchObject({ lapA: 3, lapB: null, diffMs: null, missing: 'noLap' })
    expect(cmp.official('1', '2', 'best', 245_000)).toMatchObject({ lapA: 4, lapB: 2, diffMs: -15_000 })
  })

  it('trazas por distancia de la vuelta de A y de la referencia de B, recortadas al instante actual', () => {
    const cmp = syntheticSession()
    const f = cmp.frame('1', '2', 'best', 200_000)
    const a = cmp.traceA(f)!
    const b = cmp.traceB(f)!
    expect(a.d.length).toBe(60) // 180–239 s
    expect(traceCount(a, 200_000)).toBe(21)
    expect(b.d.length).toBe(75)
    expect(traceCount(b, 200_000)).toBe(75)
    for (const tr of [a, b]) for (const d of tr.d) expect(d >= 0 && d < L).toBe(true)
    // Memoizadas: la misma traza mientras no cambie la vuelta.
    expect(cmp.traceA(cmp.frame('1', '2', 'best', 210_000))).toBe(a)
  })
})

describe('con el fixture real (Spa, libres 1, extracto de 9 minutos)', () => {
  async function fixtureCompare() {
    const s = await loadFixture()
    return new CompareSession({
      session: s,
      model: { tracks: carTracks(s.motion, s.tangents) },
      leaderboard: { lapTable: buildLapTable(s.manifest.session.type, s.timing, s.events.raceControl) },
      circuit: circuitModel(s.circuit),
    })
  }

  it('GAS frente a ALB en la misma vuelta: diferencia y fantasma; la oficial al cerrar los dos la vuelta', async () => {
    const cmp = await fixtureCompare()
    expect(cmp.defaultRef).toBe('best')
    const f = cmp.frame('10', '23', 'same', 4_470_000)
    expect(f.missing).toBeNull()
    expect([f.lapA, f.lapB]).toEqual([22, 22])
    expect(f.delta.state).toBe('ok')
    expect(Math.abs(f.delta.ms)).toBeLessThan(5000)
    expect(f.ghost.state).toBe('visible')
    const early = roundDelta(f.delta.ms)
    // Ya con la vuelta de ALB cerrada (y la de GAS aún no): otra diferencia, y el fantasma sigue en su vuelta.
    const late = cmp.frame('10', '23', 'same', 4_525_000)
    expect(late.delta.state).toBe('ok')
    expect(roundDelta(late.delta.ms)).not.toBe(early)
    expect(late.ghost.state).toBe('visible')
    expect(late.ghost.t).toBeLessThan(4_525_000)
    expect(cmp.official('10', '23', 'same', 4_540_000)).toMatchObject({ lapA: 22, lapB: 22, diffMs: 114_436 - 115_235 })
  })

  it('LEC frente a NOR: la mejor vuelta de NOR cae fuera del extracto (sin dato); la última sí está', async () => {
    const cmp = await fixtureCompare()
    const best = cmp.frame('16', '1', 'best', 4_500_000)
    expect(best.missing).toBe('noPosition')
    expect(best.lapB).toBe(10)
    expect(best.delta.state).toBe('noData')
    const last = cmp.frame('16', '1', 'last', 4_500_000)
    expect(last.missing).toBeNull()
    expect([last.lapA, last.lapB]).toEqual([21, 16])
    expect(last.delta.state).toBe('ok')
    expect(last.ghost.state).toBe('visible')
    expect(cmp.traceA(last)!.d.length).toBeGreaterThan(10)
    expect(cmp.traceB(last)!.d.length).toBeGreaterThan(100)
  })
})
