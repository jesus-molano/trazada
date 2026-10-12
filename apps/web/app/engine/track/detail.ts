/**
 * Detalle del trazado (D50, lámina 5 «Herramienta pro»): lo que se dibuja además de la cinta, todo con datos del
 * circuito salvo lo que se declara decorativo en «Cómo se dibuja».
 *
 * - `seamRibbon`: la cinta de `buildRibbon` con la distancia recorrida (`along`, en m) y el lado (`across`, −1 a la
 *   izquierda y +1 a la derecha) en cada vértice, para pintar en el shader el sentido de la marcha (chevrones cada
 *   cierto número de metros, en el sentido de s creciente). En una línea cerrada, el primer par de vértices se repite al
 *   final con s = longitud: si no, el último cuadrilátero iría de s ≈ longitud a s = 0 y el dibujo se rompería ahí.
 * - `buildSkirts`: faldones desde cada borde de la cinta hasta el suelo (el punto más bajo del circuito menos un
 *   margen). La altura es dato; el faldón se funde con el fondo entre `SKIRT_FADE_M[0]` y `SKIRT_FADE_M[1]` por debajo
 *   de la pista (dice «más alto que» sin dibujar un terraplén). Lleva el eje y la normal de cada borde para que el
 *   shader de anchura de mapa lo ensanche igual que la cinta (arriba y abajo con el mismo eje: el faldón cae a plomo).
 *
 * Sistema de three (Y arriba): canónico (x, y, z) → three (x, z, −y), como `ribbon.ts`.
 */
import type { RibbonGeometry } from './ribbon'
import type { TrackPath } from './TrackPath'

/** Cada cuántos metros va un chevrón de sentido de la marcha en la cinta (TzTrack). */
export const CHEVRON_EVERY_M = 320
/** Por debajo de la pista, de dónde a dónde se funde el faldón con el fondo (m). */
export const SKIRT_FADE_M: readonly [number, number] = [4, 30]
/** Margen del suelo por debajo del punto más bajo del circuito (m). */
export const GROUND_MARGIN_M = 1.5
/** Columnas de faldón por lado, como mucho (con más puntos en la línea, se toma uno de cada pocos). */
const MAX_SKIRT_COLUMNS = 1500

export interface SeamRibbon {
  positions: Float32Array
  shade: Float32Array
  mapCenter: Float32Array
  mapNormal: Float32Array
  indices: Uint32Array
  /** Distancia recorrida de cada vértice (m), de 0 a la longitud (incluida, en la costura de una cerrada). */
  along: Float32Array
  /** Lado de cada vértice: −1 el izquierdo, +1 el derecho. */
  across: Float32Array
}

/** La cinta con `along` y `across`, y la costura de una línea cerrada sin salto de s (ver arriba). */
export function seamRibbon(path: TrackPath, r: RibbonGeometry): SeamRibbon {
  const n = path.count
  const pairs = path.closed ? n + 1 : n
  const copy = (src: Float32Array, per: number) => {
    const out = new Float32Array(pairs * per)
    out.set(src.subarray(0, n * per))
    if (path.closed) out.set(src.subarray(0, per), n * per)
    return out
  }
  const positions = copy(r.positions, 6)
  const shade = copy(r.shade, 2)
  const mapCenter = copy(r.mapCenter, 6)
  const mapNormal = copy(r.mapNormal, 6)
  const along = new Float32Array(pairs * 2)
  const across = new Float32Array(pairs * 2)
  for (let i = 0; i < pairs; i++) {
    const s = i < n ? path.vertexS(i) : path.length
    along[i * 2] = along[i * 2 + 1] = s
    across[i * 2] = -1
    across[i * 2 + 1] = 1
  }
  const quads = pairs - 1
  const indices = new Uint32Array(quads * 6)
  for (let i = 0; i < quads; i++) {
    const j = i + 1
    indices.set([i * 2, i * 2 + 1, j * 2, i * 2 + 1, j * 2 + 1, j * 2], i * 6)
  }
  return { positions, shade, mapCenter, mapNormal, indices, along, across }
}

export interface SkirtGeometry {
  positions: Float32Array
  /** Cuánto por debajo de la pista está cada vértice (m, sin la exageración de altura): 0 arriba. */
  depth: Float32Array
  mapCenter: Float32Array
  mapNormal: Float32Array
  indices: Uint32Array
  /** Altura del suelo (three, m). */
  groundY: number
}

/** Profundidades de las filas de un faldón de `full` m: arriba, el principio y el final del fundido, y el suelo. */
export function skirtRows(full: number): number[] {
  const rows = [0]
  for (const d of SKIRT_FADE_M) if (d < full) rows.push(d)
  if (full > 0) rows.push(full)
  return rows
}

/**
 * Faldones de los dos bordes de una cinta (ver arriba). Con la pista plana (`flat`) no hay altura que enseñar: vacío.
 * `groundY` es el suelo en three (m); por defecto, el punto más bajo de la cinta menos `GROUND_MARGIN_M`.
 */
export function buildSkirts(path: TrackPath, r: RibbonGeometry, flat: boolean, groundY = lowestY(r) - GROUND_MARGIN_M): SkirtGeometry {
  const empty = { positions: new Float32Array(0), depth: new Float32Array(0), mapCenter: new Float32Array(0), mapNormal: new Float32Array(0), indices: new Uint32Array(0), groundY }
  const n = path.count
  if (flat || n < 2) return empty
  const stride = Math.max(1, Math.ceil(n / MAX_SKIRT_COLUMNS))
  const columns: number[] = []
  for (let i = 0; i < n; i += stride) columns.push(i)
  if (columns[columns.length - 1] !== n - 1) columns.push(n - 1)
  if (path.closed) columns.push(0)
  const positions: number[] = []
  const depth: number[] = []
  const mapCenter: number[] = []
  const mapNormal: number[] = []
  const indices: number[] = []
  for (const side of [0, 1]) {
    const sign = side === 0 ? 1 : -1
    // Por columna, los índices de sus vértices de arriba abajo (cada una con sus filas: el faldón no mide lo mismo en todas).
    const cols: number[][] = []
    for (const i of columns) {
      const cx = r.center[i * 3]!
      const cy = r.center[i * 3 + 1]!
      const cz = r.center[i * 3 + 2]!
      const nx = r.normal[i * 3]! * sign
      const nz = r.normal[i * 3 + 2]! * sign
      const ex = r.positions[i * 6 + side * 3]!
      const ez = r.positions[i * 6 + side * 3 + 2]!
      const full = Math.max(0, cy - groundY)
      const col: number[] = []
      for (const d of skirtRows(full)) {
        col.push(positions.length / 3)
        positions.push(ex, cy - d, ez)
        depth.push(d)
        mapCenter.push(cx, cy, cz)
        mapNormal.push(nx, 0, nz)
      }
      cols.push(col)
    }
    // Entre dos columnas, las tiras de cuadriláteros por profundidad; si una tiene menos filas, se cierra en abanico.
    for (let c = 0; c + 1 < cols.length; c++) {
      const a = cols[c]!
      const b = cols[c + 1]!
      const rows = Math.max(a.length, b.length)
      for (let k = 0; k + 1 < rows; k++) {
        const a0 = a[Math.min(k, a.length - 1)]!
        const a1 = a[Math.min(k + 1, a.length - 1)]!
        const b0 = b[Math.min(k, b.length - 1)]!
        const b1 = b[Math.min(k + 1, b.length - 1)]!
        if (a0 !== a1) indices.push(a0, a1, b0)
        if (b0 !== b1) indices.push(b0, a1, b1)
      }
    }
  }
  return {
    positions: Float32Array.from(positions),
    depth: Float32Array.from(depth),
    mapCenter: Float32Array.from(mapCenter),
    mapNormal: Float32Array.from(mapNormal),
    indices: Uint32Array.from(indices),
    groundY,
  }
}

/** Altura (Y de three) más baja del eje de una cinta. */
export function lowestY(r: RibbonGeometry): number {
  let min = Infinity
  for (let i = 1; i < r.center.length; i += 3) min = Math.min(min, r.center[i]!)
  return Number.isFinite(min) ? min : 0
}

/** Caja en planta (x, z de three) del eje de una cinta: centro y radio del círculo que la contiene. */
export function planCircle(r: RibbonGeometry): { x: number; z: number; radius: number } {
  let x0 = Infinity
  let x1 = -Infinity
  let z0 = Infinity
  let z1 = -Infinity
  for (let i = 0; i < r.center.length; i += 3) {
    x0 = Math.min(x0, r.center[i]!)
    x1 = Math.max(x1, r.center[i]!)
    z0 = Math.min(z0, r.center[i + 2]!)
    z1 = Math.max(z1, r.center[i + 2]!)
  }
  if (!Number.isFinite(x0)) return { x: 0, z: 0, radius: 1 }
  return { x: (x0 + x1) / 2, z: (z0 + z1) / 2, radius: Math.max(1, Math.hypot(x1 - x0, z1 - z0) / 2) }
}
