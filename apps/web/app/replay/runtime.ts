/**
 * Runtime del replay: dueño del bucle de frames y del reloj maestro. Fuera de Vue: los componentes se
 * suscriben a `onFrame` y escriben en el DOM o en la escena directamente; Pinia solo recibe el
 * estado grueso (~10 Hz) a través de `onCoarse`.
 */
import type { DriverInfo } from '@trazada/schema'
import type { LoadedSession } from '~/data/types'
import { type ClockEvent, type Rate, SessionClock } from '~/engine/clock/SessionClock'
import { carTracks } from '~/engine/replay/motion'
import { ReplayModel } from '~/engine/replay/ReplayModel'
import { buildTimelineMarkers, type TimelineMarkers } from '~/engine/timeline/markers'
import { type CircuitModel, circuitModel } from '~/engine/track/circuit'

export const COARSE_INTERVAL_MS = 100
/** En carrera, se empieza un poco antes de la salida (la ventana arranca 10 min antes). */
const PRE_START_MS = 5000

export interface CoarseState {
  timeMs: number
  playing: boolean
  rate: Rate
}

export interface ReplayRuntime {
  readonly session: LoadedSession
  readonly clock: SessionClock
  readonly markers: TimelineMarkers
  readonly drivers: DriverInfo[]
  readonly circuit: CircuitModel
  /** Estado de todos los coches en el instante del reloj (se actualiza antes de los oyentes de frame). */
  readonly model: ReplayModel
  /** Se llama en cada frame con reproducción, y una vez tras cada seek/cambio en pausa. */
  onFrame(cb: (timeMs: number) => void): () => void
  onCoarse(cb: (state: CoarseState) => void): () => void
  /** La escena registra aquí su `invalidate` (modo on-demand). */
  setInvalidate(fn: (() => void) | null): void
  /** Pide un frame aunque el reloj esté en pausa (selección, cámara…). */
  requestFrame(): void
  readonly frames: number
  dispose(): void
}

export function createReplayRuntime(session: LoadedSession): ReplayRuntime {
  const { playback, type } = session.manifest.session
  const initial =
    playback.lightsOutMs != null ? Math.max(playback.startMs, playback.lightsOutMs - PRE_START_MS) : playback.startMs
  const clock = new SessionClock(playback.startMs, playback.endMs, initial)
  const markers = buildTimelineMarkers(type, session.timing, session.events, playback.endMs)
  const circuit = circuitModel(session.circuit)
  const model = new ReplayModel(carTracks(session.motion, session.tangents), circuit, session.manifest.drivers)

  const frameListeners = new Set<(t: number) => void>()
  const coarseListeners = new Set<(s: CoarseState) => void>()
  let invalidate: (() => void) | null = null
  let dirty = true
  let raf = 0
  let last = -1
  let lastCoarse = -Infinity
  let frames = 0
  let disposed = false

  const coarse = (): CoarseState => ({ timeMs: clock.timeMs, playing: clock.playing, rate: clock.rate })
  const pushCoarse = () => {
    const s = coarse()
    for (const l of coarseListeners) l(s)
  }

  const offClock = clock.on((event: ClockEvent) => {
    dirty = true
    pushCoarse()
    if (event === 'play') last = -1
  })

  const loop = (now: number) => {
    if (disposed) return
    const delta = last < 0 ? 0 : now - last
    last = now
    clock.tick(delta)
    if (clock.playing || dirty) {
      dirty = false
      frames++
      const t = clock.timeMs
      model.update(t)
      for (const l of frameListeners) l(t)
      invalidate?.()
      if (clock.playing && now - lastCoarse >= COARSE_INTERVAL_MS) {
        lastCoarse = now
        pushCoarse()
      }
    }
    raf = requestAnimationFrame(loop)
  }
  raf = requestAnimationFrame(loop)

  return {
    session,
    clock,
    markers,
    drivers: session.manifest.drivers,
    circuit,
    model,
    onFrame(cb) {
      frameListeners.add(cb)
      dirty = true
      return () => frameListeners.delete(cb)
    },
    onCoarse(cb) {
      coarseListeners.add(cb)
      cb(coarse())
      return () => coarseListeners.delete(cb)
    },
    setInvalidate(fn) {
      invalidate = fn
      dirty = true
    },
    requestFrame() {
      dirty = true
    },
    get frames() {
      return frames
    },
    dispose() {
      disposed = true
      cancelAnimationFrame(raf)
      offClock()
      frameListeners.clear()
      coarseListeners.clear()
      invalidate = null
    },
  }
}
