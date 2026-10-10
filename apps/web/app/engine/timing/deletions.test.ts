import type { RaceControlEvent } from '@trazada/schema'
import { describe, expect, it } from 'vitest'
import { deletionTimes, quotedLapMs } from './deletions'

const rc = (t: number, text: string, cars: string[], kind = 'lap_deleted'): RaceControlEvent => ({
  t,
  lap: null,
  category: 'Other',
  flag: null,
  scope: null,
  sector: null,
  car: null,
  text,
  parsed: { kind, cars, turn: null, lap: null },
})

/** Filas [coche, fin, tiempo, anulada]. */
function laps(rows: [number, number, number, number][]) {
  return {
    rows: rows.length,
    car: rows.map((r) => r[0]),
    endMs: rows.map((r) => r[1]),
    lapMs: rows.map((r) => r[2]),
    deleted: rows.map((r) => r[3]),
  }
}

describe('cuándo se anula una vuelta', () => {
  it('lee el tiempo citado en el mensaje', () => {
    expect(quotedLapMs('CAR 12 (ANT) TIME 1:49.320 DELETED - TRACK LIMITS AT TURN 19 LAP 5 13:40:24')).toBe(109_320)
    expect(quotedLapMs('CAR 30 (LAW) LAP DELETED - TRACK LIMITS AT TURN 19 (NEXT LAP PIT)')).toBeNull()
  })

  it('caso real (Spa FP1): la anulación llega minutos después; el número de vuelta del texto no coincide', () => {
    // Coche 12: vuelta 4 de 1:49.320 acaba a 1 444 135 ms; el mensaje (que dice «LAP 5») llega a 1 799 828 ms,
    // y dos segundos después otro de una vuelta de 3:16.941 (no anulada en la tabla).
    const out = deletionTimes(laps([[12, 1_444_135, 109_320, 1]]), [
      rc(1_801_828, 'CAR 12 (ANT) TIME 3:16.941 DELETED - TRACK LIMITS AT TURN 19 (NEXT LAP)', ['12']),
      rc(1_799_828, 'CAR 12 (ANT) TIME 1:49.320 DELETED - TRACK LIMITS AT TURN 19 LAP 5 13:40:24', ['12']),
    ])
    expect([...out]).toEqual([1_799_828])
  })

  it('cada vuelta, su mensaje: el del tiempo exacto; sin tiempo, el siguiente «LAP DELETED»; sin mensaje, el final', () => {
    const out = deletionTimes(
      laps([
        [3, 3_961_358, 112_830, 1], // TIME 1:52.830
        [3, 4_074_541, 113_183, 1], // TIME 1:53.183
        [3, 4_200_000, 90_000, 0], // no anulada
        [30, 2_400_000, 109_999, 1], // «LAP DELETED» sin tiempo
        [55, 3_000_000, 110_000, 1], // sin mensaje
      ]),
      [
        rc(4_136_828, 'CAR 3 (VER) TIME 1:52.830 DELETED - TRACK LIMITS AT TURN 19 LAP 19 14:22:20', ['3']),
        rc(4_138_828, 'CAR 3 (VER) TIME 1:53.183 DELETED - TRACK LIMITS AT TURN 19 (NEXT LAP)', ['3']),
        rc(2_350_000, 'CAR 30 (LAW) LAP DELETED - TRACK LIMITS AT TURN 19', ['30']), // anterior a la vuelta
        rc(2_495_828, 'CAR 30 (LAW) TIME 1:49.247 DELETED - TRACK LIMITS AT TURN 19 LAP 10', ['30']), // otra vuelta
        rc(2_498_828, 'CAR 30 (LAW) LAP DELETED - TRACK LIMITS AT TURN 19 (NEXT LAP PIT)', ['30']),
        rc(3_100_000, 'CAR 55 (SAI) TIME 1:50.001 REINSTATED', ['55'], 'lap_reinstated'),
      ],
    )
    expect([...out]).toEqual([4_136_828, 4_138_828, Infinity, 2_498_828, 3_000_000])
  })
})
