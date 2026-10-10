import { describe, expect, it } from 'vitest'
import { loadFixture } from '../../testing/fixture'
import { timingBuilder } from '../../testing/laps'
import { buildLapTable } from './lapTable'
import { carStints, compoundName, stintEventTimes, stints } from './stints'

/**
 * Carrera: 1 sale con medios nuevos (stint 1, vueltas 1–3, entra en la 3), pone duros usados con 4 vueltas de otra
 * sesión (stint 2, vueltas 4–6) y acaba con un juego sin dato de compuesto, edad ni estado (stint 3, vuelta 7).
 */
const timing = timingBuilder()
  .run(1, 0, [100_000, 90_000, 95_000], {
    lap1NoTime: true,
    compound: 'MEDIUM',
    fresh: true,
    stint: 1,
    each: (i) => ({ tyreLife: i + 1, ...(i === 2 ? { pitInMs: 280_000 } : {}) }),
  })
  .run(1, 285_000, [110_000, 90_000, 91_000], {
    firstLap: 4,
    compound: 'HARD',
    fresh: false,
    stint: 2,
    each: (i) => ({ tyreLife: 5 + i, ...(i === 0 ? { pitOutMs: 300_000 } : {}), ...(i === 2 ? { pitInMs: 570_000 } : {}) }),
  })
  .run(1, 576_000, [105_000], { firstLap: 7, stint: 3, pitOutMs: 590_000 })
  .build()
const car1 = buildLapTable('race', timing, []).cars.get('1')!

describe('stints de neumáticos', () => {
  it('agrupa por número de stint y compuesto, con vueltas, juego, nuevo o usado, e inicio y fin en pista', () => {
    const { stints: list } = carStints(car1)
    expect(list.map((s) => [s.stint, s.compound, s.firstLap, s.lastLap, s.laps])).toEqual([
      [1, 'MEDIUM', 1, 3, 3],
      [2, 'HARD', 4, 6, 3],
      [3, 'UNKNOWN', 7, 7, 1],
    ])
    expect(list.map((s) => [s.tyreLifeFirst, s.tyreLifeLast, s.fresh])).toEqual([
      [1, 3, true],
      [5, 7, false],
      [null, null, null],
    ])
    // Inicio: la salida del pit lane (o el inicio de la vuelta); fin: la entrada (o el fin de la vuelta).
    expect(list.map((s) => [s.startMs, s.endMs, s.open])).toEqual([
      [0, 280_000, false],
      [300_000, 570_000, false],
      [590_000, 681_000, false],
    ])
  })

  it('«hasta ahora»: solo las vueltas ya en pista; un stint sin terminar acaba en el corte', () => {
    // A los 295 s el coche está en el pit lane (entró a los 280, sale a los 300): el stint 2 aún no se ve.
    expect(carStints(car1, 295_000).stints.map((s) => [s.stint, s.endMs, s.open])).toEqual([[1, 280_000, false]])
    const mid = carStints(car1, 400_000).stints
    expect(mid.map((s) => [s.stint, s.firstLap, s.lastLap, s.laps, s.endMs, s.open])).toEqual([
      [1, 1, 3, 3, 280_000, false],
      [2, 4, 5, 2, 400_000, true],
    ])
    // La edad del juego llega hasta la vuelta en curso.
    expect(mid[1]!.tyreLifeLast).toBe(6)
    expect(carStints(car1, -1).stints).toEqual([])
  })

  it('sin número de stint, también empieza uno en cada salida de boxes; un cambio de compuesto siempre', () => {
    const t = timingBuilder()
      .run(5, 0, [100_000, 90_000], { compound: 'SOFT', each: (i) => (i === 1 ? { pitInMs: 185_000 } : {}) })
      .run(5, 200_000, [100_000, 90_000], { firstLap: 3, compound: 'SOFT', each: (i) => (i === 0 ? { pitOutMs: 210_000 } : {}) })
      .run(5, 390_000, [90_000], { firstLap: 5, compound: 'MEDIUM' })
      .build()
    const list = carStints(buildLapTable('fp1', t, []).cars.get('5')!).stints
    expect(list.map((s) => [s.compound, s.firstLap, s.lastLap])).toEqual([
      ['SOFT', 1, 2],
      ['SOFT', 3, 4],
      ['MEDIUM', 5, 5],
    ])
  })

  it('códigos de compuesto fuera de la lista: sin dato', () => {
    expect(compoundName(1)).toBe('SOFT')
    expect(compoundName(0)).toBe('UNKNOWN')
    expect(compoundName(250)).toBe('UNKNOWN')
  })

  it('libres del fixture: un stint por tanda, en orden, sin solaparse', async () => {
    const s = await loadFixture()
    const table = buildLapTable(s.manifest.session.type, s.timing, s.events.raceControl)
    const all = stints(table)
    expect(all.length).toBe(table.cars.size)
    for (const c of all) {
      expect(c.stints.length).toBeGreaterThan(0)
      for (let i = 0; i < c.stints.length; i++) {
        const st = c.stints[i]!
        expect(st.startMs).toBeLessThanOrEqual(st.endMs)
        if (i > 0) expect(st.startMs).toBeGreaterThanOrEqual(c.stints[i - 1]!.endMs)
      }
    }
    // Con corte al principio de la reproducción hay menos stints que al final (el resto, spoilers).
    const startMs = s.manifest.session.playback.startMs
    const count = (cut: number) => stints(table, cut).reduce((n, c) => n + c.stints.length, 0)
    expect(count(startMs)).toBeLessThan(count(Infinity))
  })

  it('instantes de cambio: inicio y fin en pista de cada vuelta, ordenados', () => {
    const times = [...stintEventTimes(buildLapTable('race', timing, []))]
    expect(times).toEqual([...times].sort((a, b) => a - b))
    expect(times).toContain(300_000)
    expect(times).toContain(570_000)
    expect(times).toHaveLength(14)
  })
})
