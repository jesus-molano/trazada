import { describe, expect, it } from 'vitest'
import { timingBuilder } from '../../testing/laps'
import { buildLapTable } from './lapTable'
import { countUpTo, crossingTimes, lapStartMs, leaderLapAt, raceTrace } from './raceTrace'

/**
 * Carrera sintética: 1 lidera las tres primeras vueltas y 44 le pasa en la 4; 16 se retira tras la 2 (con un
 * registro residual de 20 s, que no es un paso por meta); 63 va doblado (su vuelta 3 acaba después de que el
 * primero complete la 4). La vuelta 1 no tiene tiempo oficial, pero sí paso por meta.
 */
const timing = timingBuilder()
  .run(1, 0, [100_000, 90_000, 90_000, 90_000], { lap1NoTime: true })
  .run(44, 0, [101_500, 90_500, 91_000, 85_000], { lap1NoTime: true })
  .run(16, 0, [102_000, 91_000, 20_000], { lap1NoTime: true })
  .run(63, 0, [105_000, 95_000, 180_000], { lap1NoTime: true })
  .build()
const table = buildLapTable('race', timing, [])
const gaps = (trace: ReturnType<typeof raceTrace>, car: string) => [...trace.series.find((s) => s.car === car)!.gapMs]

describe('race trace', () => {
  it('gap al primero en cada paso por meta, vuelta a vuelta (el primero de cada vuelta, el que la completa antes)', () => {
    const trace = raceTrace(table)
    expect([...trace.laps]).toEqual([1, 2, 3, 4])
    expect([...trace.leaderMs]).toEqual([100_000, 190_000, 280_000, 368_000])
    expect(trace.leaderCar).toEqual(['1', '1', '1', '44'])
    expect(gaps(trace, '1')).toEqual([0, 0, 0, 2_000])
    expect(gaps(trace, '44')).toEqual([1_500, 2_000, 3_000, 0])
    expect(trace.series.map((s) => s.car)).toEqual(['1', '44', '16', '63'])
  })

  it('la vuelta 1 entra con su paso por meta aunque no tenga tiempo oficial', () => {
    expect(table.cars.get('1')!.lapMs[0]).toBe(-1)
    expect(gaps(raceTrace(table), '63')[0]).toBe(5_000)
  })

  it('un coche doblado puede estar a más de una vuelta del primero (sin recortar)', () => {
    const g = gaps(raceTrace(table), '63')
    expect(g.slice(0, 3)).toEqual([5_000, 10_000, 100_000])
    expect(g[2]).toBeGreaterThan(90_000)
    expect(g[3]).toBeNaN()
  })

  it('un coche retirado acaba su serie: después, sin dato (NaN), sin rellenar; el registro residual no cuenta', () => {
    const trace = raceTrace(table)
    const s16 = trace.series.find((s) => s.car === '16')!
    expect(s16.lastLap).toBe(2)
    expect([...s16.gapMs].slice(0, 2)).toEqual([2_000, 3_000])
    expect(s16.gapMs[2]).toBeNaN()
    expect(s16.gapMs[3]).toBeNaN()
  })

  it('«Sin spoilers»: solo los pasos por meta hasta el corte', () => {
    const trace = raceTrace(table, 195_000)
    expect([...trace.laps]).toEqual([1, 2])
    expect(gaps(trace, '1')).toEqual([0, 0])
    expect(gaps(trace, '16')).toEqual([2_000, 3_000])
    // 63 cruza la vuelta 2 a los 200 s: después del corte.
    expect(gaps(trace, '63')[0]).toBe(5_000)
    expect(gaps(trace, '63')[1]).toBeNaN()
    // Justo en el instante del paso por meta, cuenta.
    expect(gaps(raceTrace(table, 200_000), '63')).toEqual([5_000, 10_000])
  })

  it('antes de cualquier paso por meta, o sin vueltas, vacío', () => {
    expect(raceTrace(table, 50_000).laps).toHaveLength(0)
    const empty = raceTrace(buildLapTable('race', timingBuilder().build(), []))
    expect(empty.laps).toHaveLength(0)
    expect(empty.series).toEqual([])
  })

  it('vuelta en curso del primero: la siguiente a la última completada, sin pasar de la última de la tabla', () => {
    expect(leaderLapAt(table, -1)).toBeNull()
    expect(leaderLapAt(table, 50_000)).toBe(1)
    expect(leaderLapAt(table, 100_000)).toBe(2)
    expect(leaderLapAt(table, 369_000)).toBe(4)
    expect(leaderLapAt(table, 1e9)).toBe(4)
    // Sin inicio conocido de la vuelta 1, hasta el primer paso por meta no se sabe.
    const noStart = buildLapTable('race', timingBuilder().lap(1, 1, { endMs: 100_000 }).lap(1, 2, { endMs: 190_000, lapMs: 90_000 }).build(), [])
    expect(leaderLapAt(noStart, 50_000)).toBeNull()
    expect(leaderLapAt(noStart, 150_000)).toBe(2)
  })

  it('inicio de una vuelta para saltar: el primer inicio oficial; sin él, el primer paso por meta de la anterior', () => {
    expect(lapStartMs(table, 1)).toBe(0)
    expect(lapStartMs(table, 3)).toBe(190_000)
    expect(lapStartMs(table, 9)).toBeNull()
    const noStart = buildLapTable('race', timingBuilder().lap(1, 1, { endMs: 100_000 }).lap(1, 2, { endMs: 190_000, lapMs: 90_000 }).build(), [])
    expect(lapStartMs(noStart, 2)).toBe(100_000)
    expect(lapStartMs(noStart, 1)).toBeNull()
  })

  it('instantes de cambio: los pasos por meta reales, ordenados; la versión en t es cuántos hay hasta t', () => {
    const times = crossingTimes(table)
    expect([...times]).toEqual([...times].sort((a, b) => a - b))
    // 4 + 4 + 2 (sin el residual) + 3.
    expect(times).toHaveLength(13)
    expect(countUpTo(times, 99_999)).toBe(0)
    expect(countUpTo(times, 100_000)).toBe(1)
    expect(countUpTo(times, 1e9)).toBe(13)
  })
})
