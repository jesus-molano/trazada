import { describe, expect, it } from 'vitest'
import { timingBuilder } from '../../testing/laps'
import { buildLapTable } from './lapTable'
import {
  countUpTo,
  crossingTimes,
  lapStartMs,
  lastCrossings,
  leaderLapAt,
  legendOrder,
  raceTrace,
  STOPPED_AFTER_LAPS,
  stoppedCars,
} from './raceTrace'

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

  it('posición en la línea: el orden de paso de cada vuelta; 0 sin paso por meta (D49)', () => {
    const pos = (trace: ReturnType<typeof raceTrace>, car: string) => [...trace.series.find((s) => s.car === car)!.posAtLine]
    const trace = raceTrace(table)
    expect(pos(trace, '1')).toEqual([1, 1, 1, 2])
    expect(pos(trace, '44')).toEqual([2, 2, 2, 1])
    // 16 no pasa la vuelta 3 (su registro residual no es un paso por meta).
    expect(pos(trace, '16')).toEqual([3, 3, 0, 0])
    // 63, doblado: cruza la vuelta 3 después de que el primero complete la 4, y es el tercero de los que la completan.
    expect(pos(trace, '63')).toEqual([4, 4, 3, 0])
  })

  it('posición en la línea con corte: solo cuentan los pasos hasta el corte', () => {
    const trace = raceTrace(table, 195_000)
    const pos = (car: string) => [...trace.series.find((s) => s.car === car)!.posAtLine]
    expect(pos('1')).toEqual([1, 1])
    expect(pos('16')).toEqual([3, 3])
    // 63 cruza la vuelta 2 a los 200 s: después del corte, sin posición.
    expect(pos('63')).toEqual([4, 0])
  })

  it('último paso por meta de cada coche hasta el corte', () => {
    expect([...lastCrossings(table)]).toEqual([
      ['1', { lap: 4, ms: 370_000 }],
      ['44', { lap: 4, ms: 368_000 }],
      ['16', { lap: 2, ms: 193_000 }],
      ['63', { lap: 3, ms: 380_000 }],
    ])
    expect(lastCrossings(table, 101_000)).toEqual(new Map([['1', { lap: 1, ms: 100_000 }]]))
    expect(lastCrossings(table, 50_000).size).toBe(0)
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
   * más lento (cruza a los 105, 200, 295, 390, 485 y 580 s: como todo el que sigue en marcha, después de que el primero
   * reciba la bandera); 77 se para en boxes tres minutos en su vuelta 3 y sigue (cruza la 4 a los 555 s).
   */
  const timing = timingBuilder()
    .run(1, 0, [100_000, 90_000, 90_000, 90_000, 90_000, 90_000], { lap1NoTime: true })
    .run(16, 0, [102_000, 91_000], { lap1NoTime: true })
    .run(63, 0, [105_000, 95_000, 95_000, 95_000, 95_000, 95_000], { lap1NoTime: true })
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
    // 1: doce vueltas de 90 s (bandera a los 1090 s). 2: vueltas de 125 s; acaba tres vueltas por detrás y, como todo el
    // que sigue en marcha, cruza la línea después de la bandera del primero (su vuelta 9, a los 1101 s).
    const lapped = buildLapTable(
      'race',
      timingBuilder()
        .run(1, 0, Array.from({ length: 12 }, (_, i) => (i ? 90_000 : 100_000)), { lap1NoTime: true })
        .run(2, 0, Array.from({ length: 9 }, (_, i) => (i ? 125_000 : 101_000)), { lap1NoTime: true })
        .build(),
      [],
    )
    expect(raceTrace(lapped).series.find((s) => s.car === '2')!.lastLap).toBe(9)
    for (let t = 0; t <= 1_200_000; t += 5_000) expect(stoppedCars(lapped, t).has('2'), String(t)).toBe(false)
    expect(stoppedCars(lapped).size).toBe(0)
  })
})

describe('coches que dejan de pasar por meta al final de los datos (D49)', () => {
  /**
   * 1 completa seis vueltas (bandera a los 550 s). 9 da cinco y su último paso es a los 500 s: después ya no cruza.
   * 63, doblado (vueltas de 110 s), cruza su quinta vuelta a los 545 s y la sexta a los 655 s, después de la bandera.
   */
  const timing = timingBuilder()
    .run(1, 0, [100_000, 90_000, 90_000, 90_000, 90_000, 90_000], { lap1NoTime: true })
    .run(9, 0, [100_000, 100_000, 100_000, 100_000, 100_000], { lap1NoTime: true })
    .run(63, 0, [105_000, 110_000, 110_000, 110_000, 110_000, 110_000], { lap1NoTime: true })
    .build()
  const table = buildLapTable('race', timing, [])

  it('uno al que le falta la última vuelta cuenta como detenido solo cuando se ven todos los pasos', () => {
    // El primero solo cruza una vez (550 s) tras el último paso de 9: la regla de las tres vueltas no lo da.
    expect(stoppedCars(table, 600_000).has('9')).toBe(false)
    // Hasta el último paso de la tabla (63, a los 655 s), no se sabe si 9 volverá a cruzar.
    expect(stoppedCars(table, 654_999).has('9')).toBe(false)
    expect(stoppedCars(table, 655_000).get('9')).toBe(5)
    expect([...stoppedCars(table)]).toEqual([['9', 5]])
  })

  it('un doblado que cruza después del último paso del primero nunca cuenta', () => {
    for (const cutoff of [545_000, 600_000, 655_000, Infinity]) expect(stoppedCars(table, cutoff).has('63'), String(cutoff)).toBe(false)
    expect(stoppedCars(table).has('1')).toBe(false)
  })
})

describe('orden de la leyenda del race trace (D49)', () => {
  it('los que siguen, por el valor de su último dato (arriba, el menor); los detenidos, aparte', () => {
    const trace = raceTrace(table)
    const order = legendOrder(trace, stoppedCars(table), lastCrossings(table))
    // 44 acaba a 0, 1 a +2 s y 63 (doblado) a +100 s; 16 dejó de cruzar tras la 2.
    expect(order).toEqual({ running: ['44', '1', '63'], stopped: ['16'] })
  })

  it('los que aún no tienen ningún paso, detrás y en el orden dado', () => {
    const at = (cutoff: number, order?: string[]) => legendOrder(raceTrace(table, cutoff), stoppedCars(table, cutoff), lastCrossings(table, cutoff), order)
    expect(at(101_000)).toEqual({ running: ['1', '44', '16', '63'], stopped: [] })
    expect(at(101_000, ['63', '16', '44', '1'])).toEqual({ running: ['1', '63', '16', '44'], stopped: [] })
    expect(at(50_000, ['63', '16', '44', '1']).running).toEqual(['63', '16', '44', '1'])
  })

  it('empate en el último dato: antes el que cruzó antes; con el mismo paso, el orden dado', () => {
    // Con corte a los 281 s, 2 y 3 acaban a +1 s del primero: 2 en la vuelta 2 (191 s) y 3 en la 3 (281 s). 4 y 5
    // cruzan juntos la 2 (193 s), a +3 s; su vuelta 3 queda después del corte.
    const tied = buildLapTable(
      'race',
      timingBuilder()
        .run(1, 0, [100_000, 90_000, 90_000], { lap1NoTime: true })
        .run(2, 0, [100_500, 90_500], { lap1NoTime: true })
        .run(3, 0, [101_000, 90_000, 90_000], { lap1NoTime: true })
        .run(4, 0, [102_000, 91_000, 92_000], { lap1NoTime: true })
        .run(5, 0, [102_000, 91_000, 92_000], { lap1NoTime: true })
        .build(),
      [],
    )
    const trace = raceTrace(tied, 281_000)
    const order = legendOrder(trace, new Map(), lastCrossings(tied, 281_000), ['5', '4', '3', '2', '1'])
    expect(order.running).toEqual(['1', '2', '3', '5', '4'])
  })

  it('detenidos: por última vuelta, de más a menos, y luego por su último paso (como la clasificación)', () => {
    const t = buildLapTable(
      'race',
      timingBuilder()
        .run(1, 0, Array.from({ length: 10 }, (_, i) => (i ? 90_000 : 100_000)), { lap1NoTime: true })
        // 7 y 8 dejan de cruzar tras la 6 (8 antes); 9, tras la 2.
        .run(7, 0, [101_000, 90_000, 90_000, 90_000, 90_000, 92_000], { lap1NoTime: true })
        .run(8, 0, [101_000, 90_000, 90_000, 90_000, 90_000, 91_000], { lap1NoTime: true })
        .run(9, 0, [103_000, 90_000], { lap1NoTime: true })
        .build(),
      [],
    )
    const order = legendOrder(raceTrace(t), stoppedCars(t), lastCrossings(t), ['9', '7', '8', '1'])
    expect(order).toEqual({ running: ['1'], stopped: ['8', '7', '9'] })
  })
})
