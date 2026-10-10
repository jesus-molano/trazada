import { describe, expect, it } from 'vitest'
import { fakeTrzb, loadFixture } from '../../testing/fixture'
import { lapDeletedMessage, rcMessage, timingBuilder } from '../../testing/laps'
import { LeaderboardEngine } from '../leaderboard/leaderboard'
import {
  buildLapTable,
  currentLapIndex,
  LAP_DELETED,
  LAP_FIRST,
  LAP_NEUTRALISED,
  LAP_NO_LINE,
  LAP_NO_TIME,
  LAP_NOT_REPRESENTATIVE,
  LAP_PIT,
  LAP_PIT_IN,
  LAP_PIT_OUT,
  LAP_RED,
  LAP_SC,
  LAP_VSC,
  LAP_YELLOW,
  lapFlagsAt,
  lapIndex,
  lapIs,
  lastCompletedIndex,
  qualifyingSegments,
  segmentAt,
} from './lapTable'

describe('índice de vueltas por coche', () => {
  // Filas desordenadas a propósito: 44 aparece antes que 1 y sus vueltas no vienen en orden.
  const timing = timingBuilder()
    .lap(44, 2, { startMs: 91_000, endMs: 181_500, lapMs: 90_500, compound: 'HARD', tyreLife: 2, fresh: true, stint: 2 })
    .lap(1, 1, { startMs: 0, endMs: 90_000, compound: 'SOFT', tyreLife: 3, fresh: false, stint: 1 })
    .lap(44, 1, { startMs: 0, endMs: 91_000, compound: 'MEDIUM', sectors: [30_000, 31_000, -1], position: 2 })
    .lap(1, 2, { startMs: 90_000, endMs: 180_000, lapMs: 90_000, compound: 'SOFT', tyreLife: 4, position: 1 })
    .build()
  const table = buildLapTable('race', timing, [])

  it('coches en el orden de la tabla y vueltas ordenadas por número, con su fila', () => {
    expect([...table.cars.keys()]).toEqual(['44', '1'])
    const c44 = table.cars.get('44')!
    expect([...c44.lap]).toEqual([1, 2])
    expect([...c44.row]).toEqual([2, 0])
    expect([...c44.startMs]).toEqual([0, 91_000])
    expect([...c44.s1Ms]).toEqual([30_000, -1])
    expect([...c44.s2Ms]).toEqual([31_000, -1])
    expect([...c44.s3Ms]).toEqual([-1, -1])
    expect([...c44.position]).toEqual([2, 0])
    expect([...c44.compound]).toEqual([2, 3])
    expect([...c44.fresh]).toEqual([255, 1])
    expect([...c44.stint]).toEqual([0, 2])
    expect([...table.cars.get('1')!.tyreLife]).toEqual([3, 4])
    expect([...table.cars.get('1')!.fresh]).toEqual([0, 255])
    expect(table.race).toBe(true)
    expect(table.quali).toBe(false)
  })

  it('búsquedas: vuelta por número, vuelta en curso y última completada', () => {
    const c1 = table.cars.get('1')!
    expect(lapIndex(c1, 2)).toBe(1)
    expect(lapIndex(c1, 3)).toBe(-1)
    expect(currentLapIndex(c1, -1)).toBe(-1)
    expect(currentLapIndex(c1, 0)).toBe(0)
    expect(currentLapIndex(c1, 95_000)).toBe(1)
    expect(lastCompletedIndex(c1, 89_999)).toBe(-1)
    expect(lastCompletedIndex(c1, 90_000)).toBe(0)
    expect(lastCompletedIndex(c1, 1e9)).toBe(1)
  })

  it('el paso por meta real: sin fin, o una «vuelta» de menos de media vuelta mediana, no cuenta', () => {
    const t = timingBuilder()
      .run(1, 0, [100_000, 90_000, 92_000, 91_000], { lap1NoTime: true })
      // Retirado: un registro residual de 20 s tras su última vuelta, y otro sin fin.
      .run(16, 0, [101_000, 93_000, 20_000], { lap1NoTime: true })
      .lap(16, 4, { startMs: 214_000 })
      .build()
    const lt = buildLapTable('race', t, [])
    // Mediana de los tiempos oficiales (> 0): 20, 90, 91, 92 y 93 s → 91 s.
    expect(lt.minLapMs).toBe(0.5 * 91_000)
    const c16 = lt.cars.get('16')!
    expect([...c16.crossMs]).toEqual([101_000, 194_000, -1, -1])
    expect([...c16.endMs]).toEqual([101_000, 194_000, 214_000, -1])
    expect(lapIs(c16, 2, LAP_NO_LINE, 0)).toBe(true)
    expect(lapIs(c16, 3, LAP_NO_LINE | LAP_NO_TIME, 0)).toBe(true)
    expect(lapIs(c16, 1, LAP_NO_LINE, 0)).toBe(false)
    // La vuelta 1 de carrera no trae tiempo oficial, pero sí paso por meta.
    expect(lt.cars.get('1')!.kind[0]! & (LAP_FIRST | LAP_NO_TIME)).toBe(LAP_FIRST | LAP_NO_TIME)
    expect(lt.cars.get('1')!.crossMs[0]).toBe(100_000)
  })
})

describe('clasificación de cada vuelta', () => {
  const timing = timingBuilder()
    .lap(1, 1, { startMs: 0, endMs: 100_000, pitOutMs: 5_000 })
    .lap(1, 2, { startMs: 100_000, endMs: 190_000, lapMs: 90_000, status: ['yellow'] })
    .lap(1, 3, { startMs: 190_000, endMs: 300_000, lapMs: 110_000, status: ['sc'] })
    .lap(1, 4, { startMs: 300_000, endMs: 400_000, lapMs: 100_000, status: ['vsc'] })
    .lap(1, 5, { startMs: 400_000, endMs: 495_000, lapMs: 95_000, status: ['vsc-ending'] })
    .lap(1, 6, { startMs: 495_000, endMs: 700_000, lapMs: 205_000, status: ['red', 'sc'] })
    .lap(1, 7, { startMs: 700_000, endMs: 810_000, lapMs: 110_000, pitInMs: 805_000 })
    .lap(1, 8, { startMs: 810_000, endMs: 900_000, lapMs: 90_000 })
    .build()
  const laps = buildLapTable('race', timing, []).cars.get('1')!
  const kinds = [...laps.kind]

  it('boxes, estado de pista, vuelta 1 y sin tiempo, en bits', () => {
    expect(kinds).toEqual([
      LAP_FIRST | LAP_NO_TIME | LAP_PIT_OUT,
      LAP_YELLOW,
      LAP_SC,
      LAP_VSC,
      LAP_VSC, // fin de VSC: aún neutralizada
      LAP_RED | LAP_SC,
      LAP_PIT_IN,
      0,
    ])
  })

  it('grupos: boxes, neutralizada (la amarilla no) y no representativa', () => {
    expect(kinds.map((k) => (k & LAP_PIT) !== 0)).toEqual([true, false, false, false, false, false, true, false])
    expect(kinds.map((k) => (k & LAP_NEUTRALISED) !== 0)).toEqual([false, false, true, true, true, true, false, false])
    expect(kinds.map((_, k) => lapIs(laps, k, LAP_NOT_REPRESENTATIVE, Infinity))).toEqual([
      true,
      false,
      true,
      true,
      true,
      true,
      true,
      false,
    ])
  })

  it('sin la columna de estado de pista (timing antiguo o sintético), ningún bit de estado y se dice', () => {
    const bare = fakeTrzb('timing', {
      laps: {
        car: [1],
        lap: [2],
        startMs: [0],
        endMs: [90_000],
        lapMs: [90_000],
        compound: [1],
        pitInMs: [-1],
        pitOutMs: [-1],
        position: [0],
        deleted: [0],
      },
    })
    const t = buildLapTable('fp1', bare, [])
    expect(t.trackStatusKnown).toBe(false)
    expect(buildLapTable('race', timing, []).trackStatusKnown).toBe(true)
    const c = t.cars.get('1')!
    expect(c.kind[0]).toBe(0)
    // Columnas opcionales ausentes: centinelas de «sin dato».
    expect([c.s1Ms[0], c.s2Ms[0], c.s3Ms[0], c.tyreLife[0], c.fresh[0], c.stint[0]]).toEqual([-1, -1, -1, 255, 255, 0])
  })
})

describe('vueltas anuladas: desde el mensaje de dirección de carrera', () => {
  // 1 hace 1:30.000 en su vuelta 2 (acaba a 180 s) y el mensaje que la anula llega a 250 s. La 4 (acaba a 363 s)
  // se anula con un «LAP DELETED» sin tiempo a 400 s, y la 5 (acaba a 456 s) sin mensaje: el dato dice que se
  // anuló, pero no cuándo. La 3 no se anula.
  const timing = timingBuilder()
    .run(1, 0, [90_000, 90_000, 91_000, 92_000, 93_000], {
      each: (i) => ({ deleted: i === 1 || i >= 3 }),
    })
    .build()
  const rc = [lapDeletedMessage(250_000, '1', 90_000), lapDeletedMessage(400_000, '1', null)]
  const laps = buildLapTable('fp1', timing, rc).cars.get('1')!

  it('deletedFrom: el mensaje que cita el tiempo; si no, el «LAP DELETED» siguiente; sin mensaje, el final', () => {
    expect([...laps.deletedFrom]).toEqual([Infinity, 250_000, Infinity, 400_000, 456_000])
  })

  it('la anulación solo existe desde ese instante (no es un bit fijo)', () => {
    expect(laps.kind[1]! & LAP_DELETED).toBe(0)
    expect(lapFlagsAt(laps, 1, 249_999) & LAP_DELETED).toBe(0)
    expect(lapFlagsAt(laps, 1, 250_000) & LAP_DELETED).toBe(LAP_DELETED)
    expect(lapIs(laps, 3, LAP_DELETED, 399_999)).toBe(false)
    expect(lapIs(laps, 3, LAP_DELETED, 400_000)).toBe(true)
    expect(lapIs(laps, 4, LAP_DELETED, 455_999)).toBe(false)
    expect(lapIs(laps, 4, LAP_DELETED, 456_000)).toBe(true)
    expect(lapIs(laps, 2, LAP_DELETED, Infinity)).toBe(false)
  })
})

describe('tandas de clasificación', () => {
  const rc = [
    rcMessage(1_000_000, 'chequered_flag'),
    rcMessage(1_400_000, 'green_light'),
    rcMessage(1_620_000, 'red_flag'),
    rcMessage(1_640_000, 'green_light'),
    rcMessage(2_000_000, 'chequered_flag'),
  ]
  const timing = timingBuilder()
    .lap(1, 2, { startMs: 410_000, endMs: 500_000, lapMs: 90_000 })
    .lap(1, 3, { startMs: 950_000, endMs: 1_039_000, lapMs: 89_000 }) // lanzada antes de la bandera a cuadros
    .lap(1, 4, { startMs: 1_100_000, endMs: 1_200_000, lapMs: 100_000 }) // entre tandas
    .lap(1, 5, { endMs: 1_590_500, lapMs: 90_500 }) // sin inicio: fin − tiempo
    .lap(1, 6, { endMs: 1_700_000 }) // sin inicio ni tiempo
    .build()

  it('cada vuelta, en la tanda en la que empezó', () => {
    const q = buildLapTable('q', timing, rc)
    expect(q.segments).toEqual(qualifyingSegments(rc))
    expect([...q.cars.get('1')!.segment]).toEqual([0, 0, -1, 1, -1])
    expect([0, 1_100_000, 1_400_000, 1_700_000].map((t) => segmentAt(q.segments, t))).toEqual([0, 0, 1, 1])
  })

  it('fuera de clasificación todo es la tanda 0 (también sin inicio conocido)', () => {
    const fp = buildLapTable('fp1', timing, rc)
    expect([...fp.cars.get('1')!.segment]).toEqual([0, 0, 0, 0, 0])
    expect(segmentAt(fp.segments, 1_700_000)).toBe(0)
  })
})

describe('con el fixture real', () => {
  it('cada fila de la tabla aparece una vez, con las vueltas en orden y el mismo índice que el leaderboard', async () => {
    const s = await loadFixture()
    const lb = new LeaderboardEngine(s.manifest.session.type, s.timing, s.events, s.manifest.drivers)
    const table = lb.lapTable
    const rows = s.timing.tables.laps!.rows
    const seen = new Set<number>()
    for (const laps of table.cars.values()) {
      for (let k = 0; k < laps.lap.length; k++) {
        seen.add(laps.row[k]!)
        if (k > 0) expect(laps.lap[k]!).toBeGreaterThanOrEqual(laps.lap[k - 1]!)
        if (laps.crossMs[k]! > 0) expect(laps.crossMs[k]).toBe(laps.endMs[k])
        expect(laps.deletedFrom[k]! === Infinity || laps.deletedFrom[k]! >= laps.endMs[k]!).toBe(true)
      }
    }
    expect(seen.size).toBe(rows)
    expect(table.trackStatusKnown).toBe(true)
  })
})
