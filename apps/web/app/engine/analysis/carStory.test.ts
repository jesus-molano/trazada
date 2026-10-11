import { describe, expect, it } from 'vitest'
import { rcMessage, timingBuilder } from '../../testing/laps'
import { CAR_STORY_KINDS, CAR_STORY_MAX, carStory } from './carStory'
import { buildLapTable } from './lapTable'

/**
 * 1 da cuatro vueltas (pasos a los 100, 190, 280 y 370 s). 23 cruza la 1 y la 2 (102 y 193 s) y entra en el pit lane
 * en la 2 (a los 185 s); después no vuelve a cruzar. 5 entra en el pit lane en su vuelta 3, pero después del corte que
 * se prueba.
 */
const timing = timingBuilder()
  .run(1, 0, [100_000, 90_000, 90_000, 90_000], { lap1NoTime: true })
  .run(23, 0, [102_000, 91_000], { lap1NoTime: true, each: (i) => (i === 1 ? { pitInMs: 185_000 } : {}) })
  .run(5, 0, [103_000, 91_000, 92_000], { lap1NoTime: true, each: (i) => (i === 2 ? { pitInMs: 280_000 } : {}) })
  .build()
const table = buildLapTable('race', timing, [])

const rc = [
  rcMessage(120_000, 'incident', 'TURN 3 INCIDENT INVOLVING CARS 23 (ALB) AND 5 (BOR) NOTED', ['23', '5']),
  rcMessage(130_000, 'blue_flag', 'WAVED BLUE FLAG FOR CAR 23 (ALB) TIMED AT 14:02:11', ['23']),
  rcMessage(140_000, 'track_limits', 'CAR 23 (ALB) TRACK LIMITS AT TURN 7 LAP 2 14:02:21', ['23']),
  rcMessage(150_000, 'lap_deleted', 'CAR 23 (ALB) TIME 1:31.000 DELETED - TRACK LIMITS', ['23']),
  rcMessage(160_000, 'penalty', 'FIA STEWARDS: 5 SECOND TIME PENALTY FOR CAR 23 (ALB)', ['23']),
  rcMessage(200_000, 'car_stopped', 'CAR 23 (ALB) STOPPED AT TURN 16', ['23']),
  rcMessage(210_000, 'incident', 'TURN 1 INCIDENT INVOLVING CAR 1 (NOR) NOTED', ['1']),
]

describe('ficha de un coche (D49)', () => {
  it('clases que cuentan: ni banderas azules, ni límites de pista, ni vueltas anuladas', () => {
    for (const k of ['blue_flag', 'track_limits', 'lap_deleted']) expect(CAR_STORY_KINDS.has(k), k).toBe(false)
    const s = carStory(table, rc, '23')
    expect(s.rc.map((e) => e.parsed.kind)).toEqual(['car_stopped', 'penalty'])
    expect(s.rcMore).toBe(1)
  })

  it('hasta el corte, del más reciente al más antiguo, como mucho dos y cuántos más', () => {
    expect(CAR_STORY_MAX).toBe(2)
    const at = (cutoff: number) => carStory(table, rc, '23', cutoff)
    expect(at(119_999).rc).toEqual([])
    expect(at(120_000).rc.map((e) => e.t)).toEqual([120_000])
    expect(at(170_000).rc.map((e) => e.t)).toEqual([160_000, 120_000])
    expect(at(170_000).rcMore).toBe(0)
    expect(at(Infinity).rc.map((e) => e.t)).toEqual([200_000, 160_000])
    expect(at(Infinity).rcMore).toBe(1)
    // Forma corta de la ficha: solo el más reciente; los demás se cuentan.
    const short = carStory(table, rc, '23', Infinity, 1)
    expect(short.rc.map((e) => e.t)).toEqual([200_000])
    expect(short.rcMore).toBe(2)
    // Otro coche: solo los que lo nombran.
    expect(carStory(table, rc, '1').rc.map((e) => e.t)).toEqual([210_000])
    expect(carStory(table, rc, '5').rc.map((e) => e.t)).toEqual([120_000])
  })

  it('último paso por meta y entrada en el pit lane en esa vuelta (hasta el corte)', () => {
    expect(carStory(table, rc, '23')).toMatchObject({ lastLap: 2, pitInOnLastLap: true })
    // Antes de su paso de la 2: su último paso es el de la 1, sin pit lane.
    expect(carStory(table, rc, '23', 150_000)).toMatchObject({ lastLap: 1, pitInOnLastLap: false })
    // 5 entra en el pit lane en la 3 a los 280 s y la cruza a los 286 s.
    expect(carStory(table, rc, '5')).toMatchObject({ lastLap: 3, pitInOnLastLap: true })
    // El 1 nunca entra.
    expect(carStory(table, rc, '1')).toMatchObject({ lastLap: 4, pitInOnLastLap: false })
  })

  it('una entrada en el pit lane después del corte no cuenta', () => {
    // Con el corte en la vuelta 3 de 5 (antes de que la cruce), su último paso es el de la 2, sin pit lane.
    expect(carStory(table, rc, '5', 200_000)).toMatchObject({ lastLap: 2, pitInOnLastLap: false })
    // Una fila con la entrada después del corte (vuelta cruzada antes de la entrada: dato raro, pero se respeta el corte).
    const odd = buildLapTable('race', timingBuilder().lap(7, 1, { startMs: 0, endMs: 100_000, pitInMs: 150_000 }).build(), [])
    expect(carStory(odd, [], '7', 120_000)).toMatchObject({ lastLap: 1, pitInOnLastLap: false })
    expect(carStory(odd, [], '7', 150_000)).toMatchObject({ lastLap: 1, pitInOnLastLap: true })
  })

  it('sin pasos por meta: sin última vuelta', () => {
    expect(carStory(table, rc, '23', 50_000)).toEqual({ lastLap: null, pitInOnLastLap: false, rc: [], rcMore: 0 })
    expect(carStory(table, rc, '99')).toMatchObject({ lastLap: null, pitInOnLastLap: false })
  })
})
