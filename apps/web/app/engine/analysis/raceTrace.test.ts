import { describe, expect, it } from 'vitest'
import { timingBuilder } from '../../testing/laps'
import { buildLapTable } from './lapTable'
import { countUpTo, crossingTimes, lapStartMs, leaderLapAt, raceTrace, STOPPED_AFTER_LAPS, stoppedCars } from './raceTrace'

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

describe('coches que dejan de pasar por meta', () => {
  /**
   * 1 completa seis vueltas (pasos a los 100, 190, 280, 370, 460 y 550 s); 16 deja de cruzar tras la 2 (193 s); 63 va
   * más lento y acaba una vuelta por detrás (cruza a los 105, 200, 295, 390 y 485 s); 77 se para en boxes tres minutos
   * en su vuelta 3 y sigue.
   */
  const timing = timingBuilder()
    .run(1, 0, [100_000, 90_000, 90_000, 90_000, 90_000, 90_000], { lap1NoTime: true })
    .run(16, 0, [102_000, 91_000], { lap1NoTime: true })
    .run(63, 0, [105_000, 95_000, 95_000, 95_000, 95_000], { lap1NoTime: true })
    .run(77, 0, [103_000, 91_000, 270_000, 91_000], { lap1NoTime: true })
    .build()
  const table = buildLapTable('race', timing, [])

  it(`detenido: el primero completa ${STOPPED_AFTER_LAPS} vueltas desde su último paso (con su última vuelta)`, () => {
    expect(STOPPED_AFTER_LAPS).toBe(3)
    expect([...stoppedCars(table)]).toEqual([['16', 2]])
  })

  it('uno que va por detrás sigue cruzando la línea cada vuelta: nunca cuenta', () => {
    for (const cutoff of [200_000, 300_000, 400_000, 470_000, 549_000, Infinity]) expect(stoppedCars(table, cutoff).has('63'), String(cutoff)).toBe(false)
  })

  it('con corte: solo los pasos hasta el corte (sin spoilers, el detenido aún no lo es; parado en boxes, mientras dure)', () => {
    // A los 400 s el primero solo ha completado dos vueltas desde que 16 cruzó por última vez.
    expect(stoppedCars(table, 400_000).has('16')).toBe(false)
    expect(stoppedCars(table, 460_000).get('16')).toBe(2)
    // 77 cruza la 2 a los 194 s y la 3 a los 464 s: entre medias, el primero completa tres vueltas.
    expect(stoppedCars(table, 463_000).get('77')).toBe(2)
    expect(stoppedCars(table, 464_000).has('77')).toBe(false)
  })

  it('un doblado de verdad (tres vueltas abajo al final) sigue cruzando: nunca cuenta, en ningún instante', () => {
    // 1: doce vueltas de 90 s. 2: vueltas de 120 s; el primero lo dobla cada tres vueltas y acaba tres por delante.
    const lapped = buildLapTable(
      'race',
      timingBuilder()
        .run(1, 0, Array.from({ length: 12 }, (_, i) => (i ? 90_000 : 100_000)), { lap1NoTime: true })
        .run(2, 0, Array.from({ length: 9 }, (_, i) => (i ? 120_000 : 101_000)), { lap1NoTime: true })
        .build(),
      [],
    )
    expect(raceTrace(lapped).series.find((s) => s.car === '2')!.lastLap).toBe(9)
    for (let t = 0; t <= 1_200_000; t += 5_000) expect(stoppedCars(lapped, t).has('2'), String(t)).toBe(false)
    expect(stoppedCars(lapped).size).toBe(0)
  })
})

