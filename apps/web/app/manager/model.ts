/**
 * Gestor de datos local (D26), parte pura: une el calendario de la temporada (pipeline `schedule`) con el
 * catálogo de sesiones ya generadas y decide qué se muestra en cada sesión (enlace, «Descargar», progreso…).
 * Sin Vue ni red: lo usan el store y el selector, y se prueba aparte.
 */
import type { CatalogEvent, CatalogSession, SessionType } from '@trazada/schema'
import { parseSessionId, sessionIdFromManifestPath } from '../data/session-id'

export const SESSION_ORDER: readonly SessionType[] = ['fp1', 'fp2', 'fp3', 'sq', 'sprint', 'q', 'race']

export interface ScheduleSession {
  session: SessionType
  /** Inicio en UTC (ISO 8601) o null si el calendario no lo da. */
  startUtc: string | null
}

export interface ScheduleEvent {
  round: number
  slug: string
  event: string
  country: string
  dateStart?: string
  sessions: ScheduleSession[]
}

export interface Schedule {
  season: number
  events: ScheduleEvent[]
}

export type JobState = 'queued' | 'running' | 'done' | 'error' | 'cancelled'
export type JobErrorCode = 'empty' | 'network' | 'ratelimit' | 'failed' | 'timeout' | 'pipeline' | 'cancelled'
export const JOB_ERROR_CODES: readonly JobErrorCode[] = [
  'empty',
  'network',
  'ratelimit',
  'failed',
  'timeout',
  'pipeline',
  'cancelled',
]

export interface Job {
  id: string
  season: number
  round: number
  session: SessionType
  state: JobState
  /** 0–100 (aproximado: pasos de la descarga de FastF1 y del procesado). */
  pct: number
  phase: 'download' | 'process' | null
  error: { code: JobErrorCode; message: string } | null
  result: { session: string | null; status: string; bytes: number | null } | null
  /** Cuándo se creó (ISO 8601): junto con el id, identifica el trabajo aunque el servidor se reinicie. */
  createdAt: string
  /** Últimas líneas del registro del pipeline (solo si falló). */
  log?: string[]
}

export interface JobRequest {
  season: number
  round: number
  session: SessionType
}

export interface BrowseSession {
  session: SessionType
  /** Sesión ya generada (catálogo), o null. */
  catalog: CatalogSession | null
  startUtc: string | null
}

export interface BrowseEvent {
  key: string
  round: number
  slug: string
  event: string
  country: string
  dateStart?: string
  /** Está en el calendario de la temporada (se puede descargar lo que falte). */
  scheduled: boolean
  sessions: BrowseSession[]
}

export const eventKey = (e: { round: number; slug: string }): string =>
  `${String(e.round).padStart(2, '0')}-${e.slug}`

export const jobKey = (j: { season: number; round: number; session: SessionType }): string =>
  `${j.season}-${j.round}-${j.session}`

const bySessionOrder = (a: { session: SessionType }, b: { session: SessionType }) =>
  SESSION_ORDER.indexOf(a.session) - SESSION_ORDER.indexOf(b.session)

/**
 * Eventos del selector: los del calendario (si lo hay) con sus sesiones generadas, más los del catálogo que no
 * casan con el calendario (misma ronda y slug). Sin calendario, exactamente el catálogo.
 */
export function mergeEvents(catalog: readonly CatalogEvent[], schedule: readonly ScheduleEvent[] | null): BrowseEvent[] {
  const fromCatalog = (e: CatalogEvent): BrowseEvent => ({
    key: eventKey(e),
    round: e.round,
    slug: e.slug,
    event: e.event,
    country: e.country,
    dateStart: e.dateStart,
    scheduled: false,
    sessions: e.sessions.map((s) => ({ session: s.session, catalog: s, startUtc: null })),
  })
  if (!schedule) return catalog.map(fromCatalog)

  const byKey = new Map(catalog.map((e) => [eventKey(e), e]))
  const out: BrowseEvent[] = []
  for (const e of schedule) {
    const key = eventKey(e)
    const built = byKey.get(key)
    byKey.delete(key)
    const sessions: BrowseSession[] = e.sessions.map((s) => ({
      session: s.session,
      catalog: built?.sessions.find((c) => c.session === s.session) ?? null,
      startUtc: s.startUtc,
    }))
    for (const c of built?.sessions ?? []) {
      if (!sessions.some((s) => s.session === c.session)) sessions.push({ session: c.session, catalog: c, startUtc: null })
    }
    sessions.sort(bySessionOrder)
    out.push({
      key,
      round: e.round,
      slug: e.slug,
      event: e.event,
      country: e.country,
      // La fecha del calendario (primer día del fin de semana) para que todas las tarjetas sean coherentes.
      dateStart: e.dateStart ?? built?.dateStart,
      scheduled: true,
      sessions,
    })
  }
  for (const e of byKey.values()) out.push(fromCatalog(e))
  return out.sort((a, b) => a.round - b.round || a.slug.localeCompare(b.slug))
}

/** Duración aproximada de cada sesión (min). */
const DURATION_MIN: Record<SessionType, number> = { fp1: 60, fp2: 60, fp3: 60, sq: 45, sprint: 60, q: 60, race: 120 }
/** Margen tras el final hasta que los datos suelen estar disponibles (min). */
export const DATA_DELAY_MIN = 30

/** Instante (ms) desde el que tiene sentido descargar la sesión, o null si el calendario no da la hora. */
export function availableFrom(s: { session: SessionType; startUtc: string | null }): number | null {
  if (!s.startUtc) return null
  const start = Date.parse(s.startUtc)
  return Number.isNaN(start) ? null : start + (DURATION_MIN[s.session] + DATA_DELAY_MIN) * 60_000
}

export type SessionView =
  | { kind: 'link'; to: string; bytes: number | null; dev: boolean }
  | { kind: 'unavailable' }
  | { kind: 'queued'; job: Job }
  | { kind: 'running'; job: Job }
  | { kind: 'error'; job: Job }
  | { kind: 'download' }
  | { kind: 'future'; at: number | null }

const linkTo = (id: string) => `/replay?s=${id}`

/** Qué se muestra en una sesión. `job`: el último trabajo de esa sesión en el gestor (si lo hay). */
export function sessionView(s: BrowseSession, job: Job | null, now: number, manager: boolean): SessionView {
  if (job?.state === 'queued') return { kind: 'queued', job }
  if (job?.state === 'running') return { kind: 'running', job }
  if (s.catalog) {
    const id = sessionIdFromManifestPath(s.catalog.path)
    return id && s.catalog.status !== 'no-position'
      ? { kind: 'link', to: linkTo(id), bytes: s.catalog.bytes ?? null, dev: !!s.catalog.dev }
      : { kind: 'unavailable' }
  }
  // Recién generada y el catálogo aún no se ha releído (o el pipeline la guardó con otro slug).
  const built = job?.state === 'done' && job.result?.session && parseSessionId(job.result.session) ? job.result : null
  if (built?.session) {
    return built.status === 'no-position'
      ? { kind: 'unavailable' }
      : { kind: 'link', to: linkTo(built.session), bytes: built.bytes, dev: false }
  }
  if (job?.state === 'error') return { kind: 'error', job }
  const from = availableFrom(s)
  if (manager && (from === null || now >= from)) return { kind: 'download' }
  return { kind: 'future', at: from }
}

/** Sesiones de un evento que se pueden descargar ahora (sin generar y sin trabajo en curso). */
export function downloadable(
  season: number,
  e: BrowseEvent,
  jobs: ReadonlyMap<string, Job>,
  now: number,
  only?: SessionType,
): JobRequest[] {
  if (!e.scheduled) return []
  const out: JobRequest[] = []
  for (const s of e.sessions) {
    if (only && s.session !== only) continue
    const req = { season, round: e.round, session: s.session }
    const view = sessionView(s, jobs.get(jobKey(req)) ?? null, now, true)
    if (view.kind === 'download' || view.kind === 'error') out.push(req)
  }
  return out
}

/** Estado agregado de la cola, para la barra de descargas. */
export function queueSummary(jobs: readonly Job[]): { active: number; queued: number; running: Job | null } {
  const running = jobs.find((j) => j.state === 'running') ?? null
  const queued = jobs.filter((j) => j.state === 'queued').length
  return { active: queued + (running ? 1 : 0), queued, running }
}

// ---------------------------------------------------------------------------------------------------------
// Validación de lo que llega del servidor local (no se confía en la forma de las respuestas).

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const isSessionType = (v: unknown): v is SessionType => SESSION_ORDER.includes(v as SessionType)

export function parseSchedule(value: unknown, season: number): Schedule | null {
  if (!isObj(value) || value.season !== season || !Array.isArray(value.events)) return null
  const events: ScheduleEvent[] = []
  for (const e of value.events) {
    if (!isObj(e) || !Number.isInteger(e.round) || typeof e.slug !== 'string' || !/^[a-z0-9-]+$/.test(e.slug)) {
      return null
    }
    if (typeof e.event !== 'string' || typeof e.country !== 'string' || !Array.isArray(e.sessions)) return null
    const sessions: ScheduleSession[] = []
    for (const s of e.sessions) {
      if (!isObj(s) || !isSessionType(s.session)) return null
      if (s.startUtc !== null && typeof s.startUtc !== 'string') return null
      sessions.push({ session: s.session, startUtc: s.startUtc })
    }
    const ev: ScheduleEvent = { round: e.round as number, slug: e.slug, event: e.event, country: e.country, sessions }
    if (typeof e.dateStart === 'string') ev.dateStart = e.dateStart
    events.push(ev)
  }
  return { season, events }
}

const JOB_STATES: readonly JobState[] = ['queued', 'running', 'done', 'error', 'cancelled']

export function parseJob(v: unknown): Job | null {
  if (!isObj(v) || typeof v.id !== 'string' || !Number.isInteger(v.season) || !Number.isInteger(v.round)) return null
  if (!isSessionType(v.session) || !JOB_STATES.includes(v.state as JobState)) return null
  const err = isObj(v.error) ? v.error : null
  const res = isObj(v.result) ? v.result : null
  return {
    id: v.id,
    season: v.season as number,
    round: v.round as number,
    session: v.session,
    state: v.state as JobState,
    pct: typeof v.pct === 'number' && Number.isFinite(v.pct) ? Math.min(100, Math.max(0, v.pct)) : 0,
    phase: v.phase === 'download' || v.phase === 'process' ? v.phase : null,
    error: err
      ? {
          code: JOB_ERROR_CODES.includes(err.code as JobErrorCode) ? (err.code as JobErrorCode) : 'failed',
          message: typeof err.message === 'string' ? err.message : '',
        }
      : null,
    result: res
      ? {
          session: typeof res.session === 'string' ? res.session : null,
          status: typeof res.status === 'string' ? res.status : '',
          bytes: typeof res.bytes === 'number' ? res.bytes : null,
        }
      : null,
    createdAt: typeof v.createdAt === 'string' ? v.createdAt : '',
    log: Array.isArray(v.log) ? v.log.filter((l): l is string => typeof l === 'string') : undefined,
  }
}
