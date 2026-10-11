import { describe, expect, it } from 'vitest'
import { rcMessage } from '../../testing/laps'
import type { Duel } from './duels'
import {
  buildMoments,
  JUMP_BACK_GRACE_MS,
  JUMP_LEAD_MS,
  type Moment,
  type MomentKind,
  nextMoment,
  overtakeTime,
  prevMoment,
  RC_MERGE_MS,
} from './jumps'
import type { Overtake } from './overtakes'

const overtake = (atMs: number | null, fromMs: number): Overtake => ({
  passer: '2',
  passed: '1',
  lap: 3,
  fromMs,
  toMs: fromMs + 90_000,
  confirmedMs: fromMs + 91_000,
  gapBeforeMs: 500,
  gapAfterMs: 500,
  atMs,
})

const duel = (startMs: number): Duel => ({
  leader: '1',
  chaser: '2',
  firstLap: 4,
  lastLap: 7,
  startMs,
  endMs: startMs + 270_000,
  confirmedMs: startMs + 180_000,
  minGapMs: 300,
  minGapLap: 5,
  open: false,
  endedInOvertake: false,
})

const START = 100_000
const END = 1_000_000

function moments(): Moment[] {
  return buildMoments({
    overtakes: [overtake(300_000, 250_000), overtake(null, 600_000)],
    duels: [duel(400_000)],
    neutralisations: [
      { kind: 'sc', fromMs: 500_000 },
      { kind: 'vsc-ending', fromMs: 550_000 },
      { kind: 'yellow', fromMs: 560_000 },
      { kind: 'red', fromMs: 2_000_000 },
    ],
    raceControl: [
      rcMessage(102_000, 'green_light'),
      rcMessage(200_000, 'blue_flag'),
      rcMessage(700_000, 'sector_double_yellow'),
      rcMessage(705_000, 'sector_double_yellow'),
      rcMessage(700_000 + RC_MERGE_MS + 1, 'sector_double_yellow'),
      rcMessage(800_000, 'incident'),
    ],
    startMs: START,
    endMs: END,
  })
}

const kinds = (...k: MomentKind[]) => new Set(k)

describe('momentos', () => {
  it('juntos y ordenados por tiempo; cada salto, unos segundos antes y dentro de la reproducción', () => {
    const list = moments()
    expect(list.map((m) => [m.kind, m.t])).toEqual([
      ['raceControl', 102_000],
      ['overtake', 300_000],
      ['duel', 400_000],
      ['neutralisation', 500_000],
      ['overtake', 600_000],
      ['raceControl', 700_000],
      ['raceControl', 700_000 + RC_MERGE_MS + 1],
      ['raceControl', 800_000],
    ])
    // La luz verde, a 2 s del inicio: el salto se queda en el inicio.
    expect(list[0]!.seekMs).toBe(START)
    expect(list[1]!.seekMs).toBe(300_000 - JUMP_LEAD_MS)
  })

  it('un adelantamiento sin instante GPS salta al inicio de su vuelta', () => {
    const o = overtake(null, 600_000)
    expect(overtakeTime(o)).toBe(600_000)
    expect(overtakeTime(overtake(612_345, 600_000))).toBe(612_345)
  })

  it('solo neutralizaciones (SC, VSC, roja) y mensajes destacados; fuera de la reproducción, nada', () => {
    const list = moments()
    expect(list.some((m) => m.kind === 'neutralisation' && m.t === 550_000)).toBe(false)
    expect(list.some((m) => m.t === 560_000)).toBe(false)
    expect(list.some((m) => m.t === 200_000)).toBe(false)
    expect(list.some((m) => m.t === 2_000_000)).toBe(false)
    // Dos dobles amarillas a la vez (sectores distintos): un solo momento.
    expect(list.filter((m) => m.t === 705_000)).toEqual([])
  })

  it('siguiente y anterior desde el reloj, en los bordes y por clase', () => {
    const list = moments()
    expect(nextMoment(list, START)!.t).toBe(300_000)
    expect(nextMoment(list, 295_000)!.t).toBe(400_000)
    expect(nextMoment(list, 900_000)).toBeNull()
    expect(prevMoment(list, START)).toBeNull()
    expect(prevMoment(list, 900_000)!.t).toBe(800_000)
    expect(nextMoment(list, START, kinds('overtake'))!.t).toBe(300_000)
    expect(nextMoment(list, 300_000, kinds('overtake'))!.t).toBe(600_000)
    expect(nextMoment(list, START, kinds('duel', 'neutralisation'))!.t).toBe(400_000)
    expect(prevMoment(list, 900_000, kinds('overtake'))!.t).toBe(600_000)
    expect(nextMoment(list, START, kinds())).toBeNull()
  })

  it('justo después de saltar, «anterior» va al de antes (no al mismo); pasado el margen, vuelve a él', () => {
    const list = moments()
    const at = nextMoment(list, START)!
    expect(prevMoment(list, at.seekMs)!.t).toBe(102_000)
    expect(prevMoment(list, at.seekMs + JUMP_BACK_GRACE_MS - 1)!.t).toBe(102_000)
    expect(prevMoment(list, at.seekMs + JUMP_BACK_GRACE_MS + 1)!.t).toBe(300_000)
    // Y «siguiente» desde ahí, al otro.
    expect(nextMoment(list, at.seekMs)!.t).toBe(400_000)
  })
})
