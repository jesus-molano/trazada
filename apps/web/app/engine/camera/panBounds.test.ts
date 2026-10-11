import { describe, expect, it } from 'vitest'
import { clampPan, PAN_MARGIN_MIN_M, panBox } from './panBounds'

// Un circuito de 4 km × 2 km en planta (x de −2000 a 2000, z de −1000 a 1000), en ejes de three (x, y, z).
const POINTS = [-2000, 0, -1000, 2000, 5, -1000, 2000, 10, 1000, -2000, 0, 1000, 0, 3, 0]

describe('límite del desplazamiento del mapa (D53)', () => {
  it('la caja es la del circuito más un cuarto de su lado mayor', () => {
    expect(panBox(POINTS)).toEqual({ minX: -3000, maxX: 3000, minZ: -2000, maxZ: 2000 })
  })

  it('en un circuito pequeño, el margen mínimo', () => {
    const box = panBox([0, 0, 0, 100, 0, 50])
    expect(box).toEqual({ minX: -PAN_MARGIN_MIN_M, maxX: 100 + PAN_MARGIN_MIN_M, minZ: -PAN_MARGIN_MIN_M, maxZ: 50 + PAN_MARGIN_MIN_M })
  })

  it('sin puntos, una caja en el origen (nunca NaN)', () => {
    expect(panBox([])).toEqual({ minX: 0, maxX: 0, minZ: 0, maxZ: 0 })
  })

  it('dentro de la caja, ningún delta; fuera, el que lo devuelve al borde (cada eje por separado)', () => {
    const box = panBox(POINTS)
    const out = { dx: 1, dz: 1 }
    expect(clampPan(100, -500, box, out)).toEqual({ dx: 0, dz: 0 })
    expect(clampPan(3500, 0, box, out)).toEqual({ dx: -500, dz: 0 })
    expect(clampPan(-3200, -2600, box, out)).toEqual({ dx: 200, dz: 600 })
    expect(clampPan(3000, 2000, box, out)).toEqual({ dx: 0, dz: 0 }) // en el borde, se queda
  })

  it('con el delta aplicado a target y cámara, el target queda dentro y la vista no cambia de forma', () => {
    const box = panBox(POINTS)
    const target = { x: 9000, z: -7000 }
    const cam = { x: 9000, z: -5500 }
    const { dx, dz } = clampPan(target.x, target.z, box, { dx: 0, dz: 0 })
    target.x += dx
    target.z += dz
    cam.x += dx
    cam.z += dz
    expect(target).toEqual({ x: 3000, z: -2000 })
    expect(cam.z - target.z).toBe(1500) // misma distancia y dirección
  })
})
