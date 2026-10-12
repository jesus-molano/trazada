import { describe, expect, it } from 'vitest'
import { buildSkirts, GROUND_MARGIN_M, lowestY, planCircle, seamRibbon, SKIRT_FADE_M, skirtRows } from './detail'
import { buildRibbon } from './ribbon'
import { TrackPath } from './TrackPath'

/** Círculo de radio 100 m con 628 vértices (~1 m de paso) y una rampa de 0 a 40 m de altura. */
function circle(n = 628, closed = true) {
  const x: number[] = []
  const y: number[] = []
  const z: number[] = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI
    x.push(100 * Math.cos(a))
    y.push(100 * Math.sin(a))
    z.push(20 + 20 * Math.sin(a))
  }
  return new TrackPath(x, y, z, closed)
}

describe('seamRibbon', () => {
  it('una cerrada repite el primer par al final con s = longitud: s nunca baja de un vértice al siguiente', () => {
    const path = circle()
    const r = buildRibbon(path, 14)
    const seam = seamRibbon(path, r)
    expect(seam.positions.length).toBe((path.count + 1) * 6)
    expect(seam.along.length).toBe((path.count + 1) * 2)
    expect(seam.along[0]).toBe(0)
    expect(seam.along[seam.along.length - 1]).toBeCloseTo(path.length, 3)
    // El par repetido está donde el primero.
    expect([...seam.positions.subarray(path.count * 6)]).toEqual([...seam.positions.subarray(0, 6)])
    // Cada cuadrilátero va de un par al siguiente, con s creciente.
    for (let q = 0; q < seam.indices.length / 6; q++) {
      const [l0, , l1] = [seam.indices[q * 6]!, seam.indices[q * 6 + 1]!, seam.indices[q * 6 + 2]!]
      expect(seam.along[l1]!).toBeGreaterThan(seam.along[l0]!)
    }
    // Izquierda −1, derecha +1.
    expect(seam.across[0]).toBe(-1)
    expect(seam.across[1]).toBe(1)
  })

  it('una abierta (pit lane) no se cierra: los mismos vértices que la cinta', () => {
    const path = circle(100, false)
    const seam = seamRibbon(path, buildRibbon(path, 9))
    expect(seam.positions.length).toBe(path.count * 6)
    expect(seam.indices.length).toBe((path.count - 1) * 6)
  })
})

describe('buildSkirts', () => {
  it('filas de arriba al suelo, con el principio y el final del fundido solo si caben', () => {
    expect(skirtRows(40)).toEqual([0, SKIRT_FADE_M[0], SKIRT_FADE_M[1], 40])
    expect(skirtRows(10)).toEqual([0, SKIRT_FADE_M[0], 10])
    expect(skirtRows(2)).toEqual([0, 2])
    expect(skirtRows(0)).toEqual([0])
  })

  it('cae a plomo desde cada borde hasta el suelo, con el eje y la normal hacia fuera del borde', () => {
    const path = circle()
    const r = buildRibbon(path, 14)
    const sk = buildSkirts(path, r, false)
    expect(sk.groundY).toBeCloseTo(lowestY(r) - GROUND_MARGIN_M, 6)
    const count = sk.positions.length / 3
    expect(sk.depth.length).toBe(count)
    let bottoms = 0
    for (let v = 0; v < count; v++) {
      const y = sk.positions[v * 3 + 1]!
      const top = sk.mapCenter[v * 3 + 1]!
      // Profundidad = lo que hay de la pista al vértice; nunca por debajo del suelo.
      expect(top - y).toBeCloseTo(sk.depth[v]!, 4)
      expect(y).toBeGreaterThanOrEqual(sk.groundY - 1e-4)
      if (Math.abs(y - sk.groundY) < 1e-4) bottoms++
      // La normal del ensanche es horizontal y unitaria.
      expect(sk.mapNormal[v * 3 + 1]).toBe(0)
      expect(Math.hypot(sk.mapNormal[v * 3]!, sk.mapNormal[v * 3 + 2]!)).toBeCloseTo(1, 5)
    }
    expect(bottoms).toBeGreaterThan(0)
    // Todos los índices válidos y sin triángulos degenerados por índice.
    for (let t = 0; t < sk.indices.length; t += 3) {
      const [a, b, c] = [sk.indices[t]!, sk.indices[t + 1]!, sk.indices[t + 2]!]
      expect(Math.max(a, b, c)).toBeLessThan(count)
      expect(new Set([a, b, c]).size).toBe(3)
    }
  })

  it('con la pista plana, nada; con muchos puntos, como mucho 1500 columnas por lado', () => {
    const path = circle()
    expect(buildSkirts(path, buildRibbon(path, 14, true), true).indices.length).toBe(0)
    const dense = circle(6000)
    const sk = buildSkirts(dense, buildRibbon(dense, 14), false)
    const tops = [...sk.depth].filter((d) => d === 0).length
    expect(tops).toBeLessThanOrEqual(2 * 1501 + 2)
  })
})

describe('planCircle', () => {
  it('centro y radio del eje en planta', () => {
    const c = planCircle(buildRibbon(circle(), 14))
    expect(c.x).toBeCloseTo(0, 0)
    expect(c.z).toBeCloseTo(0, 0)
    expect(c.radius).toBeCloseTo(Math.hypot(200, 200) / 2, 0)
  })
})
