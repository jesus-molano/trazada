import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LOCAL_DATA_ROOT, loadFixture, loadLocal } from '../../testing/fixture'
import { cornerAnchor, circuitModel } from './circuit'

describe('modelo de circuito (fixture de Spa)', () => {
  it('línea cerrada con la longitud del meta, pit lane a ±10 % de las muestras de pit', async () => {
    const s = await loadFixture()
    const m = circuitModel(s.circuit)
    expect(m.centerline.closed).toBe(true)
    expect(Math.abs(m.centerline.length - m.meta.lengthM)).toBeLessThan(2)
    expect(m.pitlane).not.toBeNull()
    const samples = m.meta.quality.pitSamplesLengthM!
    expect(Math.abs(m.pitlane!.length - samples) / samples).toBeLessThanOrEqual(0.1)
    expect(m.zRange[1] - m.zRange[0]).toBeGreaterThan(50) // Spa: ~100 m de desnivel
    expect(m.extent).toBeGreaterThan(500)
  })
})

const LOCAL = ['2026/10-spa-francorchamps/fp1', '2026/03-suzuka/race'].filter((id) =>
  existsSync(`${LOCAL_DATA_ROOT}v1/sessions/${id}/manifest.json`),
)

describe.skipIf(LOCAL.length === 0)('curvas frente a MultiViewer (local)', () => {
  it.each(LOCAL)('%s: etiqueta a < 30 m del XY de MultiViewer', async (id) => {
    const m = circuitModel((await loadLocal(id)).circuit)
    if (m.corners.length === 0) return // circuito construido sin MultiViewer
    for (const c of m.corners) {
      const a = cornerAnchor(m, c)
      expect(Math.hypot(a.x - c.x, a.y - c.y), `curva ${c.label}`).toBeLessThan(30)
    }
  })
})
