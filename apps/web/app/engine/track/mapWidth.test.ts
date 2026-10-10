import { describe, expect, it } from 'vitest'
import { screenHalfWidth, viewDistance, widthChanged, worldPerPixel } from './mapWidth'

describe('anchura de mapa', () => {
  it('metros por píxel crecen con la distancia', () => {
    const a = worldPerPixel(1000, 35, 800)
    expect(worldPerPixel(2000, 35, 800)).toBeCloseTo(2 * a)
    expect(a).toBeCloseTo((2 * 1000 * Math.tan((17.5 * Math.PI) / 180)) / 800)
  })

  it('de cerca, la anchura real; de lejos, el mínimo en píxeles', () => {
    expect(screenHalfWidth(7, 40, 35, 800, 7)).toBe(7)
    const far = screenHalfWidth(7, 4000, 35, 800, 7)
    expect(far).toBeGreaterThan(7)
    expect(far / worldPerPixel(4000, 35, 800)).toBeCloseTo(3.5)
  })

  it('distancia al suelo en la dirección de mira', () => {
    const s = Math.SQRT1_2
    expect(viewDistance({ x: 0, y: 100, z: 0 }, { x: 0, y: -1, z: 0 }, 0)).toBeCloseTo(100)
    expect(viewDistance({ x: 0, y: 100, z: 0 }, { x: 0, y: -s, z: -s }, 0)).toBeCloseTo(100 * Math.SQRT2)
    // Mirando al horizonte: la altura (no infinito).
    expect(viewDistance({ x: 0, y: 100, z: 0 }, { x: 0, y: 0, z: -1 }, 0)).toBe(100)
  })

  it('solo se reescribe la malla con cambios de más de un 3 %', () => {
    expect(widthChanged(10, 10.2)).toBe(false)
    expect(widthChanged(10, 10.5)).toBe(true)
  })
})
