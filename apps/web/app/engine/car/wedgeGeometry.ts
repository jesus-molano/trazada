/**
 * Cuña de lejos (D28): un marcador genérico con el color del equipo que dice dónde está cada coche y hacia
 * dónde mira. Morro estrecho y bajo delante; trasera ancha y alta detrás.
 *
 * Mismo sistema que el monoplaza (three: Y arriba, morro hacia +x, origen en el suelo bajo el centro) y el
 * mismo criterio de sombreado horneado: el techo a 1 (el color del equipo tal cual) y el resto de caras más
 * oscuras, así que de lejos se lee como un objeto con volumen, igual que el coche de cerca. La trasera es la
 * cara más oscura: el rumbo se distingue también cuando el coche se aleja de la cámara. Los laterales caen un
 * poco hacia fuera, pero el techo conserva casi todo el ancho: el color del equipo sigue llenando la cuña.
 */

type V3 = [number, number, number]

/** Cotas (m). Caben en la caja del proxy de selección (5,6 × 1,2 × 2,2). */
export const WEDGE_DIM = {
  length: 5.6,
  /** Ancho detrás: a ras de suelo y en el techo. */
  width: 2.2,
  topWidth: 1.9,
  height: 1,
  /** Semiancho del morro a ras de suelo y altura de su arista superior. */
  noseHalfWidth: 0.3,
  noseHeight: 0.4,
} as const

/**
 * Tono de cada cara (× color del equipo, lineal como los colores por vértice de three): poco, para que el
 * color del equipo siga mandando (es un pulido, no otro marcador). Los dos laterales iguales: un lado más
 * oscuro que el otro haría que unos coches parecieran distintos de otros según hacia dónde van.
 */
export const WEDGE_SHADE = { top: 1, side: 0.78, nose: 0.78, tail: 0.62, bottom: 0.35 } as const
export type WedgeFace = keyof typeof WEDGE_SHADE

export interface WedgeGeometry {
  /** Triángulos sueltos (sin índice), cada uno con su sombreado. */
  positions: Float32Array
  /** Sombreado horneado por vértice (1 en el techo). */
  shade: Float32Array
  /** Cara a la que pertenece cada triángulo (para los tests). */
  faces: WedgeFace[]
  triangles: number
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

export function buildWedge(): WedgeGeometry {
  const { length: L, width: W, topWidth: T, height: H, noseHalfWidth: nw, noseHeight: nh } = WEDGE_DIM
  const n0: V3 = [L / 2, 0, -nw]
  const n1: V3 = [L / 2, 0, nw]
  const nt: V3 = [L / 2, nh, 0]
  const r0: V3 = [-L / 2, 0, -W / 2]
  const r1: V3 = [-L / 2, 0, W / 2]
  const u0: V3 = [-L / 2, H, -T / 2]
  const u1: V3 = [-L / 2, H, T / 2]
  // Caras (triángulos o cuadriláteros partidos en dos), cada una con un solo tono.
  const faces: [WedgeFace, V3[]][] = [
    ['nose', [n0, n1, nt]],
    ['top', [nt, u0, u1]],
    ['tail', [r0, r1, u1, u0]],
    ['bottom', [n0, n1, r1, r0]],
    ['side', [n1, nt, u1, r1]],
    ['side', [n0, nt, u0, r0]],
  ]

  // Un punto interior para orientar los triángulos hacia fuera (se dibujan solo por delante).
  const inside: V3 = [0, H * 0.3, 0]
  const pos: number[] = []
  const shade: number[] = []
  const kinds: WedgeFace[] = []
  for (const [kind, f] of faces) {
    const tris = f.length === 3 ? [[f[0]!, f[1]!, f[2]!]] : [[f[0]!, f[1]!, f[2]!], [f[0]!, f[2]!, f[3]!]]
    for (const [a, b, c] of tris as [V3, V3, V3][]) {
      const mid: V3 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3]
      const out = dot(cross(sub(b, a), sub(c, a)), sub(mid, inside)) >= 0
      pos.push(...a, ...(out ? b : c), ...(out ? c : b))
      shade.push(WEDGE_SHADE[kind], WEDGE_SHADE[kind], WEDGE_SHADE[kind])
      kinds.push(kind)
    }
  }
  return { positions: new Float32Array(pos), shade: new Float32Array(shade), faces: kinds, triangles: kinds.length }
}
