import { describe, expect, it } from 'vitest'
import { type LapInput, lapDeletedMessage, timingBuilder } from '../../testing/laps'
import { buildLapTable, LAP_DELETED, LAP_FIRST, LAP_SC } from './lapTable'
import {
  carPace,
  exclusionsOf,
  outsideRange,
  pace,
  paceAxis,
  paceChart,
  paceEventTimes,
  representativeRange,
} from './pace'

/**
 * Carrera: vuelta 1 sin tiempo oficial; 2 normal; 3 con SC; 4 de entrada a boxes; 5 de salida; 6 anulada (el mensaje
 * llega a los 700 s); 7 normal. Otro coche (44) con dos vueltas normales.
 */
const DELETED_AT = 700_000
const timing = timingBuilder()
  .run(1, 0, [100_000, 90_000, 120_000, 95_000, 110_000, 89_000, 90_500], {
    lap1NoTime: true,
    each: (i) => ([{}, {}, { status: ['sc'] }, { pitInMs: 400_000 }, { pitOutMs: 410_000 }, { deleted: true }, {}] as LapInput[])[i]!,
  })
  .run(44, 0, [101_000, 91_000])
  .build()
const raceControl = [lapDeletedMessage(DELETED_AT, '1', 89_000)]
const table = buildLapTable('race', timing, raceControl)
const car1 = table.cars.get('1')!

describe('ritmo por vuelta', () => {
  it('las vueltas excluidas se marcan con su motivo, nunca se quitan', () => {
    const p = carPace(car1)
    expect(p.laps.map((l) => l.lap)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(p.laps.map((l) => l.excluded)).toEqual([
      ['first', 'noTime'],
      [],
      ['neutralised'],
      ['pit'],
      ['pit'],
      ['deleted'],
      [],
    ])
    expect(p.laps[0]!.lapMs).toBeNull()
    expect(p.laps[1]!.lapMs).toBe(90_000)
    expect(p.laps[2]!.flags & LAP_SC).toBeTruthy()
    expect(p.laps[0]!.flags & LAP_FIRST).toBeTruthy()
  })

  it('motivos en orden fijo', () => {
    expect(exclusionsOf(LAP_FIRST | LAP_DELETED | LAP_SC)).toEqual(['first', 'neutralised', 'deleted'])
    expect(exclusionsOf(0)).toEqual([])
  })

  it('«hasta ahora»: solo las vueltas acabadas en el corte; una anulada lo está desde su mensaje', () => {
    // Vuelta 6: acaba a los 604 s; el mensaje llega a los 700 s.
    const before = carPace(car1, 650_000)
    expect(before.laps.map((l) => l.lap)).toEqual([1, 2, 3, 4, 5, 6])
    expect(before.laps[5]!.excluded).toEqual([])
    const after = carPace(car1, DELETED_AT)
    expect(after.laps.map((l) => l.lap)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(after.laps[5]!.excluded).toEqual(['deleted'])
    expect(carPace(car1, 99_999).laps).toEqual([])
  })

  it('coches pedidos en su orden; uno sin vueltas, vacío', () => {
    expect(pace(table, ['44', '99', '1']).map((p) => [p.car, p.laps.length])).toEqual([
      ['44', 2],
      ['99', 0],
      ['1', 7],
    ])
  })

  it('eje: por vuelta en carrera y sprint; por instante en libres y clasificación', () => {
    expect(paceAxis(table)).toBe('lap')
    expect(paceAxis(buildLapTable('sprint', timing, []))).toBe('lap')
    expect(paceAxis(buildLapTable('fp1', timing, []))).toBe('time')
    expect(paceAxis(buildLapTable('q', timing, []))).toBe('time')
  })

  it('gráfica por vuelta: representativas, excluidas (hueco) y anuladas (aspa) en series aparte; sin tiempo, contadas', () => {
    const chart = paceChart(pace(table, ['1', '44']), 'lap')
    expect(chart.x).toEqual([1, 2, 3, 4, 5, 6, 7])
    const [c1, c44] = chart.cars
    expect(c1!.normal).toEqual([null, 90, null, null, null, null, 90.5])
    expect(c1!.excluded).toEqual([null, null, 120, 95, 110, null, null])
    expect(c1!.deleted).toEqual([null, null, null, null, null, 89, null])
    expect(c1!.noTime).toBe(1)
    expect(c1!.lap1NoTime).toBe(true)
    // 44: su vuelta 1 sí tiene tiempo (vuelta 1: excluida igualmente).
    expect(c44!.excluded.slice(0, 2)).toEqual([101, null])
    expect(c44!.normal.slice(0, 3)).toEqual([null, 91, null])
    expect(c44!.lap1NoTime).toBe(false)
  })

  it('gráfica por instante (libres): x = fin de cada vuelta con tiempo; para saltar, su inicio', () => {
    const fp = buildLapTable('fp1', timingBuilder().run(1, 1_000, [100_000, 90_000]).run(44, 50_000, [95_000]).build(), [])
    const chart = paceChart(pace(fp, ['1', '44']), 'time')
    expect(chart.x).toEqual([101_000, 145_000, 191_000])
    expect(chart.startMs).toEqual([1_000, 50_000, 101_000])
    expect(chart.cars[0]!.normal).toEqual([null, null, 90])
    expect(chart.cars[0]!.excluded).toEqual([100, null, null])
    expect(chart.cars[1]!.excluded).toEqual([null, 95, null])
  })

  it('escala del ritmo: encuadra las representativas; las demás que quedan fuera se cuentan', () => {
    const chart = paceChart(pace(table, ['1']), 'lap')
    const range = representativeRange(chart)!
    expect(range[0]).toBeLessThan(90)
    expect(range[1]).toBeGreaterThan(90.5)
    expect(range[1]).toBeLessThan(95)
    // Rango [89,5; 91]: 120, 95 y 110 (excluidas) y 89 (anulada) quedan fuera.
    expect(range).toEqual([89.5, 91])
    expect(outsideRange(chart, range)).toBe(4)
    expect(representativeRange(paceChart(pace(table, ['1'], 150_000), 'lap'))).toBeNull()
  })

  it('instantes de cambio: fin de cada vuelta y cada anulación, ordenados', () => {
    const times = [...paceEventTimes(table)]
    expect(times).toContain(DELETED_AT)
    expect(times).toEqual([...times].sort((a, b) => a - b))
    expect(times).toHaveLength(7 + 2 + 1)
  })
})
