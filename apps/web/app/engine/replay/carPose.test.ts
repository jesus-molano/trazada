import { describe, expect, it } from 'vitest'
import { carPose } from './carPose'

describe('pose del coche en la escena', () => {
  it('canónico (x, y, z) → three (x, z, −y)', () => {
    const p = carPose({ x: 10, y: 20, z: 3, heading: 0 }, 0, false, { x: 0, y: 0, z: 0 })
    expect(p).toEqual({ x: 10, y: 3, z: -20 })
    expect(carPose({ x: 10, y: 20, z: 3, heading: 0 }, 0, true, p).y).toBe(0)
  })

  it('la separación desplaza a la izquierda del rumbo', () => {
    // Rumbo +x (heading 0): la izquierda es +y canónico → −z en three.
    const p = carPose({ x: 0, y: 0, z: 0, heading: 0 }, 2, false, { x: 0, y: 0, z: 0 })
    expect(p.x).toBeCloseTo(0)
    expect(p.z).toBeCloseTo(-2)
    // Rumbo +y (heading π/2): la izquierda es −x.
    const q = carPose({ x: 0, y: 0, z: 0, heading: Math.PI / 2 }, 2, false, { x: 0, y: 0, z: 0 })
    expect(q.x).toBeCloseTo(-2)
    expect(q.z).toBeCloseTo(0)
  })
})
