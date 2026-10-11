/**
 * Cámara de seguimiento (TS puro). Va detrás del coche seleccionado:
 *
 * - El punto de mira es la posición del coche, sin suavizar (su movimiento ya es C1). Suavizarlo lo dejaría
 *   cientos de metros atrás a ×16.
 * - El yaw sigue el rumbo con un muelle críticamente amortiguado, con la aceleración angular acotada
 *   (YAW_MAX_ACCEL) y la velocidad también. Así no hay tirones aunque el coche gire 180° en 0,3 s de
 *   reloj real a ×16.
 * - El pitch es constante.
 *
 * Sistema de three (Y arriba); rumbo canónico h → yaw φ = −h en el plano XZ.
 */
export const YAW_OMEGA = 3 // rad/s (frecuencia natural del muelle)
export const YAW_MAX_ACCEL = 6 // rad/s²: umbral documentado del test de suavidad (H8)
export const YAW_MAX_VEL = 3 // rad/s
export const FOLLOW_DISTANCE_M = 70
/** Zoom del seguimiento (rueda o pellizco): de muy cerca del coche a un poco más lejos que por defecto. */
export const FOLLOW_MIN_DISTANCE_M = 14
export const FOLLOW_MAX_DISTANCE_M = 120
export const FOLLOW_PITCH_DEG = 24
const SUBSTEP_S = 1 / 240

export interface Vec3 {
  x: number
  y: number
  z: number
}

/** Distancia de seguimiento dentro de los límites del zoom (la de por defecto si no es un número). */
export function clampFollowDistance(d: number): number {
  if (!Number.isFinite(d)) return FOLLOW_DISTANCE_M
  return Math.min(FOLLOW_MAX_DISTANCE_M, Math.max(FOLLOW_MIN_DISTANCE_M, d))
}

/**
 * Persecución de la realización automática (ítem 9): la misma cámara, mirando al centro de una pareja (o a un coche)
 * con el rumbo del de detrás. La distancia crece con la separación para que quepan los dos: con el pitch fijo, el de
 * detrás tiene que quedar delante de la cámara al menos ~0,6 veces la separación, o se sale por abajo.
 */
export const CHASE_MIN_DISTANCE_M = 40
export const CHASE_MAX_DISTANCE_M = 180
export const CHASE_LEADER_DISTANCE_M = 55
const CHASE_BASE_M = 30
const CHASE_GAP_K = 1.3

/** Distancia de la persecución de una pareja separada `gapM` metros. */
export function pairChaseDistance(gapM: number): number {
  const g = Number.isFinite(gapM) ? Math.max(0, gapM) : 0
  return Math.min(CHASE_MAX_DISTANCE_M, Math.max(CHASE_MIN_DISTANCE_M, CHASE_BASE_M + CHASE_GAP_K * g))
}

const TAU = Math.PI * 2
const wrap = (a: number) => {
  const r = (a + Math.PI) % TAU
  return (r < 0 ? r + TAU : r) - Math.PI
}

export class FollowCamera {
  yaw = 0
  yawVel = 0
  readonly pitch = (FOLLOW_PITCH_DEG * Math.PI) / 180
  /** Distancia al coche (m); se puede cambiar en cualquier momento (zoom), dentro de los límites. */
  distance: number
  private initialized = false
  readonly target: Vec3 = { x: 0, y: 0, z: 0 }

  constructor(distance = FOLLOW_DISTANCE_M) {
    this.distance = clampFollowDistance(distance)
  }

  reset(): void {
    this.initialized = false
    this.yawVel = 0
  }

  /** Avanza dt segundos de reloj real hacia el coche en `pos` (three) con rumbo canónico `heading`. */
  update(pos: Vec3, heading: number, dt: number): void {
    const goal = -heading
    this.target.x = pos.x
    this.target.y = pos.y
    this.target.z = pos.z
    if (!this.initialized) {
      this.yaw = goal
      this.yawVel = 0
      this.initialized = true
      return
    }
    let remaining = Math.max(0, Math.min(dt, 0.25))
    while (remaining > 1e-9) {
      const h = Math.min(SUBSTEP_S, remaining)
      const err = wrap(goal - this.yaw)
      let acc = YAW_OMEGA * YAW_OMEGA * err - 2 * YAW_OMEGA * this.yawVel
      acc = Math.max(-YAW_MAX_ACCEL, Math.min(YAW_MAX_ACCEL, acc))
      this.yawVel = Math.max(-YAW_MAX_VEL, Math.min(YAW_MAX_VEL, this.yawVel + acc * h))
      this.yaw += this.yawVel * h
      remaining -= h
    }
  }

  /** Posición de la cámara: detrás del coche (según el yaw) y por encima (según el pitch). */
  position(out: Vec3): Vec3 {
    const horiz = this.distance * Math.cos(this.pitch)
    out.x = this.target.x - Math.cos(this.yaw) * horiz
    out.y = this.target.y + this.distance * Math.sin(this.pitch)
    out.z = this.target.z - Math.sin(this.yaw) * horiz
    return out
  }
}
