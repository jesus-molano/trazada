/**
 * Polilínea parametrizada por longitud de arco (línea central o pit lane), en coordenadas canónicas
 * del circuito: metros, x/y del mapa oficial y z = altitud relativa. Muestreo O(1) amortizado.
 *
 * La longitud de arco es **en planta (2D)**, igual que en el pipeline: así la `s` de los datos y la de
 * la geometría coinciden metro a metro. La z se interpola sin afectar a s.
 */
export interface PathSample {
  x: number
  y: number
  z: number
  /** Tangente unitaria en el plano XY. */
  tx: number
  ty: number
}

type Coords = ArrayLike<number>

export class TrackPath {
  readonly closed: boolean
  readonly length: number
  readonly count: number
  private readonly xs: Float64Array
  private readonly ys: Float64Array
  private readonly zs: Float64Array
  /** Longitud acumulada en cada vértice (con el cierre incluido si es cerrada). */
  private readonly cum: Float64Array
  private readonly segments: number
  private cursor = 0

  constructor(x: Coords, y: Coords, z: Coords, closed: boolean) {
    const n = x.length
    if (n < 2 || y.length !== n || z.length !== n) throw new RangeError('polilínea inválida')
    this.closed = closed
    this.count = n
    this.xs = Float64Array.from(x)
    this.ys = Float64Array.from(y)
    this.zs = Float64Array.from(z)
    this.segments = closed ? n : n - 1
    this.cum = new Float64Array(this.segments + 1)
    for (let i = 0; i < this.segments; i++) {
      const j = (i + 1) % n
      this.cum[i + 1] = this.cum[i]! + Math.hypot(this.xs[j]! - this.xs[i]!, this.ys[j]! - this.ys[i]!)
    }
    this.length = this.cum[this.segments]!
  }

  /** s a [0, length): envuelve si es cerrada y satura si es abierta. */
  wrap(s: number): number {
    if (this.closed) {
      const r = s % this.length
      return r < 0 ? r + this.length : r
    }
    return Math.min(this.length, Math.max(0, s))
  }

  private segmentAt(s: number): number {
    let i = Math.min(this.cursor, this.segments - 1)
    // Desde el último segmento usado (coherencia temporal); si el salto es grande, búsqueda binaria.
    if (Math.abs(this.cum[i]! - s) > 64) {
      let lo = 0
      let hi = this.segments - 1
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1
        if (this.cum[mid]! <= s) lo = mid
        else hi = mid - 1
      }
      i = lo
    } else {
      while (i > 0 && this.cum[i]! > s) i--
      while (i < this.segments - 1 && this.cum[i + 1]! < s) i++
    }
    this.cursor = i
    return i
  }

  sample(sRaw: number, out: PathSample): PathSample {
    const s = this.wrap(sRaw)
    const i = this.segmentAt(s)
    const j = (i + 1) % this.count
    const segLen = this.cum[i + 1]! - this.cum[i]!
    const f = segLen > 0 ? (s - this.cum[i]!) / segLen : 0
    const dx = this.xs[j]! - this.xs[i]!
    const dy = this.ys[j]! - this.ys[i]!
    out.x = this.xs[i]! + f * dx
    out.y = this.ys[i]! + f * dy
    out.z = this.zs[i]! + f * (this.zs[j]! - this.zs[i]!)
    const h = Math.hypot(dx, dy) || 1
    out.tx = dx / h
    out.ty = dy / h
    return out
  }

  /** Vértice i (sin interpolar). */
  vertex(i: number, out: { x: number; y: number; z: number }): void {
    out.x = this.xs[i]!
    out.y = this.ys[i]!
    out.z = this.zs[i]!
  }
}

export function newSample(): PathSample {
  return { x: 0, y: 0, z: 0, tx: 1, ty: 0 }
}
