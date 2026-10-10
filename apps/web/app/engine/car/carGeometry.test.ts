import { describe, expect, it } from 'vitest'
import { buildCar, CAR_DIM, CAR_PARTS, type CarLayer } from './carGeometry'

const car = buildCar()
const LAYERS: CarLayer[] = ['paint', 'band', 'neutral']

function bounds() {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (const l of LAYERS) {
    const p = car.layers[l].positions
    for (let i = 0; i < p.length; i += 3)
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k]!, p[i + k]!)
        max[k] = Math.max(max[k]!, p[i + k]!)
      }
  }
  return { min, max }
}

describe('monoplaza procedural', () => {
  it('medidas de un monoplaza actual: 5,2–5,3 m de largo, 1,90 m de ancho, < 1 m de alto, sobre el suelo', () => {
    const { min, max } = bounds()
    expect(max[0]! - min[0]!).toBeGreaterThan(5.2)
    expect(max[0]! - min[0]!).toBeLessThan(5.3)
    expect(max[2]! - min[2]!).toBeLessThanOrEqual(1.9 + 1e-6)
    expect(max[1]!).toBeLessThanOrEqual(CAR_DIM.height + 1e-6)
    expect(min[1]!).toBeGreaterThanOrEqual(-1e-6) // nada por debajo del suelo
    expect(min[1]!).toBeLessThan(0.001) // las ruedas tocan el suelo
    expect(CAR_DIM.frontAxleX - CAR_DIM.rearAxleX).toBeCloseTo(3.4, 6)
  })

  it('presupuesto: ≤ 1.600 triángulos por coche', () => {
    expect(car.triangles).toBeLessThanOrEqual(1600)
    expect(car.triangles).toBeGreaterThan(1000)
    const sum = LAYERS.reduce((n, l) => n + car.layers[l].positions.length / 9, 0)
    expect(sum).toBe(car.triangles)
  })

  it('simétrico respecto al plano medio (z = 0)', () => {
    const key = (x: number, y: number, z: number) => `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`
    for (const l of LAYERS) {
      const p = car.layers[l].positions
      const set = new Set<string>()
      for (let i = 0; i < p.length; i += 3) set.add(key(p[i]!, p[i + 1]!, p[i + 2]!))
      for (let i = 0; i < p.length; i += 3) expect(set.has(key(p[i]!, p[i + 1]!, -p[i + 2]! + 0))).toBe(true)
    }
  })

  it('todas las clases de material presentes y cada una en su capa', () => {
    const seen = new Set<string>()
    for (const l of LAYERS) for (const i of car.layers[l].part) seen.add(`${l}:${CAR_PARTS[i]}`)
    expect(seen).toContain('paint:paint')
    expect(seen).toContain('band:band')
    for (const p of ['carbon', 'dark', 'tyre', 'rim', 'halo', 'helmet']) expect(seen).toContain(`neutral:${p}`)
    for (const s of seen) {
      const [layer, part] = s.split(':')
      expect(layer === 'neutral' ? !['paint', 'band'].includes(part!) : layer === part).toBe(true)
    }
  })

  it('caras hacia fuera: el volumen con signo de la carrocería pintada es positivo', () => {
    // Lofts cerrados: si alguna cara estuviera del revés, el volumen bajaría (o cambiaría de signo).
    const p = car.layers.paint.positions
    let v = 0
    for (let i = 0; i < p.length; i += 9) {
      const [ax, ay, az, bx, by, bz, cx, cy, cz] = p.subarray(i, i + 9)
      v += (ax! * (by! * cz! - bz! * cy!) - ay! * (bx! * cz! - bz! * cx!) + az! * (bx! * cy! - by! * cx!)) / 6
    }
    expect(v).toBeGreaterThan(0.5) // m³: chasis, tapa motor, pontones…
  })

  it('sombreado horneado: 0,35–1, y las caras de arriba a 1 (el color del equipo tal cual)', () => {
    const s = car.layers.paint.shade
    expect(Math.min(...s)).toBeGreaterThanOrEqual(0.35)
    expect(Math.max(...s)).toBe(1)
  })

  it('el flap trasero es una pieza aparte (para el DRS, si algún día hay dato)', () => {
    expect(car.pieces.rearFlap).toBeGreaterThan(0)
  })
})
