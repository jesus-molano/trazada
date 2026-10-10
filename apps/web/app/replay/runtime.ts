/**
 * Runtime del replay: dueño del bucle de frames y del reloj maestro. Fuera de Vue: los componentes se
 * suscriben a `onFrame` y escriben en el DOM o en la escena directamente; Pinia solo recibe el
 * estado grueso (~10 Hz) a través de `onCoarse`.
 */
import type { DriverInfo, RaceControlEvent } from '@trazada/schema'
import type { LoadedSession } from '~/data/types'
import { type ClockEvent, type Rate, SessionClock } from '~/engine/clock/SessionClock'
import { LeaderboardEngine } from '~/engine/leaderboard/leaderboard'
import { carTracks } from '~/engine/replay/motion'
import { ReplayModel } from '~/engine/replay/ReplayModel'
import { lateralOffsets } from '~/engine/replay/separation'
import { buildTimelineMarkers, type TimelineMarkers } from '~/engine/timeline/markers'
import { TrackState } from '~/engine/trackstate/TrackState'
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
  readonly leaderboard: LeaderboardEngine
  /** Banderas por sector y neutralizaciones en el instante del reloj (antes de los oyentes de frame). */
  readonly trackState: TrackState
  /** Mensajes de race control ordenados por t (el texto original, sin tocar). */
  readonly raceControl: readonly RaceControlEvent[]
  /** Separación lateral solo visual (m, + izquierda) por coche, en el orden de `model.states`. */
  readonly offsets: Float32Array
  /** Activa la separación visual (opción del usuario, marcada como Estimado). */
  setSeparation(on: boolean): void
  /** Coches desplazados en el último frame. */
  readonly separatedCars: number
  /** Se llama en cada frame con reproducción, y una vez tras cada seek/cambio en pausa. */
  onFrame(cb: (timeMs: number) => void): () => void
  onCoarse(cb: (state: CoarseState) => void): () => void
  /** La escena registra aquí su `invalidate` (modo on-demand). */
  setInvalidate(fn: (() => void) | null): void
  /** Pide un frame aunque el reloj esté en pausa (selección, cámara…). */
  requestFrame(): void
  /**
   * La escena está tapada (p. ej. por la hoja de análisis): no se le piden frames y la GPU descansa. El reloj, el
   * modelo y los oyentes de frame siguen igual (la clasificación y el timeline no se paran). Al destaparla, un frame.
   */
  setSceneHidden(hidden: boolean): void
  readonly sceneHidden: boolean
  /**
   * Extensión perezosa y memoizada (D29): la primera llamada con `key` crea el valor con `factory(rt)` (un precálculo
   * de una función: momentos, zonas de DRS, sectores…) y las siguientes devuelven ese mismo valor, sin llamar a
   * `factory`. Vive lo que el runtime: si el valor tiene `dispose()`, se llama al desecharlo.
   */
  ext<T>(key: string, factory: (rt: ReplayRuntime) => T): T
  readonly frames: number
  dispose(): void
}

export interface ReplayRuntimeOptions {
  /**
   * Instante inicial (ms de sesión), p. ej. para reanudar donde se dejó: el primer frame ya es ese, sin pasar por el
   * de por defecto. Se ajusta al intervalo de reproducción; si no es un número finito, se usa el de por defecto.
   */
  initialMs?: number
}

/** Instante inicial por defecto: el inicio de la reproducción o, en carrera, un poco antes de la salida. */
export function defaultInitialMs(playback: { startMs: number; lightsOutMs?: number | null }): number {
  return playback.lightsOutMs != null ? Math.max(playback.startMs, playback.lightsOutMs - PRE_START_MS) : playback.startMs
}

export function createReplayRuntime(session: LoadedSession, options: ReplayRuntimeOptions = {}): ReplayRuntime {
  const { playback, type } = session.manifest.session
  const initial =
    options.initialMs !== undefined && Number.isFinite(options.initialMs) ? options.initialMs : defaultInitialMs(playback)
  const clock = new SessionClock(playback.startMs, playback.endMs, initial)
  const markers = buildTimelineMarkers(type, session.timing, session.events, playback.endMs)
  const circuit = circuitModel(session.circuit)
  const model = new ReplayModel(carTracks(session.motion, session.tangents), circuit, session.manifest.drivers)
  const leaderboard = new LeaderboardEngine(type, session.timing, session.events, session.manifest.drivers)
  const trackState = new TrackState(session.events, playback.endMs)
  const raceControl = [...session.events.raceControl].sort((a, b) => a.t - b.t)
  const offsets = new Float32Array(model.states.length)
  let separation = false
  let separatedCars = 0
  let sceneHidden = false
  /** Extensiones de `ext`; `PENDING` mientras se crea una (para detectar una que se pide a sí misma). */
  const exts = new Map<string, unknown>()
  const PENDING = Symbol('pending')

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
      trackState.update(t)
      if (separation) separatedCars = lateralOffsets(model.states, circuit.centerline.length, offsets)
      for (const l of frameListeners) l(t)
      if (!sceneHidden) invalidate?.()
      if (clock.playing && now - lastCoarse >= COARSE_INTERVAL_MS) {
        lastCoarse = now
        pushCoarse()
      }
    }
    raf = requestAnimationFrame(loop)
  }
  raf = requestAnimationFrame(loop)

  const rt: ReplayRuntime = {
    session,
    clock,
    markers,
    drivers: session.manifest.drivers,
    circuit,
    model,
    leaderboard,
    trackState,
    raceControl,
    offsets,
    setSeparation(on) {
      separation = on
      if (!on) {
        offsets.fill(0)
        separatedCars = 0
      }
      dirty = true
    },
    get separatedCars() {
      return separatedCars
    },
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
    setSceneHidden(hidden) {
      if (hidden === sceneHidden) return
      sceneHidden = hidden
      if (!hidden) dirty = true
    },
    get sceneHidden() {
      return sceneHidden
    },
    ext<T>(key: string, factory: (rt: ReplayRuntime) => T): T {
      if (exts.has(key)) {
        const value = exts.get(key)
        if (value === PENDING) throw new Error(`rt.ext('${key}'): la extensión se pide a sí misma mientras se crea`)
        return value as T
      }
      if (disposed) throw new Error(`rt.ext('${key}'): el runtime ya se desechó`)
      exts.set(key, PENDING)
      try {
        const value = factory(rt)
        exts.set(key, value)
        return value
      } catch (error) {
        exts.delete(key)
        throw error
      }
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
      for (const value of exts.values()) {
        const d = (value as { dispose?: unknown } | null)?.dispose
        if (typeof d === 'function') d.call(value)
      }
      exts.clear()
    },
  }
  return rt
}
