import { describe, expect, it } from 'vitest'
import { loadFixture } from '../../testing/fixture'
import { circuitModel } from '../track/circuit'
import { carTracks } from './motion'
import { ReplayModel } from './ReplayModel'

describe('ReplayModel con el fixture de Spa', () => {
  it('coloca los coches sobre la pista o el pit lane, con s no decreciente', async () => {
    const s = await loadFixture()
    const circuit = circuitModel(s.circuit)
    const model = new ReplayModel(carTracks(s.motion, s.tangents), circuit, s.manifest.drivers)
    expect(model.states.length).toBe(s.manifest.drivers.length)
    const { startMs, endMs } = s.manifest.session.playback
    const prev = new Map<string, number>()
    let seen = 0
    let pit = 0
    for (let t = startMs; t <= endMs; t += 997) {
      model.update(t)
      for (const st of model.states) {
        if (!st.visible) continue
        seen++
        if (st.inPit) pit++
        expect(st.driver?.number).toBe(st.car)
        const p = prev.get(st.car)
        if (p !== undefined) expect(st.s).toBeGreaterThanOrEqual(p - 1e-6)
        prev.set(st.car, st.s)
        // A menos de 15 m de la línea central (en pista) o en una zona cercana al pit lane.
        if (!st.inPit && !st.transition) {
          const q = circuit.centerline.sample(st.s, { x: 0, y: 0, z: 0, tx: 1, ty: 0 })
          expect(Math.hypot(q.x - st.x, q.y - st.y)).toBeLessThan(1e-6)
        }
      }
    }
    expect(seen).toBeGreaterThan(1000)
    expect(pit).toBeGreaterThan(0)
    const order = model.orderByDistance()
    for (let i = 1; i < order.length; i++) expect(order[i - 1]!.s).toBeGreaterThanOrEqual(order[i]!.s)
  })
})
