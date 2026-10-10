import { describe, expect, it } from 'vitest'
import { loadFixture } from '../../testing/fixture'
import { circuitModel, type CornerMarker } from '../track/circuit'
import { newSample, TrackPath } from '../track/TrackPath'
import { CAM_OFFSET_M, cornerCams, loopDistance, MIN_CLEARANCE_M, MIN_SPACING_M, turnAt } from './cornerCams'

/**
 * Rectángulo de esquinas redondeadas recorrido en sentido antihorario (todas las curvas a la izquierda): rectas de
 * `w` × `h` m y curvas de 90° de radio `r`, con un vértice cada ~2 m. Empieza en el centro de la recta de abajo.
 */
function roundedRect(w: number, h: number, r: number, clockwise = false): TrackPath {
  const xs: number[] = []
  const ys: number[] = []
  const push = (x: number, y: number) => {
    xs.push(x)
    ys.push(clockwise ? -y : y)
  }
  const line = (x0: number, y0: number, x1: number, y1: number) => {
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / 2))
    for (let i = 0; i < n; i++) push(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n)
  }
  const arc = (cx: number, cy: number, from: number) => {
    const n = Math.max(2, Math.round((r * Math.PI) / 2 / 2))
    for (let i = 0; i < n; i++) {
      const a = from + ((Math.PI / 2) * i) / n
      push(cx + r * Math.cos(a), cy + r * Math.sin(a))
    }
  }
  const hw = w / 2
  const hh = h / 2
  line(0, -hh - r, hw, -hh - r)
  arc(hw, -hh, -Math.PI / 2)
  line(hw + r, -hh, hw + r, hh)
  arc(hw, hh, 0)
  line(hw, hh + r, -hw, hh + r)
  arc(-hw, hh, Math.PI / 2)
  line(-hw - r, hh, -hw - r, -hh)
  arc(-hw, -hh, Math.PI)
  line(-hw, -hh - r, 0, -hh - r)
  return new TrackPath(xs, ys, new Array<number>(xs.length).fill(0), true)
}

/** s del vértice de cada curva del rectángulo (el centro de cada arco). */
function apexes(w: number, h: number, r: number): number[] {
  const q = (r * Math.PI) / 2
  const a1 = w / 2 + q / 2
  const a2 = a1 + q / 2 + h + q / 2
  const a3 = a2 + q / 2 + w + q / 2
  const a4 = a3 + q / 2 + h + q / 2
  return [a1, a2, a3, a4]
}

/** Signo del lado en que queda la cámara respecto a la normal izquierda de la pista en el vértice. */
function side(path: TrackPath, cam: { s: number; x: number; y: number }): number {
  const p = path.sample(cam.s, newSample())
  return Math.sign((cam.x - p.x) * -p.ty + (cam.y - p.y) * p.tx)
}

const marker = (label: string, s: number): CornerMarker => ({ label, s, x: 0, y: 0 })

describe('cámaras de curva', () => {
  it('el giro de la línea central: + a la izquierda, − a la derecha, 0 en recta', () => {
    const ccw = roundedRect(1000, 600, 30)
    const cw = roundedRect(1000, 600, 30, true)
    const [a1] = apexes(1000, 600, 30)
    expect(turnAt(ccw, a1!)).toBeCloseTo(Math.PI / 2, 1)
    expect(turnAt(cw, a1!)).toBeCloseTo(-Math.PI / 2, 1)
    expect(turnAt(ccw, 250)).toBeCloseTo(0, 6)
  })

  it('con curvas numeradas: una por curva cerrada, por fuera y a la distancia fija de la línea central', () => {
    const path = roundedRect(1000, 600, 30)
    const s = apexes(1000, 600, 30)
    const corners = [
      marker('1', s[0]!),
      marker('2', s[1]!),
      marker('3', s[2]!),
      marker('4', s[3]!),
      // Una curva rápida en plena recta (sin giro): no lleva cámara.
      marker('5', 250),
    ]
    const cams = cornerCams({ centerline: path, corners })
    expect(cams.map((c) => c.label)).toEqual(['1', '2', '3', '4'])
    for (const c of cams) {
      expect(c.turn).toBe(1)
      // Curva a la izquierda: por fuera es la derecha (lado −1 de la normal izquierda).
      expect(side(path, c)).toBe(-1)
      expect(Math.hypot(c.x - c.apexX, c.y - c.apexY)).toBeCloseTo(CAM_OFFSET_M, 6)
      // Por fuera de un vértice de radio 30 m, la línea central más cercana es el propio vértice.
      expect(Math.hypot(c.x, c.y)).toBeGreaterThan(Math.hypot(c.apexX, c.apexY))
    }
  })

  it('en sentido horario, por fuera es la izquierda', () => {
    const path = roundedRect(1000, 600, 30, true)
    const cams = cornerCams({ centerline: path, corners: [] })
    expect(cams).toHaveLength(4)
    for (const c of cams) {
      expect(c.turn).toBe(-1)
      expect(side(path, c)).toBe(1)
    }
  })

  it('sin curvas numeradas, en los picos de curvatura (cerca de cada vértice)', () => {
    const path = roundedRect(1000, 600, 30)
    const cams = cornerCams({ centerline: path, corners: [] })
    expect(cams).toHaveLength(4)
    expect(cams.every((c) => c.label === null)).toBe(true)
    const expected = apexes(1000, 600, 30)
    for (const c of cams) {
      const nearest = Math.min(...expected.map((a) => loopDistance(a, c.s, path.length)))
      expect(nearest).toBeLessThan(15)
    }
    // Ordenadas por s.
    expect(cams.map((c) => c.s)).toEqual([...cams.map((c) => c.s)].sort((a, b) => a - b))
  })

  it('separación mínima: de dos curvas cercanas, solo la más cerrada', () => {
    // Rectángulo bajo (200 m de lado corto): las curvas 1 y 2 quedan a ~250 m.
    const path = roundedRect(1400, 200, 30)
    const s = apexes(1400, 200, 30)
    const cams = cornerCams({ centerline: path, corners: s.map((x, i) => marker(String(i + 1), x)) })
    for (let i = 0; i < cams.length; i++) {
      for (let j = i + 1; j < cams.length; j++) {
        expect(loopDistance(cams[i]!.s, cams[j]!.s, path.length)).toBeGreaterThanOrEqual(MIN_SPACING_M)
      }
    }
    expect(cams).toHaveLength(2)
    // Con otra separación, caben todas.
    expect(cornerCams({ centerline: path, corners: s.map((x, i) => marker(String(i + 1), x)) }, { minSpacingM: 100 })).toHaveLength(4)
  })

  it('horquilla (180°): el giro se suma a pasos y la cámara queda por fuera', () => {
    // Dos rectas a 40 m unidas por horquillas de radio 20 m: entre ±40 m del vértice gira unos 180°.
    const path = roundedRect(1000, 2, 20)
    const cams = cornerCams({ centerline: path, corners: [] })
    expect(cams).toHaveLength(2)
    for (const c of cams) {
      expect(c.turn).toBe(1)
      expect(c.angle).toBeGreaterThan(Math.PI * 0.9)
      expect(side(path, c)).toBe(-1)
    }
  })

  it('una cámara que caería sobre otro tramo de la pista no se pone', () => {
    const path = roundedRect(1000, 600, 30)
    // El propio vértice queda a CAM_OFFSET_M: con una holgura mayor, ninguna cámara cabe; con una menor, todas.
    expect(cornerCams({ centerline: path, corners: [] }, { minClearanceM: CAM_OFFSET_M + 1 })).toEqual([])
    expect(cornerCams({ centerline: path, corners: [] }, { minClearanceM: CAM_OFFSET_M - 1 })).toHaveLength(4)
    expect(MIN_CLEARANCE_M).toBeLessThan(CAM_OFFSET_M)
  })

  it('fixture de Spa (sin curvas numeradas): por la curvatura, separadas y por fuera', async () => {
    const s = await loadFixture()
    const circuit = circuitModel(s.circuit)
    expect(circuit.corners).toHaveLength(0)
    const cams = cornerCams(circuit)
    expect(cams.length).toBeGreaterThanOrEqual(4)
    for (let i = 0; i < cams.length; i++) {
      expect(side(circuit.centerline, cams[i]!)).toBe(-cams[i]!.turn)
      for (let j = i + 1; j < cams.length; j++) {
        expect(loopDistance(cams[i]!.s, cams[j]!.s, circuit.centerline.length)).toBeGreaterThanOrEqual(MIN_SPACING_M)
      }
    }
    // Determinista.
    expect(cornerCams(circuit)).toEqual(cams)
  })
})
