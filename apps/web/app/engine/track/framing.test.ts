import { PerspectiveCamera, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { fitCircuit, frameCircuit } from './framing'

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

describe('fitCircuit', () => {
  // Un trazado alargado (2 km × 600 m) en planta, en ejes de three (y = altura).
  const rect = new Float32Array(
    [
      [-1000, 0, -300],
      [1000, 0, -300],
      [1000, 0, 300],
      [-1000, 0, 300],
      [0, 0, -300],
      [0, 0, 300],
    ].flat(),
  )
  const base = { points: rect, groundY: 0, fovDeg: 35, aspect: 16 / 10, tiltDeg: 55, margin: 1.05 }

  it('sin paneles: el trazado llena la pantalla en su dimensión limitante, centrado', () => {
    const f = fitCircuit({ ...base, insets: { left: 0, right: 0, top: 0, bottom: 0 } })
    const w = f.box.x1 - f.box.x0
    const h = f.box.y1 - f.box.y0
    expect(Math.max(w / 2, h / 2)).toBeCloseTo(1 / 1.05, 2)
    expect((f.box.x0 + f.box.x1) / 2).toBeCloseTo(0, 2)
    expect((f.box.y0 + f.box.y1) / 2).toBeCloseTo(0, 2)
    expect(f.target[1]).toBe(0)
  })

  it('con paneles a los lados y abajo: cabe en el hueco libre y se centra en él', () => {
    const insets = { left: 0.28, right: 0.22, top: 0.1, bottom: 0.2 }
    const f = fitCircuit({ ...base, insets })
    expect(f.box.x0).toBeGreaterThanOrEqual(f.free.x0 - 1e-6)
    expect(f.box.x1).toBeLessThanOrEqual(f.free.x1 + 1e-6)
    expect(f.box.y0).toBeGreaterThanOrEqual(f.free.y0 - 1e-6)
    expect(f.box.y1).toBeLessThanOrEqual(f.free.y1 + 1e-6)
    expect((f.box.x0 + f.box.x1) / 2).toBeCloseTo((f.free.x0 + f.free.x1) / 2, 2)
    expect((f.box.y0 + f.box.y1) / 2).toBeCloseTo((f.free.y0 + f.free.y1) / 2, 2)
    // Ajustado: llena el hueco en al menos una dimensión (con la holgura).
    const fillX = (f.box.x1 - f.box.x0) / (f.free.x1 - f.free.x0)
    const fillY = (f.box.y1 - f.box.y0) / (f.free.y1 - f.free.y0)
    expect(Math.max(fillX, fillY)).toBeCloseTo(1 / 1.05, 2)
  })

  it('tablet vertical: el hueco libre (arriba) no contiene el centro de la pantalla', () => {
    const insets = { left: 0, right: 0, top: 0.1, bottom: 0.6 }
    const f = fitCircuit({ ...base, aspect: 0.75, insets })
    expect(f.free.y0).toBeGreaterThan(0)
    expect(f.box.y0).toBeGreaterThanOrEqual(f.free.y0 - 1e-6)
    expect(f.box.y1).toBeLessThanOrEqual(f.free.y1 + 1e-6)
    const fillX = (f.box.x1 - f.box.x0) / (f.free.x1 - f.free.x0)
    const fillY = (f.box.y1 - f.box.y0) / (f.free.y1 - f.free.y0)
    expect(Math.max(fillX, fillY)).toBeCloseTo(1 / 1.05, 2)
    expect((f.box.y0 + f.box.y1) / 2).toBeCloseTo((f.free.y0 + f.free.y1) / 2, 2)
  })

  it('paneles que tapan más de la mitad: se respetan (hasta dejar un 10 % libre)', () => {
    const f = fitCircuit({ ...base, aspect: 0.75, insets: { left: 0, right: 0, top: 0.2, bottom: 0.66 } })
    expect(f.free.y0).toBeCloseTo(-1 + 2 * 0.66, 6)
    expect(f.box.y0).toBeGreaterThanOrEqual(f.free.y0 - 1e-6)
    const tiny = fitCircuit({ ...base, insets: { left: 0, right: 0, top: 0.5, bottom: 0.8 } })
    expect(tiny.free.y1 - tiny.free.y0).toBeCloseTo(0.2, 6)
  })

  it('más cerca que el encuadre por círculo envolvente para un trazado alargado', () => {
    const fit = fitCircuit({ ...base, insets: { left: 0, right: 0, top: 0, bottom: 0.2 } })
    const old = frameCircuit({ radius: Math.hypot(1000, 300), y: 0, fovDeg: 35, aspect: 16 / 10, tiltDeg: 55, bottomInset: 0.2 })
    expect(fit.distance).toBeLessThan(old.distance)
  })
})

describe('fitCircuit frente a la cámara de three', () => {
  it('la caja calculada coincide con la proyección real de three (misma cámara)', () => {
    const pts = new Float32Array([-800, 10, -200, 900, 40, -350, 700, 0, 420, -650, 25, 300])
    const aspect = 1.7
    const f = fitCircuit({ points: pts, groundY: 20, fovDeg: 35, aspect, tiltDeg: 55, insets: { left: 0.25, right: 0.2, top: 0.05, bottom: 0.18 } })
    const cam = new PerspectiveCamera(35, aspect, 1, 1e6)
    cam.position.set(...f.position)
    cam.lookAt(new Vector3(...f.target))
    cam.updateMatrixWorld()
    let x0 = Infinity
    let x1 = -Infinity
    let y0 = Infinity
    let y1 = -Infinity
    for (let i = 0; i < pts.length; i += 3) {
      const v = new Vector3(pts[i], pts[i + 1], pts[i + 2]).project(cam)
      x0 = Math.min(x0, v.x)
      x1 = Math.max(x1, v.x)
      y0 = Math.min(y0, v.y)
      y1 = Math.max(y1, v.y)
    }
    expect(x0).toBeCloseTo(f.box.x0, 3)
    expect(x1).toBeCloseTo(f.box.x1, 3)
    expect(y0).toBeCloseTo(f.box.y0, 3)
    expect(y1).toBeCloseTo(f.box.y1, 3)
    expect(f.target[1]).toBe(20)
  })
})
