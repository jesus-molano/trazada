/**
 * Malla de cinta (pista o pit lane) a lo largo de una polilínea. Sistema de three.js (Y arriba):
 * canónico (x, y, z) → three (x, z, −y). La exageración de altura se aplica con la escala Y del grupo.
 */
import type { TrackPath } from './TrackPath'

/** Anchura de la cinta de la pista (m), común a la pista y a sus capas de banderas. */
export const TRACK_WIDTH_M = 14

export interface RibbonGeometry {
  positions: Float32Array
  /** Sombreado por altura (0 = punto más bajo, 1 = más alto), para el color por vértice. */
  shade: Float32Array
  indices: Uint32Array
  /** Bordes izquierdo y derecho como tiras de puntos (para líneas). */
  left: Float32Array
  right: Float32Array
  /** Eje de la cinta y normal izquierda en planta (three), para cambiar la anchura sin rehacerla. */
  center: Float32Array
  normal: Float32Array
  /** Semianchura con la que están escritas `positions`, `left` y `right` (m). */
  half: number
}

export function toThree(x: number, y: number, z: number, out: Float32Array, offset: number): void {
  out[offset] = x
  out[offset + 1] = z
  out[offset + 2] = -y
}

export function buildRibbon(path: TrackPath, width: number, flat = false): RibbonGeometry {
  const n = path.count
  const positions = new Float32Array(n * 2 * 3)
  const shade = new Float32Array(n * 2)
  const left = new Float32Array(n * 3)
  const right = new Float32Array(n * 3)
  const center = new Float32Array(n * 3)
  const normal = new Float32Array(n * 3)
  const p = { x: 0, y: 0, z: 0 }
  const q = { x: 0, y: 0, z: 0 }
  const r = { x: 0, y: 0, z: 0 }
  let zMin = Infinity
  let zMax = -Infinity
  for (let i = 0; i < n; i++) {
    path.vertex(i, p)
    zMin = Math.min(zMin, p.z)
    zMax = Math.max(zMax, p.z)
  }
  const zRange = zMax - zMin || 1
  for (let i = 0; i < n; i++) {
    // Tangente por diferencias centrales (en los extremos de una abierta, hacia un lado).
    const a = path.closed ? (i - 1 + n) % n : Math.max(0, i - 1)
    const b = path.closed ? (i + 1) % n : Math.min(n - 1, i + 1)
    path.vertex(i, p)
    path.vertex(a, q)
    path.vertex(b, r)
    const tx = r.x - q.x
    const ty = r.y - q.y
    const h = Math.hypot(tx, ty) || 1
    const nx = -ty / h
    const ny = tx / h
    const z = flat ? 0 : p.z
    toThree(p.x, p.y, z, center, i * 3)
    // Normal izquierda en planta, en ejes de three: (nx, ny, 0) canónico → (nx, 0, −ny).
    normal[i * 3] = nx
    normal[i * 3 + 2] = -ny
    const sh = flat ? 0.5 : (p.z - zMin) / zRange
    shade[i * 2] = sh
    shade[i * 2 + 1] = sh
  }
  const quads = path.closed ? n : n - 1
  const indices = new Uint32Array(quads * 6)
  for (let i = 0; i < quads; i++) {
    const j = (i + 1) % n
    const [l0, r0, l1, r1] = [i * 2, i * 2 + 1, j * 2, j * 2 + 1]
    indices.set([l0, r0, l1, r0, r1, l1], i * 6)
  }
  const ribbon: RibbonGeometry = { positions, shade, indices, left, right, center, normal, half: 0 }
  setRibbonHalfWidth(ribbon, width / 2)
  return ribbon
}

/**
 * Reescribe en sitio la cinta (y sus bordes) con otra semianchura, con la misma forma: así la pista puede
 * ensancharse en pantalla al alejarse sin rehacer la malla.
 */
export function setRibbonHalfWidth(r: RibbonGeometry, half: number): void {
  const { center, normal, positions, left, right } = r
  const n = center.length / 3
  for (let i = 0; i < n; i++) {
    const cx = center[i * 3]!
    const cy = center[i * 3 + 1]!
    const cz = center[i * 3 + 2]!
    const nx = normal[i * 3]! * half
    const nz = normal[i * 3 + 2]! * half
    positions[i * 6] = left[i * 3] = cx + nx
    positions[i * 6 + 1] = left[i * 3 + 1] = cy
    positions[i * 6 + 2] = left[i * 3 + 2] = cz + nz
    positions[i * 6 + 3] = right[i * 3] = cx - nx
    positions[i * 6 + 4] = right[i * 3 + 1] = cy
    positions[i * 6 + 5] = right[i * 3 + 2] = cz - nz
  }
  r.half = half
}

/**
 * Índices de los cuadriláteros de la cinta de una línea cerrada cuyo punto medio cae en [sStart, sEnd)
 * (con envoltura en s = 0 si sStart > sEnd). Comparten las posiciones de `buildRibbon` sobre la misma línea.
 */
export function rangeIndices(path: TrackPath, sStart: number, sEnd: number): Uint32Array {
  const n = path.count
  const quads = path.closed ? n : n - 1
  const a = path.wrap(sStart)
  const b = path.wrap(sEnd)
  const out: number[] = []
  for (let i = 0; i < quads; i++) {
    const s0 = path.vertexS(i)
    const s1 = i + 1 < n ? path.vertexS(i + 1) : path.length
    const mid = (s0 + s1) / 2
    const inside = a <= b ? mid >= a && mid < b : mid >= a || mid < b
    if (!inside) continue
    const j = (i + 1) % n
    const [l0, r0, l1, r1] = [i * 2, i * 2 + 1, j * 2, j * 2 + 1]
    out.push(l0, r0, l1, r0, r1, l1)
  }
  return Uint32Array.from(out)
}
