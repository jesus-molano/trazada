import { describe, expect, it } from 'vitest'
import { constantSpeed, syntheticTrack } from '../../testing/motion'
import { PATH_PIT, PATH_TRACK } from '../replay/motion'
import { DELTA_STEP_MS, lapDelta, roundDelta } from './delta'

const L = 3000

describe('diferencia en vivo por distancia', () => {
  it('referencia ya cerrada (mejor o última vuelta): A a 50 m/s frente a B a 40 m/s', () => {
    // B dio su vuelta entre 100 s y 175 s; A empieza la suya a los 300 s.
    const B = syntheticTrack(constantSpeed(2, { fromMs: 100_000, toMs: 180_000, stepMs: 250, speedMps: 40, s0: L }))
    const A = syntheticTrack(constantSpeed(1, { fromMs: 300_000, toMs: 360_000, stepMs: 250, speedMps: 50, s0: 2 * L }))
    const a = { t: 300_000, s: 2 * L }
    const b = { t: 100_000, s: L, end: 175_000 }
    for (const dt of [1000, 10_000, 30_000, 59_000]) {
      const d = lapDelta(A, a, B, b, 300_000 + dt)
      expect(d.state).toBe('ok')
      expect(d.dA).toBeCloseTo((50 * dt) / 1000, 6)
      expect(d.at).toBeCloseTo(d.dA, 9)
      // A tarda d/50 y B d/40: A va por delante, la diferencia es negativa.
      expect(d.ms).toBeCloseTo(dt - (d.dA / 40) * 1000, 3)
    }
  })

  it('misma vuelta con B por detrás: se compara en la distancia de B (la última que han recorrido los dos)', () => {
    const A = syntheticTrack(constantSpeed(1, { fromMs: 0, toMs: 60_000, stepMs: 250, speedMps: 50 }))
    const B = syntheticTrack(constantSpeed(2, { fromMs: 0, toMs: 60_000, stepMs: 250, speedMps: 40 }))
    const d = lapDelta(A, { t: 0, s: 0 }, B, { t: 0, s: 0, end: Number.NaN }, 20_000)
    expect(d.state).toBe('ok')
    expect(d.dA).toBeCloseTo(1000, 6)
    // B lleva 800 m a los 20 s; A pasó por ahí a los 16 s.
    expect(d.at).toBeCloseTo(800, 6)
    expect(d.ms).toBeCloseTo(-4000, 3)
    // Y al revés (B por delante): en la distancia de A, que B ya había pasado.
    const r = lapDelta(B, { t: 0, s: 0 }, A, { t: 0, s: 0, end: Number.NaN }, 20_000)
    expect(r.at).toBeCloseTo(800, 6)
    expect(r.ms).toBeCloseTo(4000, 3)
  })

  it('una vuelta empezada después: cuenta el tiempo de vuelta de cada uno, no el reloj', () => {
    // Mismo ritmo, B empieza 5 s después: diferencia 0 en cualquier distancia.
    const A = syntheticTrack(constantSpeed(1, { fromMs: 0, toMs: 60_000, stepMs: 250, speedMps: 50 }))
    const B = syntheticTrack(constantSpeed(2, { fromMs: 5000, toMs: 65_000, stepMs: 250, speedMps: 50 }))
    for (const t of [10_000, 30_000, 50_000]) {
      const d = lapDelta(A, { t: 0, s: 0 }, B, { t: 5000, s: 0, end: Number.NaN }, t)
      expect(d.state).toBe('ok')
      expect(d.ms).toBeCloseTo(0, 3)
    }
  })

  it('A más allá de donde B cerró su vuelta: en la distancia de cierre de B, con su tiempo de vuelta', () => {
    const B = syntheticTrack(constantSpeed(2, { fromMs: 0, toMs: 100_000, stepMs: 250, speedMps: 50 }))
    const A = syntheticTrack(constantSpeed(1, { fromMs: 200_000, toMs: 300_000, stepMs: 250, speedMps: 50 }))
    // B cerró a los 59,8 s (2990 m); A va por 2995 m.
    const d = lapDelta(A, { t: 200_000, s: 0 }, B, { t: 0, s: 0, end: 59_800 }, 259_900)
    expect(d.state).toBe('ok')
    expect(d.at).toBeCloseTo(2990, 6)
    expect(d.ms).toBeCloseTo(0, 3)
  })

  it('A en el pit lane: «en boxes»; sin posición de A o de B en esa distancia: sin dato', () => {
    const t = [0, 250, 500, 750, 1000, 1250, 1500]
    const pit = syntheticTrack({ car: 1, t, s: [0, 10, 20, 30, 40, 50, 60], path: [0, 0, 1, 1, 1, 1, 1].map((p) => (p ? PATH_PIT : PATH_TRACK)) })
    const B = syntheticTrack(constantSpeed(2, { fromMs: 0, toMs: 60_000, stepMs: 250, speedMps: 40 }))
    const ref = { t: 0, s: 0, end: Number.NaN }
    expect(lapDelta(pit, { t: 0, s: 0 }, B, ref, 1000).state).toBe('pit')
    // A sin señal entre 1 s y 5 s.
    const gapA = syntheticTrack({ car: 1, t: [0, 250, 500, 750, 1000, 5000, 5250], s: [0, 10, 20, 30, 40, 200, 210] })
    expect(lapDelta(gapA, { t: 0, s: 0 }, B, ref, 3000).state).toBe('noData')
    // B sin señal justo en la distancia de A (y ya más allá): sin dato, no se interpola.
    const gapB = syntheticTrack({ car: 2, t: [0, 250, 500, 750, 1000, 9000, 9250], s: [0, 10, 20, 30, 40, 400, 410] })
    const A = syntheticTrack(constantSpeed(1, { fromMs: 0, toMs: 10_000, stepMs: 250, speedMps: 50 }))
    const d = lapDelta(A, { t: 0, s: 0 }, gapB, ref, 4000)
    expect(d.state).toBe('noData')
    expect(d.dA).toBeCloseTo(200, 6)
  })

  it('décimas: el GPS no da para más', () => {
    expect(DELTA_STEP_MS).toBe(100)
    expect(roundDelta(49)).toBe(0)
    expect(Object.is(roundDelta(-49), 0)).toBe(true)
    expect(roundDelta(149)).toBe(100)
    expect(roundDelta(150)).toBe(200)
    expect(roundDelta(-251)).toBe(-300)
    expect(roundDelta(1234.5)).toBe(1200)
  })
})
