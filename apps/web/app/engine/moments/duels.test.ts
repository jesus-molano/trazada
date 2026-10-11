import { describe, expect, it } from 'vitest'
import { type LapInput, timingBuilder } from '../../testing/laps'
import { crossings } from '../../testing/moments'
import { buildLapTable } from '../analysis/lapTable'
import { DUEL_MAX_GAP_MS, DUEL_MIN_LAPS, duels } from './duels'
import { lineSwaps } from './overtakes'

const steady = (n: number, ms: number) => Array.from({ length: n }, () => ms)

/** 1 da vueltas de 90 s; 2 sale 0,6 s detrás y le sigue a menos de 1 s (0,6, 0,4, 0,3, 0,5…) hasta la vuelta 5. */
const LAPS_1 = steady(8, 90_000)
const LAPS_2 = [90_600, 89_800, 89_900, 90_200, 90_500, 92_000, 90_000, 90_000]

function table(laps2: readonly number[] = LAPS_2, each2?: (i: number) => LapInput, each1?: (i: number) => LapInput) {
  const timing = timingBuilder()
    .run(1, 0, LAPS_1, { lap1NoTime: true, each: each1 })
    .run(2, 0, laps2, { lap1NoTime: true, each: each2 })
    .build()
  return buildLapTable('race', timing, [])
}

describe('duelos a menos de 1 s', () => {
  it(`a menos de ${DUEL_MAX_GAP_MS} ms en la línea durante ${DUEL_MIN_LAPS} vueltas o más: un duelo, con su separación mínima`, () => {
    // Separaciones: 600, 400, 300, 500, 1000 (ya no), …
    const r = duels(table())
    expect(r.status).toBe('ok')
    const c1 = crossings(0, LAPS_1)
    const c2 = crossings(0, LAPS_2)
    expect(r.duels).toEqual([
      {
        leader: '1',
        chaser: '2',
        firstLap: 1,
        lastLap: 4,
        startMs: c1[0],
        endMs: c2[3],
        confirmedMs: c2[2],
        minGapMs: 300,
        minGapLap: 3,
        open: false,
        endedInOvertake: false,
      },
    ])
  })

  it('dos vueltas no bastan', () => {
    expect(duels(table([90_600, 89_800, 92_000, 90_000, 90_000, 90_000, 90_000, 90_000])).duels).toEqual([])
  })

  it('una vuelta con parada o con SC/VSC corta el duelo (y lo que queda no llega a 3 vueltas)', () => {
    expect(duels(table(LAPS_2, (i) => (i === 2 ? { pitInMs: 260_000 } : {}))).duels).toEqual([])
    expect(duels(table(LAPS_2, undefined, (i) => (i === 1 ? { status: ['sc'] } : {}))).duels).toEqual([])
    expect(duels(table(LAPS_2, (i) => (i === 2 ? { status: ['vsc'] } : {}))).duels).toEqual([])
    // Una amarilla no.
    expect(duels(table(LAPS_2, (i) => (i === 2 ? { status: ['yellow'] } : {}))).duels).toHaveLength(1)
  })

  it('con otro coche en medio en la línea, no son un duelo entre ellos', () => {
    const timing = timingBuilder()
      .run(1, 0, LAPS_1, { lap1NoTime: true })
      .run(2, 0, LAPS_2, { lap1NoTime: true })
      .run(3, 0, [90_200, 90_000, 90_000, 90_000, 90_000, 90_000, 90_000, 90_000], { lap1NoTime: true })
      .build()
    const r = duels(buildLapTable('race', timing, []))
    // 3 cruza siempre entre 1 y 2 (a 0,2 s de 1): los duelos son 1→3 y 3→2, nunca 1→2.
    expect(r.duels.map((d) => [d.leader, d.chaser, d.firstLap, d.lastLap])).toEqual([
      ['1', '3', 1, 8],
      ['3', '2', 1, 5],
    ])
  })

  it('un coche que acaba la vuelta entrando en boxes no está «en medio» (cruza la línea en el pit lane)', () => {
    const timing = timingBuilder()
      .run(1, 0, LAPS_1, { lap1NoTime: true })
      .run(2, 0, LAPS_2, { lap1NoTime: true })
      .run(3, 0, [90_200, 90_000, 110_000, 90_000, 90_000, 90_000, 90_000, 90_000], {
        lap1NoTime: true,
        each: (i) => (i === 1 ? { pitInMs: 175_000 } : i === 2 ? { pitOutMs: 200_000 } : {}),
      })
      .build()
    const r = duels(buildLapTable('race', timing, []))
    // En la vuelta 2, 3 entra en boxes: entre 1 y 2 no hay nadie y el duelo sigue (vueltas 2–4).
    expect(r.duels.find((d) => d.leader === '1' && d.chaser === '2')).toMatchObject({ firstLap: 2, lastLap: 4 })
  })

  it('«Sin spoilers»: con el corte tras la tercera vuelta, el duelo sale «en curso»; antes, aún no es un duelo', () => {
    const c2 = crossings(0, LAPS_2)
    const open = duels(table(), c2[2]!)
    expect(open.duels).toHaveLength(1)
    expect(open.duels[0]).toMatchObject({ firstLap: 1, lastLap: 3, open: true, minGapMs: 300 })
    expect(duels(table(), c2[2]! - 1).duels).toEqual([])
  })

  it('termina en adelantamiento si el perseguidor pasa en la vuelta siguiente', () => {
    // 2 sigue a menos de 1 s en las vueltas 1–4 y en la 5 cruza antes que 1.
    const laps2 = [90_600, 89_800, 89_900, 90_200, 88_000, 90_000, 90_000, 90_000]
    const t = table(laps2)
    const swaps = lineSwaps(t)
    expect(swaps.map((o) => [o.passer, o.lap])).toEqual([['2', 5]])
    const [d] = duels(t, Infinity, swaps).duels
    expect(d).toMatchObject({ leader: '1', chaser: '2', lastLap: 4, endedInOvertake: true })
    // Con el corte antes de que la línea lo confirme, aún no.
    expect(duels(t, swaps[0]!.confirmedMs - 1, swaps).duels[0]!.endedInOvertake).toBe(false)
  })

  it('sin el estado de pista por vuelta no se afirma ningún duelo; fuera de carrera, tampoco', () => {
    const timing = timingBuilder().run(1, 0, LAPS_1, { lap1NoTime: true }).run(2, 0, LAPS_2, { lap1NoTime: true }).build()
    const { trackStatusMask: _mask, ...columns } = timing.tables.laps!.columns
    const noStatus = { ...timing, tables: { ...timing.tables, laps: { ...timing.tables.laps!, columns } } }
    expect(duels(buildLapTable('race', noStatus, []))).toEqual({ status: 'noTrackStatus', duels: [] })
    expect(duels(buildLapTable('fp1', timing, []))).toEqual({ status: 'notRace', duels: [] })
  })
})
