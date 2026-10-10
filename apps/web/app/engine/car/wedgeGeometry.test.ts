import { describe, expect, it } from 'vitest'
import { buildWedge, WEDGE_DIM } from './wedgeGeometry'

const w = buildWedge()

/** Normal unitaria de cada triángulo (en el orden de dibujo: hacia fuera si está bien orientado). */
function normals(): [number, number, number][] {
  const p = w.positions
  const out: [number, number, number][] = []
  for (let i = 0; i < p.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = p.subarray(i, i + 9) as unknown as number[]
    const u = [bx! - ax!, by! - ay!, bz! - az!]
    const v = [cx! - ax!, cy! - ay!, cz! - az!]
    const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!]
    const l = Math.hypot(n[0]!, n[1]!, n[2]!)
    out.push([n[0]! / l, n[1]! / l, n[2]! / l])
  }
  return out
}

describe('cuña de lejos', () => {
  it('presupuesto: ≤ 30 triángulos, con un sombreado por vértice', () => {
    expect(w.triangles).toBeLessThanOrEqual(30)
    expect(w.positions.length).toBe(w.triangles * 9)
    expect(w.shade.length).toBe(w.triangles * 3)
  })

  it('cabe en la caja del proxy de selección (5,6 × 1,2 × 2,2 m), sobre el suelo', () => {
    const p = w.positions
    for (let i = 0; i < p.length; i += 3) {
      expect(Math.abs(p[i]!)).toBeLessThanOrEqual(2.8 + 1e-6)
      expect(p[i + 1]!).toBeGreaterThanOrEqual(-1e-6)
      expect(p[i + 1]!).toBeLessThanOrEqual(1.2 + 1e-6)
      expect(Math.abs(p[i + 2]!)).toBeLessThanOrEqual(1.1 + 1e-6)
    }
  })

  it('morro hacia +x: delante, estrecho y bajo; detrás, ancho y alto', () => {
    const p = w.positions
    const at = (x: number) => {
      let half = 0
      let top = 0
      for (let i = 0; i < p.length; i += 3)
        if (Math.abs(p[i]! - x) < 1e-6) {
          half = Math.max(half, Math.abs(p[i + 2]!))
          top = Math.max(top, p[i + 1]!)
        }
      return { half, top }
    }
    const nose = at(WEDGE_DIM.length / 2)
    const tail = at(-WEDGE_DIM.length / 2)
    expect(nose.half).toBeLessThan(tail.half / 2)
    expect(nose.top).toBeLessThan(tail.top / 2)
  })

  it('cerrada y con las caras hacia fuera: volumen con signo positivo', () => {
    const p = w.positions
    let v = 0
    for (let i = 0; i < p.length; i += 9) {
      const [ax, ay, az, bx, by, bz, cx, cy, cz] = p.subarray(i, i + 9)
      v += (ax! * (by! * cz! - bz! * cy!) - ay! * (bx! * cz! - bz! * cx!) + az! * (bx! * cy! - by! * cx!)) / 6
    }
    expect(v).toBeGreaterThan(3) // m³ (la caja que la envuelve tiene 12,3)
    expect(v).toBeLessThan(12.4)
  })

  it('convexa: se dibuja sin profundidad y sus caras delanteras nunca se pisan', () => {
    const p = w.positions
    const n = normals()
    for (let t = 0; t < w.triangles; t++) {
      const [ax, ay, az] = p.subarray(t * 9, t * 9 + 3)
      for (let i = 0; i < p.length; i += 3) {
        const d = (p[i]! - ax!) * n[t]![0] + (p[i + 1]! - ay!) * n[t]![1] + (p[i + 2]! - az!) * n[t]![2]
        expect(d).toBeLessThanOrEqual(1e-6) // todos los vértices detrás (o en) el plano de cada cara
      }
    }
  })

  it('simétrica respecto al plano medio (z = 0)', () => {
    const key = (x: number, y: number, z: number) => `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`
    const p = w.positions
    const set = new Set<string>()
    for (let i = 0; i < p.length; i += 3) set.add(key(p[i]!, p[i + 1]!, p[i + 2]!))
    for (let i = 0; i < p.length; i += 3) expect(set.has(key(p[i]!, p[i + 1]!, -p[i + 2]! + 0))).toBe(true)
  })

  it('cada cara mira hacia donde dice (morro +x, techo arriba, trasera −x, laterales ±z, suelo abajo)', () => {
    normals().forEach(([x, y, z], i) => {
      const face = w.faces[i]!
      if (face === 'nose') expect(x).toBeGreaterThan(0.6)
      if (face === 'top') expect(y).toBeGreaterThan(0.9)
      if (face === 'tail') expect(x).toBeLessThan(-0.99)
      if (face === 'side') expect(Math.abs(z)).toBeGreaterThan(0.6)
      if (face === 'bottom') expect(y).toBeLessThan(-0.99)
    })
  })

  it('sombreado: el techo a 1 (el color del equipo tal cual); laterales más oscuros y la trasera, aún más', () => {
    const tone = (face: string) => [...new Set(w.faces.flatMap((f, i) => (f === face ? [w.shade[i * 3]!] : [])))]
    expect(tone('top')).toEqual([1])
    expect(tone('side')).toHaveLength(1) // los dos laterales iguales
    expect(tone('side')[0]!).toBeLessThan(0.85)
    expect(tone('tail')[0]!).toBeLessThan(tone('side')[0]!)
    expect(Math.min(...w.shade)).toBeGreaterThanOrEqual(0.3)
    // Sombreado plano: cada triángulo con un solo tono.
    for (let i = 0; i < w.triangles; i++) expect(new Set(w.shade.subarray(i * 3, i * 3 + 3)).size).toBe(1)
  })
})
