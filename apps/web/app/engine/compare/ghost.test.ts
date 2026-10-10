import { describe, expect, it } from 'vitest'
import { constantSpeed, syntheticTrack } from '../../testing/motion'
import { newCarSample, sampleCar } from '../replay/motion'
import { ghostAt } from './ghost'

describe('coche fantasma', () => {
  // B dio su vuelta de referencia entre 100 s y 175 s a 40 m/s.
  const B = syntheticTrack(constantSpeed(2, { fromMs: 90_000, toMs: 200_000, stepMs: 250, speedMps: 40, s0: 2600 }))
  const ref = { t: 100_000, s: 3000, end: 175_000 }

  it('es la posición real de B al mismo tiempo de vuelta que lleva A (desplazada en el tiempo)', () => {
    for (const elapsed of [0, 12_345, 50_000, 75_000]) {
      const g = ghostAt(B, { t: 300_000 }, ref, 300_000 + elapsed)
      expect(g.state).toBe('visible')
      expect(g.t).toBe(100_000 + elapsed)
      // Lo mismo que dibujaría el replay para B en ese instante.
      expect(g.sample.s).toBeCloseTo(sampleCar(B, 100_000 + elapsed, newCarSample()).s, 9)
      expect(g.sample.s - ref.s).toBeCloseTo((40 * elapsed) / 1000, 6)
    }
  })

  it('A más lenta que la vuelta de B: el fantasma ya la había cerrado', () => {
    expect(ghostAt(B, { t: 300_000 }, ref, 300_000 + 75_001).state).toBe('finished')
  })

  it('misma vuelta con B por detrás: sería el futuro, no se dibuja', () => {
    const open = { t: 100_000, s: 3000, end: Number.NaN }
    // A empezó la vuelta antes que B: B aún no llevaba ese tiempo de vuelta.
    expect(ghostAt(B, { t: 95_000 }, open, 120_000).state).toBe('notYet')
    // B por delante: el fantasma es B hace 5 s.
    const g = ghostAt(B, { t: 105_000 }, open, 120_000)
    expect(g.state).toBe('visible')
    expect(g.t).toBe(115_000)
  })

  it('B sin posición en ese instante (hueco de más de 2 s): sin dato, nunca interpolado', () => {
    const gap = syntheticTrack({ car: 2, t: [100_000, 100_250, 100_500, 104_000, 104_250], s: [3000, 3010, 3020, 3160, 3170] })
    const r = { t: 100_000, s: 3000, end: 175_000 }
    expect(ghostAt(gap, { t: 200_000 }, r, 200_400).state).toBe('visible')
    expect(ghostAt(gap, { t: 200_000 }, r, 202_000).state).toBe('noData')
    expect(ghostAt(gap, { t: 200_000 }, r, 204_100).state).toBe('visible')
  })
})
