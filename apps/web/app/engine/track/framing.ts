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
