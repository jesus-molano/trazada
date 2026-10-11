/**
 * Encuadre inicial de la cámara de mapa: todo el trazado visible para cualquier proporción del lienzo,
 * con la vista inclinada y dejando libre la franja inferior que ocupan los controles.
 */
export interface FramingInput {
  /** Radio del trazado en planta (m). */
  radius: number
  /** Altura (three Y) del centro del encuadre. */
  y: number
  fovDeg: number
  aspect: number
  /** Inclinación de la vista sobre la horizontal. */
  tiltDeg: number
  /** Fracción de la altura del lienzo tapada abajo por la interfaz (0–0,5). */
  bottomInset: number
  margin?: number
}

export interface Framing {
  position: [number, number, number]
  target: [number, number, number]
  distance: number
}

export function frameCircuit(f: FramingInput): Framing {
  const margin = f.margin ?? 1.1
  const vHalf = ((f.fovDeg / 2) * Math.PI) / 180
  const hHalf = Math.atan(Math.tan(vHalf) * f.aspect)
  // Solo cuenta la parte visible del lienzo en vertical.
  const visibleV = Math.atan(Math.tan(vHalf) * (1 - f.bottomInset))
  const half = Math.min(hHalf, visibleV)
  const distance = (f.radius * margin) / Math.sin(half)
  const tilt = (f.tiltDeg * Math.PI) / 180
  // Desplaza el punto de mira hacia la cámara para subir el trazado por encima de la franja tapada.
  const shift = distance * Math.tan(vHalf) * f.bottomInset
  const target: [number, number, number] = [0, f.y, shift / Math.sin(tilt)]
  return {
    position: [0, f.y + distance * Math.sin(tilt), target[2] + distance * Math.cos(tilt)],
    target,
    distance,
  }
}

/** Fracciones del lienzo tapadas por la interfaz en cada borde (0–0,85; entre dos opuestos, como mucho 0,9). */
export interface Insets {
  left: number
  right: number
  top: number
  bottom: number
}

export interface FitInput {
  /** Puntos del trazado en ejes de three (x, y, z consecutivos), p. ej. el eje cada ~20 m. */
  points: Float32Array
  /** Altura (three Y) del suelo: el punto de mira queda sobre ella. */
  groundY: number
  fovDeg: number
  aspect: number
  tiltDeg: number
  insets: Insets
  /** Holgura alrededor del trazado (1,08 = un 8 %). */
  margin?: number
}

export interface Fit extends Framing {
  /** Caja del trazado en coordenadas normalizadas de pantalla (−1…1) y hueco libre, para depurar y los e2e. */
  box: { x0: number; x1: number; y0: number; y1: number }
  free: { x0: number; x1: number; y0: number; y1: number }
}

type V3 = [number, number, number]

/**
 * Encuadre ajustado a la forma del trazado (no al círculo que lo envuelve) y al hueco libre entre los paneles:
 * busca la distancia mínima con la que todo el trazado cabe en ese hueco y lo centra en él. La cámara mira
 * con la inclinación dada desde +z, como `frameCircuit`.
 */
export function fitCircuit(f: FitInput): Fit {
  const margin = f.margin ?? 1.08
  const tilt = (f.tiltDeg * Math.PI) / 180
  const tanV = Math.tan((f.fovDeg * Math.PI) / 360)
  const tanH = tanV * f.aspect
  // Base de la cámara: atrás (hacia la cámara), derecha y arriba.
  const back: V3 = [0, Math.sin(tilt), Math.cos(tilt)]
  const right: V3 = [1, 0, 0]
  const up: V3 = [0, Math.cos(tilt), -Math.sin(tilt)]
  const ins = {
    left: clamp(f.insets.left),
    right: clamp(f.insets.right),
    top: clamp(f.insets.top),
    bottom: clamp(f.insets.bottom),
  }
  // Siempre queda al menos un 10 % libre en cada dimensión (si no, el trazado no cabría en ningún sitio).
  for (const [a, b] of [
    ['left', 'right'],
    ['top', 'bottom'],
  ] as const) {
    const sum = ins[a] + ins[b]
    if (sum > 0.9) {
      ins[a] *= 0.9 / sum
      ins[b] *= 0.9 / sum
    }
  }
  const free = { x0: -1 + 2 * ins.left, x1: 1 - 2 * ins.right, y0: -1 + 2 * ins.bottom, y1: 1 - 2 * ins.top }
  const fcx = (free.x0 + free.x1) / 2
  const fcy = (free.y0 + free.y1) / 2
  const fhx = (free.x1 - free.x0) / 2 / margin
  const fhy = (free.y1 - free.y0) / 2 / margin

  const pts = f.points
  const n = pts.length / 3
  // Centro de la caja en planta como primer punto de mira.
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, pts[i * 3]!)
    maxX = Math.max(maxX, pts[i * 3]!)
    minZ = Math.min(minZ, pts[i * 3 + 2]!)
    maxZ = Math.max(maxZ, pts[i * 3 + 2]!)
  }
  let target: V3 = [(minX + maxX) / 2, f.groundY, (minZ + maxZ) / 2]
  const radius = Math.max(1, Math.hypot(maxX - minX, maxZ - minZ) / 2)

  const box = { x0: 0, x1: 0, y0: 0, y1: 0 }
  const project = (cam: V3): boolean => {
    box.x0 = box.y0 = Infinity
    box.x1 = box.y1 = -Infinity
    for (let i = 0; i < n; i++) {
      const vx = pts[i * 3]! - cam[0]
      const vy = pts[i * 3 + 1]! - cam[1]
      const vz = pts[i * 3 + 2]! - cam[2]
      const depth = -(vx * back[0] + vy * back[1] + vz * back[2])
      if (depth <= 1) return false
      const x = (vx * right[0] + vy * right[1] + vz * right[2]) / (depth * tanH)
      const y = (vx * up[0] + vy * up[1] + vz * up[2]) / (depth * tanV)
      box.x0 = Math.min(box.x0, x)
      box.x1 = Math.max(box.x1, x)
      box.y0 = Math.min(box.y0, y)
      box.y1 = Math.max(box.y1, y)
    }
    return true
  }
  const fits = (cam: V3) =>
    project(cam) &&
    box.x0 >= fcx - fhx &&
    box.x1 <= fcx + fhx &&
    box.y0 >= fcy - fhy &&
    box.y1 <= fcy + fhy
  // Cámara a distancia d del punto `aim`, desplazada en su plano para que `aim` caiga en el centro del hueco
  // libre (que puede no contener el centro de la pantalla, p. ej. con los paneles abajo en tablet vertical).
  const cameraAt = (aim: V3, d: number): V3 => {
    const a = fcx * d * tanH
    const b = fcy * d * tanV
    return [
      aim[0] + back[0] * d - right[0] * a - up[0] * b,
      aim[1] + back[1] * d - right[1] * a - up[1] * b,
      aim[2] + back[2] * d - right[2] * a - up[2] * b,
    ]
  }

  let aim = target
  let distance = radius
  for (let iter = 0; iter < 5; iter++) {
    // Distancia mínima que hace caber el trazado (búsqueda binaria; al alejarse, todo converge al centro del hueco).
    let lo = 1
    let hi = radius * 2
    while (!fits(cameraAt(aim, hi)) && hi < radius * 1e4) hi *= 2
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2
      if (fits(cameraAt(aim, mid))) hi = mid
      else lo = mid
    }
    distance = hi
    project(cameraAt(aim, distance))
    // Lo que falte para centrar la caja en el hueco (la perspectiva la descentra un poco): se mueve `aim`.
    const dx = ((box.x0 + box.x1) / 2 - fcx) * distance * tanH
    const dy = ((box.y0 + box.y1) / 2 - fcy) * distance * tanV
    aim = [aim[0] + right[0] * dx + up[0] * dy, aim[1] + right[1] * dx + up[1] * dy, aim[2] + right[2] * dx + up[2] * dy]
  }
  const cam = cameraAt(aim, distance)
  // El punto de mira (para los controles) es donde la línea de visión corta el suelo.
  const k = (cam[1] - f.groundY) / back[1]
  target = [cam[0] - back[0] * k, f.groundY, cam[2] - back[2] * k]
  distance = Math.hypot(cam[0] - target[0], cam[1] - target[1], cam[2] - target[2])
  project(cam)
  return { position: cam, target, distance, box: { ...box }, free }
}

function clamp(v: number): number {
  return Math.min(0.85, Math.max(0, Number.isFinite(v) ? v : 0))
}
