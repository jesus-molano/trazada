import { describe, expect, it } from 'vitest'
import { timingBuilder } from '../../testing/laps'
import { lapTrackSpec } from '../../testing/moments'
import { syntheticTrack, syntheticTracks } from '../../testing/motion'
import { buildLapTable } from '../analysis/lapTable'
import type { CarTrack } from '../replay/motion'
import { lineSwaps, locateOvertake, OVERTAKE_MAX_GAP_MS, overtakes } from './overtakes'

const N = 8
const steady = (ms: number) => Array.from({ length: N }, () => ms)
/** 1 da vueltas de 90 s; 2 sale 0,5 s detrás y en la vuelta 6 rueda 2 s más rápido: le pasa en esa vuelta. */
const LAPS_1 = steady(90_000)
const LAPS_2 = [90_500, 90_000, 90_000, 90_000, 90_000, 88_000, 90_000, 90_000]

const tracksOf = (specs: Parameters<typeof syntheticTracks>[0]) => new Map(syntheticTracks(specs).map((t) => [t.car, t]))

describe('adelantamientos confirmados por la línea', () => {
  it('un cambio de orden entre las vueltas 5 y 6 es un adelantamiento en la 6, con sus diferencias en la línea', () => {
    const table = buildLapTable('race', timingBuilder().run(1, 0, LAPS_1, { lap1NoTime: true }).run(2, 0, LAPS_2, { lap1NoTime: true }).build(), [])
    expect(lineSwaps(table)).toEqual([
      {
        passer: '2',
        passed: '1',
        lap: 6,
        fromMs: 450_500,
        toMs: 538_500,
        confirmedMs: 540_000,
        gapBeforeMs: 500,
        gapAfterMs: 1_500,
        atMs: null,
      },
    ])
  })

  it('la vuelta 1 nunca: el primer orden oficial es el del final de la vuelta 1 (un cambio en la 2 sí cuenta)', () => {
    // 2 sale delante por 0,5 s y 1 le pasa en la vuelta 2.
    const table = buildLapTable(
      'race',
      timingBuilder().run(1, 0, [90_500, 89_000], { lap1NoTime: true }).run(2, 0, [90_000, 90_000], { lap1NoTime: true }).build(),
      [],
    )
    const list = lineSwaps(table)
    expect(list.map((o) => [o.passer, o.passed, o.lap])).toEqual([['1', '2', 2]])
    expect(list.every((o) => o.lap >= 2)).toBe(true)
  })

  it('perder el puesto parando en boxes no es un adelantamiento (ni al entrar ni al salir)', () => {
    const timing = timingBuilder()
      .run(1, 0, [90_000, 90_000, 90_000, 90_000, 110_000, 95_000, 90_000, 90_000], {
        lap1NoTime: true,
        each: (i) => (i === 4 ? { pitInMs: 445_000 } : i === 5 ? { pitOutMs: 470_000 } : {}),
      })
      .run(2, 0, steady(90_500), { lap1NoTime: true })
      .build()
    expect(lineSwaps(buildLapTable('race', timing, []))).toEqual([])
  })

  it('doblar a un coche no es adelantarlo: se comparan vueltas con el mismo número', () => {
    const timing = timingBuilder()
      .run(1, 0, Array.from({ length: 20 }, () => 85_000), { lap1NoTime: true })
      .run(2, 0, Array.from({ length: 20 }, () => 95_000), { lap1NoTime: true })
      .build()
    expect(lineSwaps(buildLapTable('race', timing, []))).toEqual([])
  })

  it(`a ${OVERTAKE_MAX_GAP_MS / 1000} s o más en alguna de las dos líneas, no cuenta`, () => {
    // 1 pierde 40 s en la vuelta 6 (un problema, sin parar): 2 le pasa, pero a 39,5 s.
    const slow = [...LAPS_1]
    slow[5] = 130_000
    const timing = timingBuilder().run(1, 0, slow, { lap1NoTime: true }).run(2, 0, steady(90_500), { lap1NoTime: true }).build()
    expect(lineSwaps(buildLapTable('race', timing, []))).toEqual([])
    // Si pierde 20 s, sí (a 17 s).
    slow[5] = 110_000
    const near = timingBuilder().run(1, 0, slow, { lap1NoTime: true }).run(2, 0, steady(90_500), { lap1NoTime: true }).build()
    expect(lineSwaps(buildLapTable('race', near, [])).map((o) => o.gapAfterMs)).toEqual([17_000])
  })

  it('sin el paso por meta de una vuelta, ahí no se afirma ninguno', () => {
    const timing = timingBuilder()
      .run(1, 0, LAPS_1, { lap1NoTime: true, each: (i) => (i === 4 ? { endMs: -1 } : {}) })
      .run(2, 0, LAPS_2, { lap1NoTime: true })
      .build()
    // 2 pasa a 1 en la vuelta 6, pero a 1 le falta el paso por meta de la 5: no hay orden anterior que comparar.
    expect(lineSwaps(buildLapTable('race', timing, []))).toEqual([])
  })

  it('solo en carrera y sprint', () => {
    const timing = timingBuilder().run(1, 0, LAPS_1).run(2, 0, LAPS_2).build()
    expect(lineSwaps(buildLapTable('fp1', timing, []))).toEqual([])
    expect(lineSwaps(buildLapTable('q', timing, []))).toEqual([])
    expect(lineSwaps(buildLapTable('sprint', timing, []))).toHaveLength(1)
  })
})

describe('instante aproximado con el GPS', () => {
  const timing = timingBuilder().run(1, 0, LAPS_1, { lap1NoTime: true }).run(2, 0, LAPS_2, { lap1NoTime: true }).build()
  const table = buildLapTable('race', timing, [])

  it('sitúa el cruce de las distancias recorridas dentro de la vuelta', () => {
    // Vuelta 6: 1 va de 450,0 s a 540,0 s y 2 de 450,5 s a 538,5 s; a velocidad constante se cruzan en t = 472,5 s.
    const tracks = tracksOf([lapTrackSpec(1, 0, LAPS_1), lapTrackSpec(2, 0, LAPS_2)])
    const [o] = overtakes(table, tracks)
    expect(o!.atMs).not.toBeNull()
    expect(Math.abs(o!.atMs! - 472_500)).toBeLessThan(50)
    expect(o!.atMs!).toBeGreaterThan(o!.fromMs)
    expect(o!.atMs!).toBeLessThan(o!.toMs)
  })

  it('si el cruce cae en un hueco del GPS: «momento exacto: sin dato» (null)', () => {
    const tracks = tracksOf([lapTrackSpec(1, 0, LAPS_1), lapTrackSpec(2, 0, LAPS_2, { gaps: [[465_000, 480_000]] })])
    expect(overtakes(table, tracks)[0]!.atMs).toBeNull()
  })

  it('sin pista de movimiento de uno de los dos, sin dato', () => {
    const tracks = tracksOf([lapTrackSpec(1, 0, LAPS_1)])
    expect(overtakes(table, tracks)[0]!.atMs).toBeNull()
  })

  /** Pistas a mano: s de cada coche en t = 0, 1, 2… s (una muestra por segundo). */
  const byHand = (sp: number[], sq: number[]): [CarTrack, CarTrack] => {
    const t = sp.map((_, i) => i * 1000)
    return [syntheticTrack({ car: 1, t, s: sp }), syntheticTrack({ car: 2, t, s: sq })]
  }

  it('con pasar y volver a pasar, el último cruce', () => {
    // P detrás, delante (entre 1 y 2 s), detrás (entre 2 y 3 s) y delante otra vez (entre 5 y 6 s).
    const [p, q] = byHand([0, 10, 25, 30, 40, 48, 65, 80, 90], [5, 15, 20, 35, 45, 52, 60, 70, 80])
    const at = locateOvertake(p, q, 0, 8000, 250)
    expect(at).not.toBeNull()
    expect(at!).toBeGreaterThan(5000)
    expect(at!).toBeLessThan(6000)
  })

  it('si el GPS no ve el cambio (P ya delante al empezar) o no pone a P delante al final, sin dato', () => {
    const [ahead, behind] = byHand([10, 20, 30, 40, 50], [0, 10, 20, 30, 40])
    expect(locateOvertake(ahead, behind, 0, 4000, 250)).toBeNull()
    expect(locateOvertake(behind, ahead, 0, 4000, 250)).toBeNull()
  })
})
