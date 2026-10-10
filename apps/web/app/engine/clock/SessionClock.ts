/**
 * Reloj maestro del replay. Todo (escena, timeline, leaderboard, telemetría, race control) cuelga de
 * `timeMs`, en tiempo de sesión (ms desde el t0 del feed). Sin Vue ni DOM.
 */
export const RATES = [1, 2, 4, 8, 16] as const
export type Rate = (typeof RATES)[number]

/** Tope del delta por frame: al volver a una pestaña en segundo plano no se dan saltos. */
export const MAX_DELTA_MS = 100

export type ClockEvent = 'seek' | 'play' | 'pause' | 'rate' | 'end'
type Listener = (event: ClockEvent, clock: SessionClock) => void

export class SessionClock {
  readonly startMs: number
  readonly endMs: number
  private _timeMs: number
  private _rate: Rate = 1
  private _playing = false
  private readonly listeners = new Set<Listener>()

  constructor(startMs: number, endMs: number, initialMs = startMs) {
    if (!(endMs > startMs)) throw new RangeError(`intervalo de reproducción inválido [${startMs}, ${endMs}]`)
    this.startMs = startMs
    this.endMs = endMs
    this._timeMs = this.clamp(initialMs)
  }

  get timeMs(): number {
    return this._timeMs
  }
  get rate(): Rate {
    return this._rate
  }
  get playing(): boolean {
    return this._playing
  }
  get duration(): number {
    return this.endMs - this.startMs
  }
  /** Fracción [0, 1] del intervalo de reproducción. */
  get progress(): number {
    return (this._timeMs - this.startMs) / this.duration
  }

  /** Avanza con el delta real del frame (ms). Devuelve el nuevo tiempo. */
  tick(deltaMs: number): number {
    if (!this._playing || !(deltaMs > 0)) return this._timeMs
    const next = this._timeMs + Math.min(deltaMs, MAX_DELTA_MS) * this._rate
    if (next >= this.endMs) {
      this._timeMs = this.endMs
      this._playing = false
      this.emit('end')
    } else {
      this._timeMs = next
    }
    return this._timeMs
  }

  play(): void {
    if (this._playing) return
    if (this._timeMs >= this.endMs) this.seek(this.startMs) // al final, vuelve a empezar
    this._playing = true
    this.emit('play')
  }

  pause(): void {
    if (!this._playing) return
    this._playing = false
    this.emit('pause')
  }

  toggle(): void {
    if (this._playing) this.pause()
    else this.play()
  }

  setRate(rate: Rate): void {
    if (!RATES.includes(rate)) throw new RangeError(`velocidad no soportada: ${rate}`)
    if (rate === this._rate) return
    this._rate = rate
    this.emit('rate')
  }

  seek(timeMs: number): void {
    if (!Number.isFinite(timeMs)) return
    this._timeMs = this.clamp(timeMs)
    this.emit('seek')
  }

  seekBy(deltaMs: number): void {
    this.seek(this._timeMs + deltaMs)
  }

  seekToFraction(f: number): void {
    this.seek(this.startMs + Math.min(1, Math.max(0, f)) * this.duration)
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private clamp(t: number): number {
    return Math.min(this.endMs, Math.max(this.startMs, t))
  }

  private emit(event: ClockEvent): void {
    for (const l of this.listeners) l(event, this)
  }
}
