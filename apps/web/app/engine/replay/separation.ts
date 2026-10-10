/**
 * Separación lateral **solo visual** para coches que se solapan en pista (no hay dato lateral real: el
 * coche va sobre la línea central). Opcional y apagada por defecto; con ella se muestra "Estimado".
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
