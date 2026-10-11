import { describe, expect, it } from 'vitest'
import type { CarState } from './ReplayModel'
import { lateralOffsets, SLOT_M } from './separation'

const car = (car: string, s: number, over: Partial<CarState> = {}): CarState => ({
  car,
  driver: null,
  visible: true,
  inPit: false,
  transition: false,
  s,
  speedMps: 50,
  x: 0,
  y: 0,
  z: 0,
  heading: 0,
  ...over,
})

describe('separación visual', () => {
  const L = 5000
  const out = new Float32Array(6)

  it('dos coches juntos se abren a ±slot/2; los lejanos no se mueven', () => {
    const moved = lateralOffsets([car('1', 100), car('2', 104), car('3', 900)], L, out)
    expect(moved).toBe(2)
    expect(out[0]).toBeCloseTo(-SLOT_M / 2, 6)
    expect(out[1]).toBeCloseTo(SLOT_M / 2, 6)
    expect(out[2]).toBe(0)
  })

  it('un grupo que cruza la meta (s envuelta, vueltas distintas) no se parte', () => {
    lateralOffsets([car('1', 2 * L - 3), car('2', 3 * L + 2), car('3', L + 2500)], L, out)
    expect(out[0]).toBeLessThan(0)
    expect(out[1]).toBeGreaterThan(0)
    expect(out[2]).toBe(0)
  })

  it('en el pit lane, en transición u ocultos: sin desplazamiento', () => {
    const moved = lateralOffsets(
      [car('1', 100, { inPit: true }), car('2', 101), car('3', 102, { visible: false }), car('4', 103, { transition: true })],
      L,
      out,
    )
    expect(moved).toBe(0)
    expect([...out.slice(0, 4)]).toEqual([0, 0, 0, 0])
  })

  it('muchos coches juntos: la apertura total no pasa de 10 m (no salen de la pista)', () => {
    const many = Array.from({ length: 6 }, (_, i) => car(String(i), 200 + i))
    lateralOffsets(many, L, out)
    expect(Math.max(...out) - Math.min(...out)).toBeLessThanOrEqual(10 + 1e-6)
  })
})
