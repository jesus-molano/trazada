import { describe, expect, it } from 'vitest'
import type { CarState } from './ReplayModel'
import { LaneOffsets, lateralOffsets, SLOT_M, smoothOffsets } from './separation'

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

describe('cambio de carril suave (D54)', () => {
  it('cuando el hueco salta, el coche lo sigue sin saltos laterales grandes de un frame a otro', () => {
    const cur = new Float32Array([0, 0])
    const goal = new Float32Array([-SLOT_M / 2, SLOT_M / 2])
    let maxStep = 0
    let moving = true
    let frames = 0
    while (moving && frames < 600) {
      const before = cur[0]!
      moving = smoothOffsets(cur, goal, 1000 / 60)
      maxStep = Math.max(maxStep, Math.abs(cur[0]! - before))
      frames++
    }
    // A 60 Hz, nunca más de ~9 cm por frame (el salto de golpe eran 1,2 m), y en su hueco en menos de 2 s.
    expect(maxStep).toBeLessThan(0.1)
    expect(frames).toBeLessThan(120)
    expect(cur[0]).toBe(goal[0])
    expect(cur[1]).toBe(goal[1])
  })

  it('va al mismo ritmo en tiempo real a 30 o a 120 Hz', () => {
    const at = (hz: number) => {
      const cur = new Float32Array([0])
      const goal = new Float32Array([2])
      for (let i = 0; i < hz * 0.2; i++) smoothOffsets(cur, goal, 1000 / hz)
      return cur[0]!
    }
    expect(at(30)).toBeCloseTo(at(120), 4)
    expect(at(60)).toBeGreaterThan(1)
    expect(at(60)).toBeLessThan(1.8)
  })

  it('sin tiempo transcurrido no se mueve; ya en su hueco, no pide más frames', () => {
    const cur = new Float32Array([0.5])
    expect(smoothOffsets(cur, new Float32Array([1]), 0)).toBe(true)
    expect(cur[0]).toBe(0.5)
    const settled = new Float32Array([1])
    expect(smoothOffsets(settled, new Float32Array([1]), 16)).toBe(false)
  })
})

describe('LaneOffsets: lo que se dibuja (D54)', () => {
  const L = 5000
  const FRAME = 1000 / 60

  it('al formarse un grupo, cada coche se abre poco a poco; tras un seek, va directo a su hueco', () => {
    const lanes = new LaneOffsets(2)
    lanes.update([car('1', 100), car('2', 900)], L, true, 0) // primera vez: colocados (lejos, a 0)
    expect([...lanes.current]).toEqual([0, 0])
    lanes.update([car('1', 100), car('2', 104)], L, true, FRAME)
    expect(lanes.separated).toBe(2)
    expect(Math.abs(lanes.current[0]!)).toBeGreaterThan(0)
    expect(Math.abs(lanes.current[0]!)).toBeLessThan(0.1)
    expect(lanes.moving).toBe(true)
    // Salto en el tiempo a otro instante con otro grupo: sin barrer la pista.
    lanes.snap()
    lanes.update([car('1', 3000), car('2', 3003)], L, true, FRAME)
    expect(lanes.current[0]).toBeCloseTo(-SLOT_M / 2, 6)
    expect(lanes.current[1]).toBeCloseTo(SLOT_M / 2, 6)
    expect(lanes.moving).toBe(false)
  })

  it('apagar la separación junta los coches suavemente, y un coche que no se ve sale ya en su hueco', () => {
    const lanes = new LaneOffsets(2)
    const pack = [car('1', 100), car('2', 104)]
    lanes.update(pack, L, true, 0)
    lanes.update(pack, L, false, FRAME)
    expect(lanes.separated).toBe(0)
    expect(Math.abs(lanes.current[0]!)).toBeGreaterThan(SLOT_M / 2 - 0.1)
    for (let i = 0; i < 120; i++) lanes.update(pack, L, false, FRAME)
    expect([...lanes.current]).toEqual([0, 0])
    lanes.update([car('1', 100, { visible: false }), car('2', 104)], L, true, FRAME)
    expect(lanes.current[0]).toBe(0) // oculto: sin desplazamiento
  })
})
