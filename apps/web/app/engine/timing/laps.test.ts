import { describe, expect, it } from 'vitest'
import { fakeTrzb, loadFixture } from '../../testing/fixture'
import { lapsView } from '../data/columns'
import { LapTimes } from './laps'

// Coche 1: vuelta 1 (sin tiempo oficial en carrera), 2 y 3; la salida es en t = 1000.
const timing = fakeTrzb('timing', {
  laps: {
    car: [1, 1, 1],
    lap: [1, 2, 3],
    startMs: [-1, 91_000, 181_000],
    endMs: [91_000, 181_000, 271_000],
    lapMs: [-1, 90_000, 90_000],
    pitInMs: [-1, -1, -1],
    pitOutMs: [-1, -1, -1],
    position: [1, 1, 1],
    compound: [2, 2, 2],
    deleted: [0, 0, 0],
  },
})

describe('tiempos de vuelta', () => {
  it('vuelta en curso y última completada con su tiempo oficial', () => {
    const lt = new LapTimes(timing, 'race', 1000)
    expect(lt.at('1', 50_000, false)).toEqual({ lap: 1, lastLap: null, lastLapMs: null, estimated: false })
    expect(lt.at('1', 200_000, false)).toEqual({ lap: 3, lastLap: 2, lastLapMs: 90_000, estimated: false })
    expect(lt.at('1', 300_000, false)).toEqual({ lap: null, lastLap: 3, lastLapMs: 90_000, estimated: false })
  })

  it('vuelta 1 de carrera: sin tiempo salvo que el usuario pida la estimación (y entonces va marcada)', () => {
    const lt = new LapTimes(timing, 'race', 1000)
    expect(lt.at('1', 100_000, false)).toMatchObject({ lastLap: 1, lastLapMs: null, estimated: false })
    expect(lt.at('1', 100_000, true)).toMatchObject({ lastLap: 1, lastLapMs: 90_000, estimated: true })
  })

  it('en libres no hay estimación de la vuelta 1 (es una vuelta de salida)', () => {
    const lt = new LapTimes(timing, 'fp1', null)
    expect(lt.canEstimateLap1).toBe(false)
    expect(lt.at('1', 100_000, true)).toMatchObject({ lastLapMs: null, estimated: false })
  })

  it('en el fixture, cada vuelta con tiempo devuelve exactamente su lapMs', async () => {
    const s = await loadFixture()
    const v = lapsView(s.timing)
    const lt = new LapTimes(s.timing, s.manifest.session.type, null)
    for (let i = 0; i < v.rows; i++) {
      if (v.lapMs[i]! < 0 || v.endMs[i]! < 0) continue
      const info = lt.at(String(v.car[i]), v.endMs[i]!, false)
      expect(info.lastLap).toBe(v.lap[i])
      expect(info.lastLapMs).toBe(v.lapMs[i])
    }
  })
})
