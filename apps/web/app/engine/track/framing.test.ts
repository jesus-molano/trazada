import { PerspectiveCamera, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { frameCircuit } from './framing'

/** Proyecta un círculo de radio R en el plano y comprueba que cae en la zona visible. */
function fits(aspect: number, inset: number) {
  const R = 1000
  const f = frameCircuit({ radius: R, y: 0, fovDeg: 35, aspect, tiltDeg: 55, bottomInset: inset })
  const cam = new PerspectiveCamera(35, aspect, 1, 1e6)
  cam.position.set(...f.position)
  cam.lookAt(new Vector3(...f.target))
  cam.updateMatrixWorld()
  let minY = Infinity
  for (let a = 0; a < 2 * Math.PI; a += 0.05) {
    const v = new Vector3(R * Math.cos(a), 0, R * Math.sin(a)).project(cam)
    expect(Math.abs(v.x)).toBeLessThanOrEqual(1)
    expect(v.y).toBeLessThanOrEqual(1)
    minY = Math.min(minY, v.y)
  }
  // nada por debajo de la franja tapada (en NDC, de -1 a -1 + 2·inset)
  expect(minY).toBeGreaterThanOrEqual(-1 + 2 * inset - 1e-6)
}

describe('encuadre de la cámara', () => {
  it.each([
    [16 / 9, 0.2],
    [1, 0.2],
    [9 / 19, 0.25],
    [2.4, 0],
  ])('aspecto %f, franja %f', (aspect, inset) => fits(aspect, inset))
})
