/** Estadística de tiempos de frame (ms), sin dependencias: la usan el bench y el gobernador de calidad. */

/** Percentil p (0–100) por el método del rango más cercano. Lista vacía → NaN. */
export function percentile(values: ArrayLike<number>, p: number): number {
  const n = values.length
  if (n === 0) return Number.NaN
  const sorted = Float64Array.from(values).sort()
  const rank = Math.min(n - 1, Math.max(0, Math.ceil((p / 100) * n) - 1))
  return sorted[rank]!
}

export interface FrameSummary {
  frames: number
  p50: number
  p95: number
  p99: number
  max: number
  /** Frames de más de 50 ms (tirones visibles). */
  over50: number
}

export function summarize(values: ArrayLike<number>): FrameSummary {
  let max = 0
  let over50 = 0
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!
    if (v > max) max = v
    if (v > 50) over50++
  }
  return {
    frames: values.length,
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    p99: percentile(values, 99),
    max,
    over50,
  }
}

/** Ventana circular de los últimos N tiempos de frame. */
export class FrameWindow {
  private readonly buf: Float64Array
  private next = 0
  private filled = 0

  constructor(readonly size: number) {
    this.buf = new Float64Array(size)
  }

  push(ms: number): void {
    this.buf[this.next] = ms
    this.next = (this.next + 1) % this.size
    this.filled = Math.min(this.size, this.filled + 1)
  }

  get full(): boolean {
    return this.filled === this.size
  }

  percentile(p: number): number {
    return percentile(this.buf.subarray(0, this.filled), p)
  }

  clear(): void {
    this.next = 0
    this.filled = 0
  }
}
