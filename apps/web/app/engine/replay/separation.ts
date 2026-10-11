/**
 * Separación lateral **solo visual** para coches que se solapan en pista (no hay dato lateral real: el
 * coche va sobre la línea central). Activada por defecto desde D54 (se puede apagar); con ella se muestra "Estimado".
 *
 * El hueco de cada coche (`lateralOffsets`, el objetivo) cambia de golpe cuando un grupo se forma o se deshace; lo que
 * se dibuja lo sigue amortiguado en tiempo real (`smoothOffsets`, constante LANE_TAU_MS) para que el coche cambie de
 * carril sin saltar. Tras un salto en el tiempo, el runtime coloca cada coche directamente en su hueco.
 */
import type { CarState } from './ReplayModel'

/** Coches a menos de esta distancia a lo largo de la pista forman un grupo. */
export const GROUP_GAP_M = 10
/** Separación entre coches de un grupo, limitada para no salir de la pista. */
export const SLOT_M = 2.4
const MAX_SPREAD_M = 10

/**
 * Desplazamiento lateral (m, + a la izquierda) de cada coche, en el orden de `states`. Solo los coches
 * visibles en pista (no en el pit lane ni en transición) se separan; el resto queda a 0.
 */
export function lateralOffsets(states: readonly CarState[], trackLength: number, out: Float32Array): number {
  out.fill(0)
  const idx: number[] = []
  const pos: number[] = []
  states.forEach((st, i) => {
    if (!st.visible || st.inPit || st.transition) return
    idx.push(i)
    pos.push(((st.s % trackLength) + trackLength) % trackLength)
  })
  const n = idx.length
  if (n < 2) return 0
  const order = Array.from({ length: n }, (_, k) => k).sort((a, b) => pos[a]! - pos[b]!)
  // Arranque del recorrido circular en el mayor hueco: así un grupo que cruza s = 0 no se parte.
  let start = 0
  let widest = -1
  for (let k = 0; k < n; k++) {
    const a = pos[order[k]!]!
    const b = pos[order[(k + 1) % n]!]! + (k + 1 === n ? trackLength : 0)
    if (b - a > widest) {
      widest = b - a
      start = (k + 1) % n
    }
  }
  let moved = 0
  let group: number[] = []
  const flush = () => {
    if (group.length > 1) {
      const slot = Math.min(SLOT_M, MAX_SPREAD_M / (group.length - 1))
      group.forEach((k, j) => (out[idx[k]!] = (j - (group.length - 1) / 2) * slot))
      moved += group.length
    }
    group = []
  }
  for (let m = 0; m < n; m++) {
    const k = order[(start + m) % n]!
    if (group.length) {
      const prev = group[group.length - 1]!
      const gap = (pos[k]! - pos[prev]! + trackLength) % trackLength
      if (gap >= GROUP_GAP_M) flush()
    }
    group.push(k)
  }
  flush()
  return moved
}

/** Constante de tiempo del cambio de carril (ms de tiempo real): a los ~3τ el coche ya está en su hueco. */
export const LANE_TAU_MS = 220
/** Por debajo de esto (m), el coche ya está en su hueco. */
const LANE_EPS_M = 0.005

/**
 * Lleva `current` hacia `goal` (en sitio, sin reservar memoria) tras `dtMs` de tiempo real, con un amortiguamiento de
 * primer orden. Devuelve si algún coche sigue moviéndose (para pedir más frames aunque el reloj esté en pausa).
 */
export function smoothOffsets(current: Float32Array, goal: Float32Array, dtMs: number, tauMs = LANE_TAU_MS): boolean {
  const k = dtMs > 0 ? 1 - Math.exp(-dtMs / tauMs) : 0
  let moving = false
  for (let i = 0; i < current.length; i++) {
    const d = goal[i]! - current[i]!
    if (Math.abs(d) <= LANE_EPS_M) {
      current[i] = goal[i]!
      continue
    }
    current[i] = current[i]! + d * k
    moving = true
  }
  return moving
}

/**
 * Desplazamiento lateral de los coches para dibujar (D54): el hueco de cada uno (`goal`, de `lateralOffsets`) y lo que se
 * dibuja (`current`), que lo sigue amortiguado. `snap()` (tras un salto en el tiempo) hace que el próximo `update` los
 * coloque directamente; un coche que no se ve tampoco se mueve de lado (al volver, sale ya en su hueco). Sin memoria
 * nueva por frame.
 */
export class LaneOffsets {
  readonly current: Float32Array
  readonly goal: Float32Array
  /** Coches desplazados en el último `update` (en su hueco, no en lo dibujado). */
  separated = 0
  /** Algún coche sigue cambiando de carril (hacen falta más frames). */
  moving = false
  private snapNext = true

  constructor(cars: number) {
    this.current = new Float32Array(cars)
    this.goal = new Float32Array(cars)
  }

  /** El próximo `update` coloca cada coche en su hueco, sin barrer la pista. */
  snap(): void {
    this.snapNext = true
  }

  /** Huecos del instante (con la separación encendida; si no, 0) y paso del amortiguamiento de `dtMs` de tiempo real. */
  update(states: readonly CarState[], trackLength: number, on: boolean, dtMs: number): void {
    if (on) this.separated = lateralOffsets(states, trackLength, this.goal)
    else {
      this.goal.fill(0)
      this.separated = 0
    }
    if (this.snapNext) {
      this.current.set(this.goal)
      this.snapNext = false
      this.moving = false
      return
    }
    for (let i = 0; i < this.current.length; i++) if (!states[i]?.visible) this.current[i] = this.goal[i]!
    this.moving = smoothOffsets(this.current, this.goal, dtMs)
  }
}
