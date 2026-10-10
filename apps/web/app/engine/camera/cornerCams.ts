/**
 * Cámaras fijas junto a la pista para la realización automática (ítem 9, D39). TS puro, sin Vue ni three.
 *
 * - Con curvas numeradas (MultiViewer), en esas curvas; sin ellas (el fixture, circuitos sin MultiViewer), en los
 *   picos de curvatura de la línea central.
 * - Solo curvas de verdad: un giro de al menos MIN_TURN_DEG entre TURN_WINDOW_M antes y TURN_WINDOW_M después.
 *   Primero las más cerradas, a no menos de MIN_SPACING_M una de otra y como mucho MAX_CAMS.
 * - Por fuera de la curva (el centro de giro queda al otro lado, como las etiquetas de curva de la escena), a
 *   CAM_OFFSET_M de la línea central y CAM_HEIGHT_M por encima de ella. Una cámara que caería encima de otro tramo de
 *   la pista (a menos de MIN_CLEARANCE_M de la línea central) no se pone.
 *
 * Dónde va una cámara no es un dato: es una decisión de realización, y nada de lo que se muestra sale de aquí.
 */
import type { CornerMarker } from '../track/circuit'
import { newSample, type PathSample, type TrackPath } from '../track/TrackPath'

export const CAM_OFFSET_M = 45
export const CAM_HEIGHT_M = 14
export const TURN_WINDOW_M = 40
export const MIN_TURN_DEG = 35
export const MIN_SPACING_M = 500
export const MAX_CAMS = 10
export const MIN_CLEARANCE_M = 30
/** Paso del muestreo de la curvatura (m). */
const CURVATURE_STEP_M = 10
/** Paso con el que se suma el giro (m). */
const TURN_STEP_M = 5

export interface CornerCam {
  /** s del vértice sobre la línea central, en [0, longitud). */
  s: number
  /** Etiqueta de la curva (MultiViewer), o null si sale de la curvatura. */
  label: string | null
  /** +1 si la curva gira a la izquierda, −1 a la derecha. */
  turn: 1 | -1
  /** Giro (rad, sin signo) entre TURN_WINDOW_M antes y después del vértice. */
  angle: number
  /** Cámara: posición canónica en planta (m) y altitud del suelo bajo ella (la del vértice, sin la altura de la cámara). */
  x: number
  y: number
  z: number
  /** Vértice: punto de la línea central en s (con reduced motion, la cámara mira siempre aquí). */
  apexX: number
  apexY: number
  apexZ: number
}

export interface CornerCamOptions {
  maxCams?: number
  minSpacingM?: number
  minTurnDeg?: number
  minClearanceM?: number
}

const TAU = Math.PI * 2
const wrapAngle = (a: number) => {
  const r = (a + Math.PI) % TAU
  return (r < 0 ? r + TAU : r) - Math.PI
}

/**
 * Giro con signo (rad, + a la izquierda) de la línea central entre s − window y s + window. Se suma a pasos cortos
 * (TURN_STEP_M): una horquilla gira 180° o más, y la diferencia directa de rumbos no distingue izquierda de derecha.
 */
export function turnAt(path: TrackPath, s: number, window = TURN_WINDOW_M, scratch: PathSample = newSample()): number {
  const steps = Math.max(2, Math.ceil((2 * window) / TURN_STEP_M))
  const ds = (2 * window) / steps
  path.sample(s - window, scratch)
  let prev = Math.atan2(scratch.ty, scratch.tx)
  let total = 0
  for (let i = 1; i <= steps; i++) {
    path.sample(s - window + i * ds, scratch)
    const h = Math.atan2(scratch.ty, scratch.tx)
    total += wrapAngle(h - prev)
    prev = h
  }
  return total
}

/** Distancia a lo largo de una pista cerrada de longitud L entre a y b (la más corta de las dos). */
export function loopDistance(a: number, b: number, L: number): number {
  const d = (((a - b) % L) + L) % L
  return Math.min(d, L - d)
}

interface Candidate {
  s: number
  label: string | null
  turn: number
}

/** Picos de |giro| a lo largo de la línea central (sin curvas numeradas). */
function curvaturePeaks(path: TrackPath, minTurn: number): Candidate[] {
  const L = path.length
  const n = Math.max(3, Math.floor(L / CURVATURE_STEP_M))
  const step = L / n
  const scratch = newSample()
  const turns = new Float64Array(n)
  for (let i = 0; i < n; i++) turns[i] = turnAt(path, i * step, TURN_WINDOW_M, scratch)
  const radius = Math.max(1, Math.round(TURN_WINDOW_M / step))
  const out: Candidate[] = []
  for (let i = 0; i < n; i++) {
    const a = Math.abs(turns[i]!)
    if (a < minTurn) continue
    let peak = true
    for (let k = -radius; k <= radius && peak; k++) {
      if (k === 0) continue
      const b = Math.abs(turns[(i + k + n) % n]!)
      // A igualdad, gana el primero (una meseta da un solo pico).
      peak = k < 0 ? a > b : a >= b
    }
    if (peak) out.push({ s: i * step, label: null, turn: turns[i]! })
  }
  return out
}

/**
 * Cámaras de curva de un circuito, ordenadas por s. Sin línea central cerrada, ninguna. `corners` vacío → por la
 * curvatura de la línea central.
 */
export function cornerCams(
  circuit: { centerline: TrackPath; corners: readonly CornerMarker[] },
  options: CornerCamOptions = {},
): CornerCam[] {
  const path = circuit.centerline
  if (!path.closed || !(path.length > 0)) return []
  const maxCams = options.maxCams ?? MAX_CAMS
  const minSpacing = options.minSpacingM ?? MIN_SPACING_M
  const minTurn = ((options.minTurnDeg ?? MIN_TURN_DEG) * Math.PI) / 180
  const minClearance = options.minClearanceM ?? MIN_CLEARANCE_M
  const L = path.length
  const scratch = newSample()

  const candidates: Candidate[] =
    circuit.corners.length > 0
      ? circuit.corners
          .map((c) => ({ s: path.wrap(c.s), label: c.label, turn: turnAt(path, c.s, TURN_WINDOW_M, scratch) }))
          .filter((c) => Math.abs(c.turn) >= minTurn)
      : curvaturePeaks(path, minTurn)
  // Las más cerradas primero; a igualdad, por s (determinista).
  candidates.sort((a, b) => Math.abs(b.turn) - Math.abs(a.turn) || a.s - b.s)

  // Vértices de la línea central para comprobar que la cámara no cae encima de otro tramo.
  const vx = new Float64Array(path.count)
  const vy = new Float64Array(path.count)
  const v = { x: 0, y: 0, z: 0 }
  for (let i = 0; i < path.count; i++) {
    path.vertex(i, v)
    vx[i] = v.x
    vy[i] = v.y
  }
  const clear = (x: number, y: number) => {
    for (let i = 0; i < vx.length; i++) if (Math.hypot(vx[i]! - x, vy[i]! - y) < minClearance) return false
    return true
  }

  const chosen: CornerCam[] = []
  for (const c of candidates) {
    if (chosen.length >= maxCams) break
    if (chosen.some((k) => loopDistance(k.s, c.s, L) < minSpacing)) continue
    const apex = path.sample(c.s, scratch)
    const turn: 1 | -1 = c.turn > 0 ? 1 : -1
    // Normal izquierda = (−ty, tx); por fuera de una curva a la izquierda es la derecha, y al revés.
    const nx = -apex.ty * -turn
    const ny = apex.tx * -turn
    const x = apex.x + nx * CAM_OFFSET_M
    const y = apex.y + ny * CAM_OFFSET_M
    if (!clear(x, y)) continue
    chosen.push({
      s: c.s,
      label: c.label,
      turn,
      angle: Math.abs(c.turn),
      x,
      y,
      z: apex.z,
      apexX: apex.x,
      apexY: apex.y,
      apexZ: apex.z,
    })
  }
  return chosen.sort((a, b) => a.s - b.s)
}
