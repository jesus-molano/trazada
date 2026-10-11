/**
 * Límite del desplazamiento del mapa (D53): el punto al que mira la cámara (el `target` de los controles, en el suelo) no
 * sale de la extensión del circuito más un margen. Si un gesto lo saca, se devuelve al borde moviendo target y cámara
 * con el mismo delta: la vista no gira ni cambia de distancia, solo deja de desplazarse. TS puro, en ejes de three
 * (x, z en planta).
 */

/** Caja en planta (x, z de three) dentro de la que puede estar el target. */
export interface PanBox {
  readonly minX: number
  readonly maxX: number
  readonly minZ: number
  readonly maxZ: number
}

/** Margen alrededor del circuito: esta fracción de su lado mayor… */
export const PAN_MARGIN_FRACTION = 0.25
/** …y nunca menos que esto (m): en un circuito pequeño se puede llegar igual a una curva del borde. */
export const PAN_MARGIN_MIN_M = 200

/** Caja del target para unos puntos del circuito en ejes de three (x, y, z seguidos), con su margen. */
export function panBox(points: ArrayLike<number>, fraction = PAN_MARGIN_FRACTION, minMargin = PAN_MARGIN_MIN_M): PanBox {
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (let i = 0; i + 2 < points.length; i += 3) {
    const x = points[i]!
    const z = points[i + 2]!
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
  }
  if (!(minX <= maxX && minZ <= maxZ)) return { minX: 0, maxX: 0, minZ: 0, maxZ: 0 }
  const margin = Math.max(minMargin, fraction * Math.max(maxX - minX, maxZ - minZ))
  return { minX: minX - margin, maxX: maxX + margin, minZ: minZ - margin, maxZ: maxZ + margin }
}

/** Delta (en x y z) que devuelve el target (x, z) a la caja; (0, 0) si ya está dentro. Escribe en `out`. */
export function clampPan(x: number, z: number, box: PanBox, out: { dx: number; dz: number }): { dx: number; dz: number } {
  out.dx = x < box.minX ? box.minX - x : x > box.maxX ? box.maxX - x : 0
  out.dz = z < box.minZ ? box.minZ - z : z > box.maxZ ? box.maxZ - z : 0
  return out
}
