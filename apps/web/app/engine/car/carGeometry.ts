/**
 * Monoplaza genérico generado por código (D28): sin modelos de terceros ni rasgos de ningún coche real. Un
 * solo color de equipo en la carrocería y piezas neutras; casco gris, sin dorsales, logos ni texto.
 *
 * Sistema de three (Y arriba), morro hacia +x, origen en el suelo bajo el centro del coche. TS puro: la
 * escena convierte cada capa en una geometría de three. Las caras llevan un sombreado horneado que solo
 * depende de su normal en el sistema del coche (el coche solo gira sobre Y, así que vale en cualquier rumbo).
 */

type V3 = [number, number, number]

/** Cotas (m): batalla de 3,40 m, 1,90 m de ancho, ruedas de Ø 0,71 m y llanta de 18". */
export const CAR_DIM = {
  noseX: 2.62,
  tailX: -2.64,
  frontAxleX: 1.6,
  rearAxleX: -1.8,
  tyreR: 0.355,
  rimR: 0.229,
  frontTyreW: 0.28,
  rearTyreW: 0.375,
  frontTrackHalf: 0.79,
  rearTrackHalf: 0.7625,
  height: 0.96,
} as const

/** Clases de material. `paint` lleva el color del equipo; `band`, el del compuesto; el resto, un token. */
export const CAR_PARTS = ['paint', 'band', 'carbon', 'dark', 'tyre', 'rim', 'halo', 'helmet'] as const
export type CarPart = (typeof CAR_PARTS)[number]

/** Capas (una malla instanciada cada una): carrocería pintada, banda del compuesto y piezas neutras. */
export type CarLayer = 'paint' | 'band' | 'neutral'
const layerOf = (part: CarPart): CarLayer => (part === 'paint' ? 'paint' : part === 'band' ? 'band' : 'neutral')

export interface CarLayerGeometry {
  /** Triángulos sueltos (sin índice): cada cara con su sombreado. */
  positions: Float32Array
  /** Sombreado horneado por vértice (0,35–1; 1 en las caras de arriba: ahí se ve el color tal cual). */
  shade: Float32Array
  /** Clase de material por vértice (índice en CAR_PARTS). */
  part: Uint8Array
}

export interface CarGeometry {
  layers: Record<CarLayer, CarLayerGeometry>
  triangles: number
  /** Triángulos por pieza (chasis, alerones, ruedas…), para los tests y la depuración. */
  pieces: Record<string, number>
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const avg = (pts: V3[]): V3 => {
  const o: V3 = [0, 0, 0]
  for (const p of pts) for (let k = 0; k < 3; k++) o[k]! += p[k]! / pts.length
  return o
}
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}

/**
 * Sombreado horneado de una cara según su normal: «luz» de arriba (n.y) y un leve término frontal y lateral
 * para separar caras. Las caras de arriba quedan a 1 (el color del token o del equipo tal cual).
 */
export function faceShade(n: V3): number {
  const u = norm(n)
  const s = 0.5 + 0.5 * (0.55 + 0.45 * u[1]) + 0.08 * u[0] + 0.04 * u[2]
  return Math.max(0.35, Math.min(1, s))
}

class Builder {
  readonly out: Record<CarLayer, { pos: number[]; shade: number[]; part: number[] }> = {
    paint: { pos: [], shade: [], part: [] },
    band: { pos: [], shade: [], part: [] },
    neutral: { pos: [], shade: [], part: [] },
  }
  readonly pieces: Record<string, number> = {}

  /** Triángulo orientado hacia fuera respecto de `ref` (un punto interior de la pieza). */
  tri(a: V3, b: V3, c: V3, part: CarPart, piece: string, ref?: V3): void {
    let n = cross(sub(b, a), sub(c, a))
    if (Math.hypot(n[0], n[1], n[2]) < 1e-12) return // degenerado
    if (ref && dot(n, sub(avg([a, b, c]), ref)) < 0) {
      ;[b, c] = [c, b]
      n = [-n[0], -n[1], -n[2]]
    }
    const o = this.out[layerOf(part)]
    o.pos.push(...a, ...b, ...c)
    const s = faceShade(n)
    const p = CAR_PARTS.indexOf(part)
    o.shade.push(s, s, s)
    o.part.push(p, p, p)
    this.pieces[piece] = (this.pieces[piece] ?? 0) + 1
  }

  quad(a: V3, b: V3, c: V3, d: V3, part: CarPart, piece: string, ref?: V3): void {
    this.tri(a, b, c, part, piece, ref)
    this.tri(a, c, d, part, piece, ref)
  }

  /** Loft entre anillos (convexos) con el mismo número de puntos, con tapas en abanico. */
  loft(
    rings: V3[][],
    part: CarPart,
    piece: string,
    opts: { capStart?: CarPart; capEnd?: CarPart; partOf?: (ring: number, j: number) => CarPart } = {},
  ): void {
    const cents = rings.map(avg)
    for (let i = 0; i < rings.length - 1; i++) {
      const A = rings[i]!
      const B = rings[i + 1]!
      const ref = avg([cents[i]!, cents[i + 1]!])
      for (let j = 0; j < A.length; j++) {
        const j2 = (j + 1) % A.length
        this.quad(A[j]!, A[j2]!, B[j2]!, B[j]!, opts.partOf?.(i, j) ?? part, piece, ref)
      }
    }
    const fan = (ring: V3[], ref: V3, p: CarPart) => {
      for (let j = 1; j < ring.length - 1; j++) this.tri(ring[0]!, ring[j]!, ring[j + 1]!, p, piece, ref)
    }
    const L = rings.length
    fan(rings[0]!, cents[1] ?? cents[0]!, opts.capStart ?? part)
    fan(rings[L - 1]!, cents[L - 2] ?? cents[L - 1]!, opts.capEnd ?? part)
  }

  box([x0, y0, z0]: V3, [x1, y1, z1]: V3, part: CarPart, piece: string): void {
    const r = (x: number): V3[] => [
      [x, y0, z0],
      [x, y0, z1],
      [x, y1, z1],
      [x, y1, z0],
    ]
    this.loft([r(x0), r(x1)], part, piece)
  }

  /** Perfil de ala (cuadrilátero fino en XY) extruido a lo largo de Z. */
  wing(w: { xLE: number; yLE: number; xTE: number; yTE: number; t: number; z0: number; z1: number }, part: CarPart, piece: string): void {
    const sec = (z: number): V3[] => [
      [w.xLE, w.yLE, z],
      [w.xTE, w.yTE + w.t, z],
      [w.xTE, w.yTE, z],
      [w.xLE, w.yLE - w.t, z],
    ]
    this.loft([sec(w.z0), sec(w.z1)], part, piece)
  }

  /** Placa vertical (deriva) en el plano XY a la altura z, de grosor t. */
  plate(pts: [number, number][], z: number, t: number, part: CarPart, piece: string): void {
    const ring = (zz: number): V3[] => pts.map(([x, y]) => [x, y, zz])
    this.loft([ring(z - t / 2), ring(z + t / 2)], part, piece)
  }

  /** Brazo de suspensión: prisma triangular fino. */
  arm(a: V3, b: V3, c: V3, t: number, part: CarPart, piece: string): void {
    const r = (dy: number): V3[] => [a, b, c].map((p): V3 => [p[0], p[1] + dy, p[2]])
    this.loft([r(-t / 2), r(t / 2)], part, piece)
  }

  /** Tubo de sección poligonal a lo largo de una polilínea (sin tapas). */
  tube(path: V3[], radius: number, segs: number, part: CarPart, piece: string): void {
    const rings = path.map((p, i) => {
      const t = norm(sub(path[Math.min(path.length - 1, i + 1)]!, path[Math.max(0, i - 1)]!))
      const up: V3 = Math.abs(t[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]
      const nrm = norm(cross(t, up))
      const bin = cross(nrm, t)
      return Array.from({ length: segs }, (_, k): V3 => {
        const a = (k / segs) * Math.PI * 2 + Math.PI / segs
        return [0, 1, 2].map((d) => p[d]! + radius * (Math.cos(a) * nrm[d]! + Math.sin(a) * bin[d]!)) as V3
      })
    })
    for (let i = 0; i < rings.length - 1; i++) {
      const ref = avg([path[i]!, path[i + 1]!])
      for (let j = 0; j < segs; j++) {
        const j2 = (j + 1) % segs
        this.quad(rings[i]![j]!, rings[i]![j2]!, rings[i + 1]![j2]!, rings[i + 1]![j]!, part, piece, ref)
      }
    }
  }

  /**
   * Rueda por revolución alrededor del eje Z, con la cara exterior hacia `side` (±1): neumático con el color
   * del compuesto en el hombro exterior y en un anillo del flanco, y llanta hundida.
   */
  wheel(center: V3, width: number, side: number, segs: number, piece: string): void {
    const { tyreR: R, rimR } = CAR_DIM
    const h = width / 2
    const prof: [number, number, CarPart][] = [
      [rimR, -h, 'tyre'],
      [R - 0.012, -h, 'tyre'],
      [R, -h + 0.03, 'tyre'],
      // Color del compuesto en el borde exterior de la banda de rodadura, el hombro y el flanco: se ve desde
      // detrás y desde arriba (las cámaras de la app) y de lado.
      [R, h - 0.08, 'band'],
      [R, h - 0.03, 'band'],
      [R - 0.012, h, 'band'],
      [R - 0.07, h, 'tyre'],
      [rimR, h, 'rim'],
      [rimR - 0.02, h - 0.06, 'rim'],
    ]
    const P = (r: number, z: number, k: number): V3 => {
      const a = (k / segs) * Math.PI * 2
      return [center[0] + r * Math.cos(a), center[1] + r * Math.sin(a), center[2] + side * z]
    }
    for (let i = 0; i < prof.length - 1; i++) {
      const [r0, z0, part] = prof[i]!
      const [r1, z1] = prof[i + 1]!
      const flat = Math.abs(z1 - z0) < 1e-9
      const dish = i === prof.length - 2
      for (let k = 0; k < segs; k++) {
        // Punto interior: dentro del neumático (caras planas), detrás de la pared de la llanta (fondo) o en el eje.
        const ref = flat
          ? P((r0 + r1) / 2, z0 - Math.sign(z0) * 0.05, k + 0.5)
          : dish
            ? P(rimR + 0.05, h - 0.1, k + 0.5)
            : ([center[0], center[1], center[2] + side * ((z0 + z1) / 2)] as V3)
        this.quad(P(r0, z0, k), P(r0, z0, k + 1), P(r1, z1, k + 1), P(r1, z1, k), part, piece, ref)
      }
    }
    // Fondo de la llanta exterior y disco interior.
    const [lr, lz] = prof[prof.length - 1]!
    const outer = Array.from({ length: segs }, (_, k) => P(lr, lz, k))
    const inner = Array.from({ length: segs }, (_, k) => P(rimR, -h, k))
    for (let k = 1; k < segs - 1; k++) {
      this.tri(outer[0]!, outer[k]!, outer[k + 1]!, 'rim', piece, [center[0], center[1], center[2] - side])
      this.tri(inner[0]!, inner[k]!, inner[k + 1]!, 'rim', piece, [center[0], center[1], center[2] + side])
    }
  }
}

/** Sección «rectángulo achaflanado» (8 puntos) a la altura x, simétrica en z. */
function rr(x: number, w: number, y0: number, y1: number, c = Math.min(0.06, w * 0.4, (y1 - y0) * 0.3)): V3[] {
  return [
    [x, y0 + c, w],
    [x, y1 - c, w],
    [x, y1, w - c],
    [x, y1, -(w - c)],
    [x, y1 - c, -w],
    [x, y0 + c, -w],
    [x, y0, -(w - c)],
    [x, y0, w - c],
  ]
}

export function buildCar({ wheelSegments = 12 }: { wheelSegments?: number } = {}): CarGeometry {
  const b = new Builder()
  const D = CAR_DIM

  // Morro, monocasco y caja de cambios: un loft continuo; la apertura del cockpit, en oscuro.
  b.loft(
    [
      rr(2.58, 0.06, 0.17, 0.25, 0.02),
      rr(2.2, 0.11, 0.15, 0.35),
      rr(1.65, 0.18, 0.13, 0.5),
      rr(1.05, 0.25, 0.1, 0.6),
      rr(0.6, 0.29, 0.08, 0.66),
      rr(-0.3, 0.3, 0.08, 0.66),
      rr(-0.7, 0.29, 0.08, 0.6),
      rr(-1.35, 0.21, 0.09, 0.44),
      rr(-1.95, 0.12, 0.13, 0.33),
      rr(-2.22, 0.07, 0.17, 0.27, 0.02),
    ],
    'paint',
    'chassis',
    { partOf: (i, j) => (i === 4 && j === 2 ? 'dark' : 'paint') },
  )

  // Tapa motor con toma de aire (oscura) sobre el piloto.
  b.loft(
    [rr(-0.22, 0.14, 0.62, 0.93, 0.05), rr(-0.55, 0.22, 0.45, 0.92), rr(-1.1, 0.2, 0.32, 0.72), rr(-1.7, 0.11, 0.25, 0.48), rr(-2.08, 0.05, 0.22, 0.36, 0.015)],
    'paint',
    'engineCover',
    { capStart: 'dark' },
  )

  // Pontones: toma delantera oscura y caída hacia atrás.
  for (const s of [1, -1]) {
    const sec = (x: number, zIn: number, zOut: number, y0: number, y1: number): V3[] => {
      const c = Math.min(0.08, (y1 - y0) * 0.3, (zOut - zIn) * 0.4)
      return [
        [x, y0, s * zIn],
        [x, y0, s * zOut],
        [x, y1 - c, s * zOut],
        [x, y1, s * (zOut - c)],
        [x, y1, s * zIn],
      ]
    }
    b.loft(
      [sec(0.5, 0.26, 0.64, 0.12, 0.54), sec(0.2, 0.26, 0.69, 0.09, 0.57), sec(-0.55, 0.25, 0.63, 0.08, 0.48), sec(-1.15, 0.2, 0.43, 0.08, 0.32), sec(-1.55, 0.13, 0.24, 0.1, 0.22)],
      'paint',
      'sidepods',
      { capStart: 'dark' },
    )
  }

  // Fondo plano con difusor que sube detrás.
  const floor = (x: number, half: number, y0: number, t = 0.025): V3[] => [
    [x, y0, half],
    [x, y0 + t, half],
    [x, y0 + t, -half],
    [x, y0, -half],
  ]
  b.loft([floor(1.0, 0.3, 0.04), floor(0.65, 0.72, 0.035), floor(-1.3, 0.72, 0.035), floor(-1.45, 0.55, 0.035), floor(-1.6, 0.52, 0.04), floor(-2.08, 0.5, 0.2)], 'carbon', 'floor')

  // Alerón delantero: plano principal, flap pintado y derivas.
  b.wing({ xLE: 2.62, yLE: 0.09, xTE: 2.28, yTE: 0.1, t: 0.025, z0: -0.82, z1: 0.82 }, 'carbon', 'frontWing')
  b.wing({ xLE: 2.3, yLE: 0.13, xTE: 2.08, yTE: 0.22, t: 0.02, z0: -0.8, z1: 0.8 }, 'paint', 'frontWing')
  for (const s of [1, -1])
    b.plate(
      [
        [2.6, 0.05],
        [2.62, 0.2],
        [2.1, 0.3],
        [2.05, 0.05],
      ],
      s * 0.83,
      0.02,
      'carbon',
      'frontWing',
    )

  // Alerón trasero: plano, flap (pieza aparte), derivas pintadas y pilono.
  b.wing({ xLE: -2.14, yLE: 0.7, xTE: -2.42, yTE: 0.73, t: 0.03, z0: -0.5, z1: 0.5 }, 'carbon', 'rearWing')
  b.wing({ xLE: -2.4, yLE: 0.8, xTE: -2.62, yTE: 0.92, t: 0.022, z0: -0.5, z1: 0.5 }, 'carbon', 'rearFlap')
  for (const s of [1, -1])
    b.plate(
      [
        [-2.08, 0.38],
        [-2.12, 0.92],
        [-2.64, 0.96],
        [-2.64, 0.4],
      ],
      s * 0.51,
      0.02,
      'paint',
      'rearWing',
    )
  b.box([-2.32, 0.27, -0.015], [-2.12, 0.72, 0.015], 'carbon', 'rearWing')

  // Halo: pilar central y aro alrededor del cockpit.
  b.tube(
    [
      [0.8, 0.62, 0],
      [0.72, 0.76, 0],
      [0.6, 0.85, 0],
    ],
    0.03,
    4,
    'halo',
    'halo',
  )
  for (const s of [1, -1])
    b.tube(
      [
        [0.6, 0.85, 0],
        [0.5, 0.855, s * 0.15],
        [0.32, 0.845, s * 0.245],
        [0.1, 0.825, s * 0.27],
        [-0.08, 0.79, s * 0.26],
        [-0.2, 0.66, s * 0.27],
      ],
      0.03,
      4,
      'halo',
      'halo',
    )

  // Casco gris neutro (nunca el diseño de un piloto), medio hundido en el cockpit.
  const hc: V3 = [0.05, 0.7, 0]
  const H: V3[] = [
    [hc[0] + 0.15, hc[1], hc[2]],
    [hc[0] - 0.15, hc[1], hc[2]],
    [hc[0], hc[1] + 0.13, hc[2]],
    [hc[0], hc[1] - 0.13, hc[2]],
    [hc[0], hc[1], hc[2] + 0.12],
    [hc[0], hc[1], hc[2] - 0.12],
  ]
  for (const [a, c] of [
    [0, 4],
    [4, 1],
    [1, 5],
    [5, 0],
  ] as const)
    b.tri(H[a]!, H[c]!, H[2]!, 'helmet', 'helmet', hc)

  // Retrovisores.
  for (const s of [1, -1]) b.box([0.42, 0.66, s * 0.36 - 0.06], [0.5, 0.72, s * 0.36 + 0.06], 'carbon', 'mirrors')

  // Suspensión: dos trapecios por rueda, del chasis al buje.
  const susp = (ax: number, hubZ: number, yLo: number, yHi: number, chZ: number) => {
    for (const s of [1, -1]) {
      b.arm([ax + 0.22, yHi + 0.06, s * chZ], [ax - 0.2, yHi + 0.03, s * chZ], [ax, yHi, s * (hubZ - 0.08)], 0.02, 'carbon', 'suspension')
      b.arm([ax + 0.25, yLo, s * chZ], [ax - 0.25, yLo, s * chZ], [ax, yLo, s * (hubZ - 0.08)], 0.02, 'carbon', 'suspension')
    }
  }
  susp(D.frontAxleX, D.frontTrackHalf - D.frontTyreW / 2, 0.22, 0.45, 0.16)
  susp(D.rearAxleX, D.rearTrackHalf - D.rearTyreW / 2, 0.2, 0.4, 0.13)

  // Ruedas (fijas: a velocidad de carrera el giro no se apreciaría y la dirección no es un dato que tengamos).
  for (const s of [1, -1]) {
    b.wheel([D.frontAxleX, D.tyreR, s * D.frontTrackHalf], D.frontTyreW, s, wheelSegments, 'wheels')
    b.wheel([D.rearAxleX, D.tyreR, s * D.rearTrackHalf], D.rearTyreW, s, wheelSegments, 'wheels')
  }

  const layers = {} as Record<CarLayer, CarLayerGeometry>
  let triangles = 0
  for (const [k, o] of Object.entries(b.out) as [CarLayer, Builder['out'][CarLayer]][]) {
    layers[k] = { positions: Float32Array.from(o.pos), shade: Float32Array.from(o.shade), part: Uint8Array.from(o.part) }
    triangles += o.shade.length / 3
  }
  return { layers, triangles, pieces: { ...b.pieces } }
}
