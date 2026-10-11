import { describe, expect, it } from 'vitest'
import { hermiteAt, segmentStarts, segmentTangents } from './hermite'

function series(n: number, seed = 1) {
  let x = seed
  const rnd = () => ((x = (x * 16807) % 2147483647) / 2147483647)
  const t = new Float64Array(n)
  const s = new Float64Array(n)
  for (let i = 1; i < n; i++) {
    t[i] = t[i - 1]! + 230 + rnd() * 60
    // velocidad 20–90 m/s con frenadas bruscas y algún tramo parado
    const v = i % 40 < 3 ? 0 : 0.02 + 0.07 * rnd()
    s[i] = s[i - 1]! + v * (t[i]! - t[i - 1]!)
  }
  return { t, s }
}

describe('Hermite monótona', () => {
  for (const mode of ['pchip', 'speed'] as const) {
    it(`${mode}: pasa por las muestras, no decrece y la velocidad es continua en los nodos`, () => {
      const { t, s } = series(400)
      const m = new Float64Array(t.length)
      const speed = mode === 'speed' ? Float64Array.from(s, (_, i) => (i > 0 ? (s[i]! - s[i - 1]!) / (t[i]! - t[i - 1]!) * 1.1 : 0)) : undefined
      segmentTangents(t, s, 0, t.length, m, speed)
      const out = { s: 0, v: 0 }
      let prev = -Infinity
      for (let i = 0; i < t.length - 1; i++) {
        hermiteAt(t, s, m, i, t[i]!, out)
        expect(Math.abs(out.s - s[i]!)).toBeLessThan(0.01) // < 1 cm en la muestra
        for (let k = 0; k <= 20; k++) {
          hermiteAt(t, s, m, i, t[i]! + ((t[i + 1]! - t[i]!) * k) / 20, out)
          expect(out.s).toBeGreaterThanOrEqual(prev - 1e-9)
          expect(out.v).toBeGreaterThanOrEqual(-1e-12)
          prev = out.s
        }
        if (i > 0) {
          // C1: la derivada al final del tramo anterior = al principio de este
          const left = { s: 0, v: 0 }
          hermiteAt(t, s, m, i - 1, t[i]!, left)
          hermiteAt(t, s, m, i, t[i]!, out)
          expect(Math.abs(left.v - out.v)).toBeLessThan(1e-9)
        }
      }
    })
  }

  it('corta segmentos en huecos > 2 s y en cambios de path', () => {
    const t = [0, 250, 500, 3000, 3250, 3500, 3750]
    const path = [0, 0, 0, 0, 1, 1, 0]
    expect(segmentStarts(t, path)).toEqual([0, 3, 4, 6])
  })

  it('segmentos de una muestra y tramos parados', () => {
    const t = Float64Array.from([0, 250, 500, 750])
    const s = Float64Array.from([10, 10, 10, 20])
    const m = new Float64Array(4)
    segmentTangents(t, s, 0, 4, m)
    expect(m[0]).toBe(0)
    expect(m[1]).toBe(0)
    const out = { s: 0, v: 0 }
    hermiteAt(t, s, m, 1, 375, out)
    expect(out.s).toBe(10)
    segmentTangents(t, s, 3, 4, m)
    expect(m[3]).toBe(0)
  })
})
