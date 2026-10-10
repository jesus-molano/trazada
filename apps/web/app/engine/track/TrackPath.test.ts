import { describe, expect, it } from 'vitest'
import { buildRibbon, edgeNormal, rangeIndices } from './ribbon'
import { newSample, TrackPath } from './TrackPath'

/** Círculo de radio 100 m con 628 vértices (~1 m de paso) y una rampa de 10 m de altura. */
function circle(n = 628) {
  const x: number[] = []
  const y: number[] = []
  const z: number[] = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI
    x.push(100 * Math.cos(a))
    y.push(100 * Math.sin(a))
    z.push(5 + 5 * Math.sin(a))
  }
  return new TrackPath(x, y, z, true)
}

describe('TrackPath', () => {
  it('longitud, envoltura y muestreo coherente en cualquier orden', () => {
    const p = circle()
    expect(p.length).toBeGreaterThan(2 * Math.PI * 100 - 1)
    expect(p.length).toBeLessThan(2 * Math.PI * 100 + 1)
    expect(p.wrap(-1)).toBeCloseTo(p.length - 1, 9)
    expect(p.wrap(p.length + 2)).toBeCloseTo(2, 9)
    const out = newSample()
    for (const s of [0, 157.08, 314.16, 10, 600, 3, p.length - 0.5, -50]) {
      p.sample(s, out)
      expect(Math.hypot(out.x, out.y)).toBeCloseTo(100, 0)
      expect(Math.hypot(out.tx, out.ty)).toBeCloseTo(1, 9)
      // tangente (de la cuerda) casi perpendicular al radio: |r·t| ≤ medio paso
      expect(Math.abs(out.x * out.tx + out.y * out.ty)).toBeLessThan(0.6)
    }
    p.sample(p.length / 4, out)
    expect(out.x).toBeCloseTo(0, 0)
    expect(out.y).toBeCloseTo(100, 0)
    expect(out.z).toBeCloseTo(10, 1)
  })

  it('abierta: satura en los extremos', () => {
    const p = new TrackPath([0, 10, 20], [0, 0, 0], [0, 0, 0], false)
    const out = newSample()
    expect(p.sample(-5, out).x).toBe(0)
    expect(p.sample(25, out).x).toBe(20)
    expect(p.sample(15, out).x).toBe(15)
  })
})

describe('cinta', () => {
  it('cerrada: dos vértices por punto, ancho constante y sistema Y arriba', () => {
    const p = circle(200)
    const g = buildRibbon(p, 12)
    expect(g.positions.length).toBe(200 * 6)
    expect(g.indices.length).toBe(200 * 6)
    for (let i = 0; i < 200; i++) {
      const [lx, ly, lz, rx, ry, rz] = g.positions.subarray(i * 6, i * 6 + 6)
      expect(Math.hypot(lx! - rx!, lz! - rz!)).toBeCloseTo(12, 3)
      expect(ly).toBe(ry) // misma altura a ambos lados
    }
    expect(Math.max(...g.shade)).toBe(1)
    expect(Math.min(...g.shade)).toBe(0)
  })

  it('anchura de mapa: cada vértice es su punto del eje más la semianchura real por su normal hacia fuera', () => {
    const g = buildRibbon(circle(80), 14)
    for (let v = 0; v < g.positions.length / 3; v++) {
      const [px, py, pz] = g.positions.subarray(v * 3, v * 3 + 3)
      const [cx, cy, cz] = g.mapCenter.subarray(v * 3, v * 3 + 3)
      const [nx, ny, nz] = g.mapNormal.subarray(v * 3, v * 3 + 3)
      expect(Math.hypot(nx!, ny!, nz!)).toBeCloseTo(1, 5)
      expect(Math.abs(ny!)).toBe(0) // en planta: la exageración de altura no la toca
      expect(px).toBeCloseTo(cx! + nx! * 7, 4)
      expect(py).toBeCloseTo(cy!, 4)
      expect(pz).toBeCloseTo(cz! + nz! * 7, 4)
    }
    // Los dos vértices de un punto comparten eje y tienen normales opuestas (mismo ensanche a cada lado).
    expect([...g.mapCenter.subarray(0, 3)]).toEqual([...g.mapCenter.subarray(3, 6)])
    expect(g.mapNormal[0]).toBeCloseTo(-g.mapNormal[3]!, 6)
    expect(edgeNormal(g, 'right')[0]).toBeCloseTo(-g.normal[0]!, 6)
    expect(edgeNormal(g, 'left')).toBe(g.normal)
  })

  it('plana: altura 0', () => {
    const g = buildRibbon(circle(50), 10, true)
    for (let i = 1; i < g.positions.length; i += 3) expect(g.positions[i]).toBe(0)
  })

  it('tramo [sStart, sEnd): solo los cuadriláteros de dentro, con envoltura en s = 0', () => {
    const p = circle()
    const L = p.length
    const quadsIn = (a: number, b: number) => rangeIndices(p, a, b).length / 6
    const step = L / p.count
    expect(quadsIn(100, 200)).toBeCloseTo(100 / step, -0.5)
    // Envoltura: [L − 50, 50) son ~100 m alrededor de la meta
    const wrap = rangeIndices(p, L - 50, 50)
    expect(wrap.length / 6).toBeCloseTo(100 / step, -0.5)
    expect(wrap).toContain(0) // el primer vértice (s = 0) está dentro
    // Una partición del circuito en sectores cubre cada cuadrilátero exactamente una vez
    const cuts = [0, 120, 300, 333.3, 500, L]
    let total = 0
    for (let i = 0; i < cuts.length - 1; i++) total += quadsIn(cuts[i]!, cuts[i + 1]!)
    expect(total).toBe(p.count)
  })
})
