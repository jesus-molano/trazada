import { defineStore } from 'pinia'
import { shallowRef } from 'vue'
import {
  type Job,
  type JobErrorCode,
  type JobRequest,
  JOB_ERROR_CODES,
  jobKey,
  parseJob,
  parseSchedule,
  type Schedule,
} from '~/manager/model'
import { useCatalogStore } from '~/stores/catalog'

/** Cabecera que exige la API local (una web ajena no puede enviarla sin un preflight CORS que nunca se concede). */
const HEADERS = { 'X-Trazada': '1' }
const POLL_MS = 1000

export interface ScheduleState {
  status: 'loading' | 'ready' | 'error'
  schedule: Schedule | null
  error: JobErrorCode | null
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * Gestor de datos local (D26): solo existe con `pnpm local` (la API responde en el propio PC). Calendario por
 * temporada, cola de descargas y sondeo mientras hay trabajo. Estado grueso: nada por frame.
 */
export const useManagerStore = defineStore('manager', () => {
  const status = ref<'unknown' | 'checking' | 'available' | 'unavailable'>('unknown')
  const available = computed(() => status.value === 'available')
  const schedules = shallowRef<Record<number, ScheduleState>>({})
  const jobs = shallowRef<Job[]>([])
  const jobsByKey = computed(() => new Map(jobs.value.map((j) => [jobKey(j), j])))
  /** Fallo al encolar o cancelar (el servidor local se ha parado, p. ej.). */
  const actionError = ref(false)

  let detecting: Promise<void> | null = null
  let subscribers = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  const doneSeen = new Set<string>()

  function api(path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(path, { ...init, cache: 'no-store', headers: { ...HEADERS, ...(init.headers ?? {}) } })
  }

  function detect(): Promise<void> {
    detecting ??= (async () => {
      status.value = 'checking'
      try {
        const res = await api('/api/status')
        const body: unknown = res.ok ? await res.json() : null
        status.value = isObj(body) && body.manager === true ? 'available' : 'unavailable'
      } catch {
        status.value = 'unavailable'
      }
    })()
    return detecting
  }

  function setSchedule(season: number, state: ScheduleState) {
    schedules.value = { ...schedules.value, [season]: state }
  }

  async function loadSchedule(season: number, refresh = false): Promise<void> {
    if (!available.value) return
    const current = schedules.value[season]
    if (current?.status === 'loading' || (current?.status === 'ready' && !refresh)) return
    setSchedule(season, { status: 'loading', schedule: current?.schedule ?? null, error: null })
    try {
      const res = await api(`/api/schedule?season=${season}${refresh ? '&refresh=1' : ''}`)
      const body: unknown = await res.json().catch(() => null)
      if (!res.ok) {
        const code = isObj(body) && isObj(body.error) ? body.error.code : null
        throw new Error(JOB_ERROR_CODES.includes(code as JobErrorCode) ? (code as string) : 'failed')
      }
      const schedule = parseSchedule(body, season)
      if (!schedule) throw new Error('failed')
      setSchedule(season, { status: 'ready', schedule, error: null })
    } catch (err) {
      const code = err instanceof Error && JOB_ERROR_CODES.includes(err.message as JobErrorCode) ? err.message : 'failed'
      setSchedule(season, { status: 'error', schedule: current?.schedule ?? null, error: code as JobErrorCode })
    }
  }

  function setJobs(list: Job[]) {
    jobs.value = list
    let fresh = false
    for (const j of list) {
      if (j.state === 'done' && !doneSeen.has(j.id)) {
        doneSeen.add(j.id)
        fresh = true
      }
    }
    // Una sesión recién generada: el pipeline ya ha actualizado catalog.json.
    if (fresh) void useCatalogStore().refresh()
  }

  async function refreshJobs(): Promise<void> {
    try {
      const res = await api('/api/jobs')
      if (!res.ok) return
      const body: unknown = await res.json()
      if (!isObj(body) || !Array.isArray(body.jobs)) return
      setJobs(body.jobs.map(parseJob).filter((j): j is Job => j !== null))
    } catch {
      // el siguiente sondeo lo reintenta
    }
  }

  const hasActive = () => jobs.value.some((j) => j.state === 'queued' || j.state === 'running')

  function poll() {
    if (timer || subscribers === 0 || !hasActive()) return
    timer = setTimeout(async () => {
      timer = null
      await refreshJobs()
      poll()
    }, POLL_MS)
  }

  async function send(path: string, init: RequestInit): Promise<void> {
    actionError.value = false
    try {
      const res = await api(path, init)
      if (!res.ok) actionError.value = true
    } catch {
      actionError.value = true
    }
    await refreshJobs()
    poll()
  }

  function enqueue(items: JobRequest[]): Promise<void> {
    if (!items.length) return Promise.resolve()
    return send('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobs: items }),
    })
  }

  /** Cancela un trabajo en cola o en curso (o lo quita de la lista si ya terminó). */
  function cancel(id: string): Promise<void> {
    return send(`/api/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

  async function cancelAll(): Promise<void> {
    const active = jobs.value.filter((j) => j.state === 'queued' || j.state === 'running')
    // Primero los de la cola: si se cancela antes el que corre, arrancaría el siguiente.
    for (const j of active.sort((a, b) => Number(a.state === 'running') - Number(b.state === 'running'))) {
      await cancel(j.id)
    }
  }

  /** El selector se suscribe al montarse: detecta el gestor y sondea la cola mientras haya alguien mirando. */
  function subscribe(): () => void {
    subscribers++
    void detect().then(async () => {
      if (!available.value || subscribers === 0) return
      await refreshJobs()
      poll()
    })
    return () => {
      subscribers--
      if (subscribers === 0 && timer) {
        clearTimeout(timer)
        timer = null
      }
    }
  }

  return {
    status,
    available,
    schedules,
    jobs,
    jobsByKey,
    actionError,
    loadSchedule,
    enqueue,
    cancel,
    cancelAll,
    subscribe,
  }
})
