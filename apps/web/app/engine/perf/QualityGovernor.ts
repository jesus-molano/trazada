/**
 * Degradación adaptativa de la resolución de render (DPR) según el p95 de los frames con reproducción.
 *
 * Los frames se miden como intervalos de requestAnimationFrame: incluyen la GPU, pero también el tope
 * de la pantalla o del navegador y, a 60 Hz, van cuantizados al vsync (16,7 / 33,3 / 50 ms…). Por eso:
 * - el presupuesto es 35 ms: dos vsync a 60 Hz con margen para el jitter, y un tope de 30 Hz estable
 *   no lo supera (no hay nada que arreglar bajando la resolución);
 * - pasado el presupuesto, se **sondea** escalón a escalón (un paso que no cambia de "cubo" de vsync
 *   no significa que el siguiente no ayude) hasta volver al presupuesto. Si se llega al mínimo sin
 *   lograrlo, se elige el DPR más alto cuyo p95 esté a menos de un 10 % del mejor medido: si bajar no
 *   ayuda (CPU, tope del navegador), se vuelve al DPR del dispositivo y no se reintenta mientras la
 *   carga no empeore claramente (un 25 % más);
 * - cada subida se comprueba: si en la ventana siguiente se pasa del presupuesto, se deshace y la
 *   siguiente prueba exige el doble de ventanas con margen (sin oscilar cada pocos segundos).
 */
import { FrameWindow } from './frames'

export const DPR_STEPS = [2, 1.5, 1.25, 1, 0.75] as const

export interface GovernorOptions {
  /** p95 por encima del cual se degrada (ms). Por defecto 35. */
  degradeMs?: number
  /** p95 por debajo del cual se puede subir (ms). Por defecto 20. */
  recoverMs?: number
  /** Frames por ventana de decisión. */
  windowFrames?: number
  /** Ventanas seguidas con margen antes de subir un escalón (se dobla tras cada subida fallida). */
  recoverWindows?: number
}

/** Frames anómalos (pestaña en segundo plano, depurador): no cuentan. */
const IGNORE_OVER_MS = 1000
/** Frames que se descartan tras un cambio de DPR (el redimensionado del lienzo da un tirón). */
const SETTLE_FRAMES = 10
/** Un DPR "rinde casi igual" que el mejor si su p95 está a menos de un 10 % por encima. */
const NEAR_BEST = 1.1
/** Tras un sondeo sin solución, se vuelve a intentar si el p95 empeora un 25 %. */
const RETRY_RATIO = 1.25
const MAX_RECOVER_WINDOWS = 96

export class QualityGovernor {
  private readonly window: FrameWindow
  private readonly degradeMs: number
  private readonly recoverMs: number
  private readonly maxIndex: number
  private index: number
  private recoverNeeded: number
  private goodWindows = 0
  private settle = 0
  /** Sondeo en curso: p95 medido en cada escalón probado. */
  private probe: Map<number, number> | null = null
  /** p95 con el que un sondeo no encontró solución: no se sondea otra vez hasta superarlo claramente. */
  private blockedAt: number | null = null
  /** Subida pendiente de comprobar: el escalón al que volver si falla. */
  private upFrom: number | null = null
  /** Cambios de DPR hechos (para el bench y la depuración). */
  readonly changes: { atFrame: number; dpr: number; p95: number }[] = []
  private frames = 0

  constructor(deviceDpr: number, opts: GovernorOptions = {}) {
    this.degradeMs = opts.degradeMs ?? 35
    this.recoverMs = opts.recoverMs ?? 20
    this.recoverNeeded = opts.recoverWindows ?? 3
    this.window = new FrameWindow(opts.windowFrames ?? 90)
    // El escalón más alto que no supera el DPR del dispositivo (tope 2).
    const i = DPR_STEPS.findIndex((s) => s <= Math.min(2, deviceDpr) + 1e-9)
    this.maxIndex = i < 0 ? DPR_STEPS.length - 1 : i
    this.index = this.maxIndex
  }

  get dpr(): number {
    return DPR_STEPS[this.index]!
  }

  /** Registra un frame (solo con reproducción). Devuelve el DPR nuevo si cambia; si no, null. */
  frame(ms: number): number | null {
    if (!(ms > 0) || ms > IGNORE_OVER_MS) return null
    this.frames++
    if (this.settle > 0) {
      this.settle--
      return null
    }
    this.window.push(ms)
    if (!this.window.full) return null
    const p95 = this.window.percentile(95)
    this.window.clear()
    return this.decide(p95)
  }

  private decide(p95: number): number | null {
    const last = DPR_STEPS.length - 1
    const over = p95 > this.degradeMs

    // 1. Sondeo en curso: seguir bajando hasta entrar en presupuesto o llegar al mínimo.
    if (this.probe) {
      this.probe.set(this.index, p95)
      if (!over) {
        this.probe = null
        return null
      }
      if (this.index < last) return this.set(this.index + 1, p95)
      const best = Math.min(...this.probe.values())
      let chosen = this.index
      for (const [i, v] of [...this.probe.entries()].sort((a, b) => a[0] - b[0])) {
        if (v <= best * NEAR_BEST) {
          chosen = i
          break
        }
      }
      this.blockedAt = this.probe.get(chosen)!
      this.probe = null
      return chosen === this.index ? null : this.set(chosen, p95)
    }

    // 2. Subida pendiente de comprobar.
    if (this.upFrom !== null) {
      const from = this.upFrom
      this.upFrom = null
      if (over) {
        this.recoverNeeded = Math.min(MAX_RECOVER_WINDOWS, this.recoverNeeded * 2)
        this.goodWindows = 0
        return this.set(from, p95)
      }
    }

    // 3. Bloqueo tras un sondeo sin solución.
    if (this.blockedAt !== null && (p95 < this.recoverMs || p95 > this.blockedAt * RETRY_RATIO)) this.blockedAt = null

    // 4. Pasado de presupuesto: empieza un sondeo.
    if (over && this.blockedAt === null && this.index < last) {
      this.goodWindows = 0
      this.probe = new Map([[this.index, p95]])
      return this.set(this.index + 1, p95)
    }

    // 5. Con margen: subir un escalón tras varias ventanas seguidas (y comprobarlo).
    if (p95 < this.recoverMs && this.index > this.maxIndex) {
      if (++this.goodWindows >= this.recoverNeeded) {
        this.goodWindows = 0
        this.upFrom = this.index
        return this.set(this.index - 1, p95)
      }
    } else {
      this.goodWindows = 0
    }
    return null
  }

  private set(index: number, p95: number): number {
    this.index = index
    this.settle = SETTLE_FRAMES
    this.changes.push({ atFrame: this.frames, dpr: this.dpr, p95 })
    return this.dpr
  }
}
