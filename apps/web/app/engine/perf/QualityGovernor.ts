/**
 * Degradación adaptativa: baja la resolución de render (DPR) si el p95 de los frames con reproducción
 * pasa del presupuesto, y la recupera poco a poco si sobra margen. Con histéresis (umbral de subida
 * mucho más bajo que el de bajada y varias ventanas seguidas) para no oscilar.
 *
 * Los frames se miden como intervalos de requestAnimationFrame: incluyen la GPU, pero también el tope
 * de la pantalla o del navegador (30 Hz, ahorro de energía). Por eso cada bajada se comprueba: si en
 * la ventana siguiente el p95 no mejora al menos un 10 %, el límite no es la resolución, se deshace el
 * paso y no se vuelve a bajar mientras la carga no empeore claramente (un 25 % más).
 */
import { FrameWindow } from './frames'

export const DPR_STEPS = [2, 1.5, 1.25, 1, 0.75] as const

export interface GovernorOptions {
  /** p95 por encima del cual se baja un escalón (ms). Por defecto 33,3 (30 fps). */
  degradeMs?: number
  /** p95 por debajo del cual se puede subir (ms). Por defecto 20. */
  recoverMs?: number
  /** Frames por ventana de decisión. */
  windowFrames?: number
  /** Ventanas seguidas con margen antes de subir un escalón. */
  recoverWindows?: number
}

/** Frames anómalos (pestaña en segundo plano, depurador): no cuentan. */
const IGNORE_OVER_MS = 1000
/** Frames que se descartan tras un cambio de DPR (el redimensionado del lienzo da un tirón). */
const SETTLE_FRAMES = 10
/** Una bajada "ayuda" si el p95 baja al menos un 10 %. */
const HELPED_RATIO = 0.9
/** Bloqueada la bajada, se vuelve a intentar si el p95 sube un 25 % sobre el que no se pudo arreglar. */
const RETRY_RATIO = 1.25

export class QualityGovernor {
  private readonly window: FrameWindow
  private readonly degradeMs: number
  private readonly recoverMs: number
  private readonly recoverWindows: number
  private readonly maxIndex: number
  private index: number
  private goodWindows = 0
  private settle = 0
  /** p95 que motivó la última bajada, pendiente de comprobar si sirvió. */
  private checkAgainst: number | null = null
  /** p95 con el que bajar no sirvió: no se baja de nuevo hasta superarlo claramente. */
  private blockedAt: number | null = null
  /** Cambios de DPR hechos (para el bench y la depuración). */
  readonly changes: { atFrame: number; dpr: number; p95: number }[] = []
  private frames = 0

  constructor(deviceDpr: number, opts: GovernorOptions = {}) {
    this.degradeMs = opts.degradeMs ?? 33.3
    this.recoverMs = opts.recoverMs ?? 20
    this.recoverWindows = opts.recoverWindows ?? 3
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

    // ¿Sirvió la última bajada? Si no, se deshace y se bloquea.
    if (this.checkAgainst !== null) {
      const before = this.checkAgainst
      this.checkAgainst = null
      if (p95 >= before * HELPED_RATIO) {
        this.blockedAt = before
        this.goodWindows = 0
        return this.set(this.index - 1, p95)
      }
    }
    if (this.blockedAt !== null && (p95 < this.recoverMs || p95 > this.blockedAt * RETRY_RATIO)) this.blockedAt = null

    if (p95 > this.degradeMs && this.index < DPR_STEPS.length - 1 && this.blockedAt === null) {
      this.goodWindows = 0
      this.checkAgainst = p95
      return this.set(this.index + 1, p95)
    }
    if (p95 < this.recoverMs && this.index > this.maxIndex) {
      if (++this.goodWindows >= this.recoverWindows) {
        this.goodWindows = 0
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
