/**
 * Reanudar donde lo dejaste (ítem 13, D41). Por sesión se guarda el último instante (reloj maestro: ms de sesión), el
 * coche elegido, el seguimiento y la velocidad, en `trazada.resume` (localStorage, LRU de 20 sesiones). Al volver a
 * abrir la sesión, el replay arranca en pausa en ese instante; la portada ofrece «Seguir viendo».
 *
 * TS puro (sin Vue), con el almacenamiento y los temporizadores inyectables. Nada estimado: lo guardado es estado del
 * cliente, y «Vuelta N» y el reloj visible salen de los marcadores y del cronometraje, igual que en el dock. Cada
 * dispositivo guarda lo suyo: no se sincroniza (D26).
 */
import type { Catalog, SessionType } from '@trazada/schema'
import { parseSessionId, sessionIdFromManifestPath } from '../data/session-id'
import type { LoadedSession } from '../data/types'
import { RATES, type Rate } from '../engine/clock/SessionClock'
import { clockOrigin, leaderLapAt, type TimelineMarkers } from '../engine/timeline/markers'
import { type PersistedOptions, persisted } from '../stores/persisted'
import type { ReplayRuntime } from './runtime'

export const RESUME_KEY = 'trazada.resume'
export const RESUME_VERSION = 1
/** Sesiones recordadas como mucho (LRU): la que se guardó hace más tiempo sale la primera. */
export const RESUME_MAX = 20
/** A menos de 30 s del final, la sesión cuenta como vista: se olvida y la próxima vez empieza como siempre. */
export const RESUME_NEAR_END_MS = 30_000
/** A menos de 10 s del instante por defecto no hay nada que retomar (abrir y cerrar no deja rastro). */
export const RESUME_MIN_PROGRESS_MS = 10_000
/** Reproduciendo, se guarda como mucho cada 5 s (desde el estado grueso, nunca por frame). */
export const RESUME_SAVE_EVERY_MS = 5_000
/** Tras una pausa, un seek, un cambio de velocidad o de coche, se guarda 1 s después del último cambio. */
export const RESUME_DEBOUNCE_MS = 1_000
/** Lo que dura el aviso «Retomado en …» en el replay. */
export const RESUME_TOAST_MS = 8_000
/** Sesiones de la tarjeta «Seguir viendo» de la portada. */
export const RESUME_CARD_MAX = 3
/** Clave de `rt.ext` con lo que se retomó al abrir la sesión (lo lee el aviso). */
export const RESUME_EXT = 'resume'

/** Lo guardado de una sesión. */
export interface ResumeEntry {
  /** Identificador de sesión (`2026/10-spa-francorchamps/fp1`); de él salen la temporada y el tipo. */
  id: string
  /** Instante (ms de sesión, reloj maestro). */
  t: number
  car: string | null
  /** Cámara de seguimiento del coche (solo con coche). */
  follow: boolean
  rate: Rate
  /** Cuándo se guardó (ms desde la época, reloj de pared). */
  savedAt: number
  /** t0 de la sesión al guardar: si la sesión se reconstruye y cambia, `t` se corrige al abrirla. */
  t0Utc: string
  startMs: number
  endMs: number
  /** Nombre corto del evento (`EventName`, nunca el oficial). */
  event: string
  /** Vuelta del líder en `t` (carrera y sprint) y vueltas totales; null en el resto o sin dato. */
  lap: number | null
  totalLaps: number | null
  /** Reloj visible en `t` (`t` menos el origen del reloj del dock), para la portada. */
  clockMs: number
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const isFiniteNumber = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
const isPositiveInt = (x: unknown): x is number => Number.isInteger(x) && (x as number) >= 1
const MAX_TEXT = 200

/** Valida una entrada leída (puede venir de otra versión o de otra mano): null si no sirve para retomar. */
export function validResumeEntry(x: unknown): ResumeEntry | null {
  if (!isRecord(x)) return null
  const { id, t, startMs, endMs, savedAt, t0Utc, clockMs } = x
  if (!parseSessionId(id)) return null
  if (!isFiniteNumber(t) || !isFiniteNumber(startMs) || !isFiniteNumber(endMs) || !(endMs > startMs)) return null
  if (!isFiniteNumber(savedAt) || !isFiniteNumber(clockMs)) return null
  if (typeof t0Utc !== 'string' || t0Utc.length > MAX_TEXT) return null
  const car = typeof x.car === 'string' && x.car.length > 0 && x.car.length <= 8 ? x.car : null
  return {
    id: id as string,
    t,
    car,
    follow: car !== null && x.follow === true,
    rate: RATES.includes(x.rate as Rate) ? (x.rate as Rate) : 1,
    savedAt,
    t0Utc,
    startMs,
    endMs,
    event: typeof x.event === 'string' ? x.event.slice(0, MAX_TEXT) : '',
    lap: isPositiveInt(x.lap) ? x.lap : null,
    totalLaps: isPositiveInt(x.totalLaps) ? x.totalLaps : null,
    clockMs,
  }
}

export interface ResumeStore {
  /** Lo guardado (válido), de lo más reciente a lo más antiguo. */
  list(): ResumeEntry[]
  get(id: string): ResumeEntry | null
  /** Guarda (o refresca) una sesión, que pasa a ser la más reciente; poda a `RESUME_MAX`. */
  put(entry: ResumeEntry): void
  forget(id: string): void
}

interface Saved {
  sessions: unknown[]
}

export function createResumeStore(options: Pick<PersistedOptions, 'storage'> & { max?: number } = {}): ResumeStore {
  const max = options.max ?? RESUME_MAX
  const saved = persisted<Saved>(RESUME_KEY, { version: RESUME_VERSION, storage: options.storage })

  function list(): ResumeEntry[] {
    const raw = saved.read().sessions
    if (!Array.isArray(raw)) return []
    const valid = raw.map(validResumeEntry).filter((e): e is ResumeEntry => e !== null)
    valid.sort((a, b) => b.savedAt - a.savedAt)
    // Una sesión repetida (escrita por otra mano) cuenta una vez: la más reciente.
    const seen = new Set<string>()
    return valid.filter((e) => !seen.has(e.id) && seen.add(e.id)).slice(0, max)
  }

  return {
    list,
    get: (id) => list().find((e) => e.id === id) ?? null,
    put(entry) {
      saved.write({ sessions: [entry, ...list().filter((e) => e.id !== entry.id)].slice(0, max) })
    },
    forget(id) {
      const all = list()
      const rest = all.filter((e) => e.id !== id)
      if (rest.length !== all.length) saved.write({ sessions: rest })
    },
  }
}

/** Lo guardado en este navegador (`localStorage`). */
export const resumeStore: ResumeStore = createResumeStore()

/** Lo que el reanudar necesita saber de una sesión abierta (del manifest, el cronometraje y los marcadores). */
export interface ResumeSessionInfo {
  id: string
  event: string
  t0Utc: string
  startMs: number
  endMs: number
  totalLaps: number | null
  /** Instante en que se abre la sesión si no hay nada que retomar (`defaultInitialMs`). */
  defaultMs: number
  /** Origen del reloj visible del dock (`clockOrigin`). */
  originMs: number
  /** Dorsales de la sesión. */
  cars: readonly string[]
  /** Vuelta del líder en t (carrera y sprint); null en el resto o antes de la salida. */
  lapAt(t: number): number | null
}

export function resumeInfo(session: LoadedSession, markers: TimelineMarkers, defaultMs: number): ResumeSessionInfo {
  const s = session.manifest.session
  const isRace = s.type === 'race' || s.type === 'sprint'
  return {
    id: session.id,
    event: s.event,
    t0Utc: s.t0Utc,
    startMs: s.playback.startMs,
    endMs: s.playback.endMs,
    totalLaps: isRace && isPositiveInt(s.totalLaps) ? s.totalLaps : null,
    defaultMs,
    originMs: clockOrigin(s.type, session.timing, s.playback),
    cars: session.manifest.drivers.map((d) => d.number),
    lapAt(t) {
      if (!isRace) return null
      const lap = leaderLapAt(markers, t)
      return lap >= 1 ? lap : null
    },
  }
}

/** Dónde está el instante t: vuelta del líder (o null) y reloj visible, como en el dock. */
export function resumeAt(info: ResumeSessionInfo, t: number): { lap: number | null; totalLaps: number | null; clockMs: number } {
  return { lap: info.lapAt(t), totalLaps: info.totalLaps, clockMs: t - info.originMs }
}

export type ResumeVerdict = 'resume' | 'watched' | 'unstarted'

/** ¿Hay algo que retomar en t? Casi al final cuenta como vista; junto al instante por defecto, como no empezada. */
export function resumeVerdict(t: number, session: { endMs: number; defaultMs: number }): ResumeVerdict {
  if (session.endMs - t < RESUME_NEAR_END_MS) return 'watched'
  if (Math.abs(t - session.defaultMs) < RESUME_MIN_PROGRESS_MS) return 'unstarted'
  return 'resume'
}

/** Estado de la reproducción que se guarda. */
export interface ResumeState {
  t: number
  car: string | null
  follow: boolean
  rate: Rate
}

export function resumeEntry(info: ResumeSessionInfo, state: ResumeState, savedAt: number): ResumeEntry {
  const { lap, totalLaps, clockMs } = resumeAt(info, state.t)
  return {
    id: info.id,
    t: state.t,
    car: state.car,
    follow: state.car !== null && state.follow,
    rate: state.rate,
    savedAt,
    t0Utc: info.t0Utc,
    startMs: info.startMs,
    endMs: info.endMs,
    event: info.event,
    lap,
    totalLaps,
    clockMs,
  }
}

/** Guarda el estado de la sesión o, si no hay nada que retomar (vista o sin empezar), la olvida. */
export function saveResume(store: ResumeStore, info: ResumeSessionInfo, state: ResumeState, savedAt: number): void {
  if (resumeVerdict(state.t, info) === 'resume') store.put(resumeEntry(info, state, savedAt))
  else store.forget(info.id)
}

/**
 * Instante t (ms de sesión, con t0 viejo) en el reloj de una sesión reconstruida con otro t0:
 * t + (t0 viejo − t0 nuevo). null si algún t0 no se puede leer (no se sabe dónde cae).
 */
export function shiftT0(t: number, oldT0: string, newT0: string): number | null {
  if (oldT0 === newT0) return t
  const before = Date.parse(oldT0)
  const after = Date.parse(newT0)
  if (Number.isNaN(before) || Number.isNaN(after)) return null
  return t + (before - after)
}

/** Lo que se aplica al abrir la sesión. */
export interface ResumePlan {
  /** Instante inicial (ms de sesión), ya corregido y dentro del intervalo de reproducción. */
  t: number
  /** Coche que seleccionar (solo si sigue en la sesión). */
  car: string | null
  follow: boolean
  rate: Rate
}

/**
 * Qué retomar de lo guardado al abrir la sesión: el instante corregido por el t0 actual y recortado al intervalo de
 * reproducción; el coche, solo si sigue en la sesión (si no, se ignora, y el seguimiento con él). null si no hay nada
 * que retomar: sin entrada, t0 ilegible, a menos de 30 s del final (vista) o junto al instante por defecto.
 */
export function planResume(
  entry: ResumeEntry | null,
  session: Pick<ResumeSessionInfo, 't0Utc' | 'startMs' | 'endMs' | 'defaultMs' | 'cars'>,
): ResumePlan | null {
  if (!entry) return null
  const shifted = shiftT0(entry.t, entry.t0Utc, session.t0Utc)
  if (shifted === null) return null
  const t = Math.min(session.endMs, Math.max(session.startMs, shifted))
  if (resumeVerdict(t, session) !== 'resume') return null
  const car = entry.car !== null && session.cars.includes(entry.car) ? entry.car : null
  return { t, car, follow: car !== null && entry.follow, rate: entry.rate }
}

/** Lo que se retomó al abrir la sesión (en `rt.ext(RESUME_EXT)`; null si nada). */
export interface ResumeApplied {
  plan: ResumePlan
  info: ResumeSessionInfo
}

/** `?t=<ms de sesión>`: instante de arranque explícito, que manda sobre lo guardado. null si no hay o no es un número. */
export function parseTimeParam(value: unknown): number | null {
  if (typeof value !== 'string' || !/^-?\d{1,12}(\.\d+)?$/.test(value)) return null
  const t = Number(value)
  return Number.isFinite(t) ? t : null
}

export interface ResumeTimers {
  now(): number
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

const browserTimers: ResumeTimers = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export interface ResumeSaver {
  /** Estado grueso (≤ 10 Hz): reproduciendo, guarda si han pasado `RESUME_SAVE_EVERY_MS` desde la última vez. */
  tick(playing: boolean): void
  /** Algo cambió (pausa, seek, velocidad, coche): guarda `RESUME_DEBOUNCE_MS` después del último cambio. */
  touch(): void
  /** Guarda ya (al salir de la página o de la sesión). */
  flush(): void
  /** Descarta un guardado pendiente. */
  cancel(): void
}

/** Cuándo se guarda; `save` decide qué. Nunca por frame: como mucho cada 5 s reproduciendo. */
export function createResumeSaver(save: () => void, timers: ResumeTimers = browserTimers): ResumeSaver {
  let last = Number.NEGATIVE_INFINITY
  let pending: unknown = null
  const cancel = () => {
    if (pending === null) return
    timers.clearTimeout(pending)
    pending = null
  }
  const run = () => {
    cancel()
    last = timers.now()
    save()
  }
  return {
    tick(playing) {
      if (playing && timers.now() - last >= RESUME_SAVE_EVERY_MS) run()
    },
    touch() {
      cancel()
      pending = timers.setTimeout(run, RESUME_DEBOUNCE_MS)
    },
    flush: run,
    cancel,
  }
}

export interface ResumeTracker {
  /** El coche o el seguimiento cambiaron. */
  touch(): void
  /** Guarda ya. */
  flush(): void
  /** Guarda por última vez y suelta los oyentes (antes de desechar el runtime). */
  stop(): void
}

/**
 * Guarda la posición de la sesión abierta mientras se ve: cada 5 s reproduciendo (desde `onCoarse`), 1 s después de
 * una pausa, un seek, un cambio de velocidad o de coche (`touch`), al ocultar o cerrar la página (`visibilitychange`,
 * `pagehide`) y al salir de la sesión (`stop`).
 */
export function trackResume(
  rt: Pick<ReplayRuntime, 'clock' | 'onCoarse'>,
  info: ResumeSessionInfo,
  view: () => { car: string | null; follow: boolean },
  store: ResumeStore = resumeStore,
  timers: ResumeTimers = browserTimers,
): ResumeTracker {
  const saver = createResumeSaver(() => {
    const { car, follow } = view()
    saveResume(store, info, { t: rt.clock.timeMs, car, follow, rate: rt.clock.rate }, timers.now())
  }, timers)
  const offClock = rt.clock.on((event) => {
    if (event !== 'play') saver.touch()
  })
  const offCoarse = rt.onCoarse((s) => saver.tick(s.playing))
  const dom = typeof window !== 'undefined' && typeof document !== 'undefined'
  const onPageHide = () => saver.flush()
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') saver.flush()
  }
  if (dom) {
    window.addEventListener('pagehide', onPageHide)
    document.addEventListener('visibilitychange', onVisibility)
  }
  let stopped = false
  return {
    touch() {
      if (!stopped) saver.touch()
    },
    flush() {
      if (!stopped) saver.flush()
    },
    stop() {
      if (stopped) return
      saver.flush()
      stopped = true
      offClock()
      offCoarse()
      if (dom) {
        window.removeEventListener('pagehide', onPageHide)
        document.removeEventListener('visibilitychange', onVisibility)
      }
    },
  }
}

/** Una sesión de la tarjeta «Seguir viendo», con los datos del catálogo actual. */
export interface ContinueItem {
  entry: ResumeEntry
  season: number
  type: SessionType
  event: string
  country: string
  /** Fracción vista [0, 1] del intervalo de reproducción. */
  progress: number
}

/**
 * Las sesiones guardadas que se pueden abrir: solo las que siguen en el catálogo y se pueden reproducir (como en el
 * selector: con una ruta válida y con posiciones). Una sesión borrada no sale. Las `max` más recientes.
 */
export function continueItems(
  entries: readonly ResumeEntry[],
  catalog: Catalog | null,
  max = RESUME_CARD_MAX,
): ContinueItem[] {
  if (!catalog) return []
  const playable = new Map<string, { event: string; country: string }>()
  for (const season of catalog.seasons) {
    for (const event of season.events) {
      for (const s of event.sessions) {
        if (s.status === 'no-position') continue
        const id = sessionIdFromManifestPath(s.path)
        if (id) playable.set(id, { event: event.event, country: event.country })
      }
    }
  }
  const out: ContinueItem[] = []
  for (const entry of entries) {
    if (out.length >= max) break
    const where = playable.get(entry.id)
    const id = parseSessionId(entry.id)
    if (!where || !id) continue
    const progress = (entry.t - entry.startMs) / (entry.endMs - entry.startMs)
    out.push({ entry, season: id.season, type: id.type, ...where, progress: Math.min(1, Math.max(0, progress)) })
  }
  return out
}

/** «Hace cuánto» en la unidad que se lee mejor (para `Intl.RelativeTimeFormat`); 0 s es «ahora». */
export function relativeTime(elapsedMs: number): { value: number; unit: Intl.RelativeTimeFormatUnit } {
  const minutes = Math.floor(Math.max(0, elapsedMs) / 60_000)
  if (minutes < 1) return { value: 0, unit: 'second' }
  if (minutes < 60) return { value: -minutes, unit: 'minute' }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return { value: -hours, unit: 'hour' }
  const days = Math.floor(hours / 24)
  if (days < 7) return { value: -days, unit: 'day' }
  if (days < 30) return { value: -Math.floor(days / 7), unit: 'week' }
  if (days < 365) return { value: -Math.floor(days / 30), unit: 'month' }
  return { value: -Math.floor(days / 365), unit: 'year' }
}
