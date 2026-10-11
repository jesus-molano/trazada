// Servidor local de Trazada (D23, D25, D26): sirve la app generada, los datos de data/ en /data y, solo para
// este PC, la API del gestor de datos (calendario por temporada y descargas en cola con el pipeline).
//
// La API ejecuta el pipeline, así que solo atiende peticiones:
//   - desde el propio equipo (loopback), aunque el servidor escuche en la red de casa (--lan);
//   - con Host de loopback y el puerto del servidor (contra DNS rebinding);
//   - del mismo origen (Origin y Sec-Fetch-Site, si llegan) y con la cabecera X-Trazada: una web ajena no
//     puede enviarla sin un preflight CORS, y este servidor nunca lo concede;
//   - con temporada, ronda y tipo de sesión validados. El pipeline se lanza sin shell, con argumentos fijos.
import { spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { createInterface } from 'node:readline'

export const SESSION_TYPES = Object.freeze(['fp1', 'fp2', 'fp3', 'sq', 'sprint', 'q', 'race'])
/** Primera temporada con datos de posición en FastF1. */
export const MIN_SEASON = 2018
export const API_HEADER = 'x-trazada'
export const ERROR_CODES = Object.freeze([
  'empty',
  'network',
  'ratelimit',
  'failed',
  'timeout',
  'pipeline',
  'cancelled',
])

const MAX_BODY = 64 * 1024
const MAX_BATCH = 200
const MAX_JOBS = 500
const LOG_LINES = 200
const LOG_TAIL = 40
/** Longitud máxima de una línea de registro (y de un mensaje de error) que se guarda. */
const MAX_LINE = 2000
/** Longitud máxima de una línea de salida del pipeline (el calendario va en una sola línea JSON de ~10 KB). */
const MAX_OUTPUT_LINE = 1024 * 1024
const SCHEDULE_TTL_MS = 6 * 3600_000
const SCHEDULE_TIMEOUT_MS = 3 * 60_000
const BUILD_TIMEOUT_MS = 60 * 60_000
const KILL_GRACE_MS = 5_000

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.gz': 'application/gzip',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.glb': 'model/gltf-binary',
  '.wasm': 'application/wasm',
  '.ico': 'image/x-icon',
}

/** Ruta del fichero dentro de `root`, o null si la URL sale de él (o no se puede decodificar). */
export function resolveStatic(root, pathname) {
  let decoded
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  if (decoded.includes('\0')) return null
  const path = normalize(join(root, decoded))
  return path === root || path.startsWith(root.endsWith(sep) ? root : root + sep) ? path : null
}

export function isLoopbackAddress(address) {
  if (typeof address !== 'string') return false
  const a = address.startsWith('::ffff:') ? address.slice(7) : address
  return a === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(a)
}

/** Motivo por el que se rechaza una petición a la API, o null si se acepta. */
export function apiRejection(req, port) {
  if (!isLoopbackAddress(req.socket?.remoteAddress)) return 'remote'
  const host = String(req.headers.host ?? '').toLowerCase()
  if (![`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(host)) return 'host'
  if (req.headers[API_HEADER] !== '1') return 'header'
  const origin = req.headers.origin
  if (origin !== undefined && origin !== `http://${host}`) return 'origin'
  const site = req.headers['sec-fetch-site']
  if (site !== undefined && site !== 'same-origin') return 'site'
  return null
}

function maxSeason(now) {
  return now.getUTCFullYear() + 1
}

export function parseSeason(value, now = new Date()) {
  if (typeof value !== 'string' || !/^\d{4}$/.test(value)) return null
  const season = Number(value)
  return season >= MIN_SEASON && season <= maxSeason(now) ? season : null
}

/** Una petición de descarga validada ({season, round, session}) o null. */
export function parseJobItem(value, now = new Date()) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const { season, round, session } = value
  if (!Number.isInteger(season) || season < MIN_SEASON || season > maxSeason(now)) return null
  if (!Number.isInteger(round) || round < 1 || round > 40) return null
  if (typeof session !== 'string' || !SESSION_TYPES.includes(session)) return null
  return { season, round, session }
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SESSION_ID = /^\d{4}\/\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*\/(?:fp1|fp2|fp3|sq|sprint|q|race)$/

const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '')

/** Calendario que devuelve `trazada schedule`, validado y reducido a los campos que usa la interfaz. */
export function parseSchedule(doc, season) {
  if (!doc || typeof doc !== 'object' || doc.season !== season || !Array.isArray(doc.events)) return null
  const events = []
  for (const e of doc.events) {
    if (!e || typeof e !== 'object') return null
    if (!Number.isInteger(e.round) || e.round < 1 || e.round > 40) return null
    if (typeof e.slug !== 'string' || e.slug.length > 64 || !SLUG.test(e.slug)) return null
    if (typeof e.event !== 'string' || typeof e.country !== 'string' || !Array.isArray(e.sessions)) return null
    const sessions = []
    for (const s of e.sessions) {
      if (!s || typeof s !== 'object' || !SESSION_TYPES.includes(s.session)) return null
      const start = s.startUtc
      if (start !== null && (typeof start !== 'string' || Number.isNaN(Date.parse(start)))) return null
      if (!sessions.some((x) => x.session === s.session)) sessions.push({ session: s.session, startUtc: start })
    }
    const out = { round: e.round, slug: e.slug, event: text(e.event, 120), country: text(e.country, 80), sessions }
    if (typeof e.dateStart === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.dateStart)) out.dateStart = e.dateStart
    events.push(out)
  }
  return { season, events }
}

/** Línea de evento del pipeline (`::progress {...}`, `::result {...}`, `::error {...}`) o null. */
export function parseEventLine(line) {
  const m = /^::(progress|result|error) (\{.*\})\s*$/.exec(line)
  if (!m) return null
  try {
    const payload = JSON.parse(m[2])
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? { kind: m[1], payload } : null
  } catch {
    return null
  }
}

function pipelineError(payload) {
  const code = ERROR_CODES.includes(payload?.code) ? payload.code : 'failed'
  return { code, message: text(payload?.message, MAX_LINE) }
}

function lastLine(lines) {
  for (let i = lines.length - 1; i >= 0; i--) if (lines[i].trim()) return lines[i].trim()
  return ''
}

/** Orden que mata un árbol de procesos en Windows (uv.exe → trazada.exe → python.exe). */
export function windowsTreeKill(pid) {
  return ['taskkill', ['/pid', String(pid), '/T', '/F']]
}

function killQuietly(child, sig) {
  try {
    child.kill(sig)
  } catch {
    // ya había terminado
  }
}

/**
 * Lanza el pipeline con argumentos fijos y sin shell. `onLine(line, stream)` recibe cada línea de salida.
 * Devuelve `{ done, kill }`: `done` se resuelve con `{ code, signal, spawnError, timedOut }` y nunca se queda
 * colgado: si tras matar el proceso algún nieto mantiene abiertas las tuberías, se da por terminado igualmente.
 * `pipeline.platform` y `pipeline.killGraceMs` solo existen para los tests.
 */
function runPipeline(pipeline, args, { onLine, timeoutMs }) {
  const platform = pipeline.platform ?? process.platform
  const graceMs = pipeline.killGraceMs ?? KILL_GRACE_MS
  let child = null
  let timedOut = false
  let finished = false
  let killRequested = false
  let exit = null
  let closedStreams = 0
  let resolveDone
  const done = new Promise((r) => {
    resolveDone = r
  })
  const timers = new Set()
  const later = (fn, ms) => {
    const timer = setTimeout(fn, ms)
    timer.unref?.()
    timers.add(timer)
  }
  const finish = (result) => {
    if (finished) return
    finished = true
    for (const timer of timers) clearTimeout(timer)
    resolveDone(result)
  }
  const settle = () => {
    if (exit !== null && closedStreams >= 2) finish({ ...exit, timedOut })
  }

  function signalChild(sig) {
    if (!child?.pid || finished) return
    if (platform === 'win32') {
      // child.kill solo mataría uv.exe: trazada.exe y python.exe seguirían vivos y con las tuberías abiertas.
      try {
        const [cmd, cmdArgs] = windowsTreeKill(child.pid)
        spawn(cmd, cmdArgs, { stdio: 'ignore', windowsHide: true, shell: false }).on('error', () =>
          killQuietly(child, sig),
        )
      } catch {
        killQuietly(child, sig)
      }
      return
    }
    try {
      // Grupo de procesos propio (detached): se para también el Python que lanza `uv run`.
      process.kill(-child.pid, sig)
    } catch {
      killQuietly(child, sig)
    }
  }

  function kill() {
    if (finished || killRequested) return
    killRequested = true
    signalChild('SIGTERM')
    later(() => {
      signalChild('SIGKILL')
      later(() => finish({ ...(exit ?? { code: null, signal: 'SIGKILL', spawnError: null }), timedOut }), graceMs)
    }, graceMs)
  }

  try {
    child = spawn(pipeline.command, [...pipeline.args, ...args], {
      cwd: pipeline.cwd,
      env: {
        ...process.env,
        ...pipeline.env,
        PYTHONUNBUFFERED: '1',
        PYTHONIOENCODING: 'utf-8',
        // Modo UTF-8 de Python: en Windows, open() sin codificación usaría cp1252.
        PYTHONUTF8: '1',
        NO_COLOR: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true,
      detached: platform !== 'win32',
    })
  } catch (err) {
    finish({ code: null, signal: null, spawnError: err, timedOut })
    return { done, kill }
  }
  for (const [stream, name] of [
    [child.stdout, 'stdout'],
    [child.stderr, 'stderr'],
  ]) {
    stream.setEncoding('utf8')
    const rl = createInterface({ input: stream, crlfDelay: Infinity })
    rl.on('line', (line) => onLine(line.slice(0, MAX_OUTPUT_LINE), name))
    rl.on('close', () => {
      closedStreams++
      settle()
    })
  }
  child.on('error', (err) => finish({ code: null, signal: null, spawnError: err, timedOut }))
  child.on('exit', (code, signal) => {
    exit = { code, signal, spawnError: null }
    settle()
  })
  later(() => {
    timedOut = true
    kill()
  }, timeoutMs)
  return { done, kill }
}

function publicJob(job) {
  const out = {
    id: job.id,
    season: job.season,
    round: job.round,
    session: job.session,
    state: job.state,
    pct: job.pct,
    phase: job.phase,
    step: job.step,
    error: job.error,
    result: job.result,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  }
  if (job.state === 'error') out.log = job.log.slice(-LOG_TAIL)
  return out
}

/**
 * Cola de descargas: una sesión a la vez (FastF1 y su caché no se comparten bien entre procesos).
 * `pipeline` = { command, args, cwd, env } (p. ej. `uv run trazada` en pipeline/).
 */
export function createJobQueue({ pipeline, dataDir, timeoutMs = BUILD_TIMEOUT_MS, now = () => new Date() }) {
  const jobs = []
  let seq = 0
  let running = null

  const keyOf = (j) => `${j.season}-${j.round}-${j.session}`

  function prune() {
    while (jobs.length > MAX_JOBS) {
      const i = jobs.findIndex((j) => j.state !== 'queued' && j.state !== 'running')
      if (i < 0) break
      jobs.splice(i, 1)
    }
  }

  function enqueue(items) {
    const out = []
    for (const item of items) {
      const key = keyOf(item)
      const active = jobs.find((j) => keyOf(j) === key && (j.state === 'queued' || j.state === 'running'))
      if (active) {
        out.push(active)
        continue
      }
      // Un reintento sustituye al intento anterior: como mucho un trabajo por sesión.
      for (let i = jobs.length - 1; i >= 0; i--) if (keyOf(jobs[i]) === key) jobs.splice(i, 1)
      const job = {
        ...item,
        id: String(++seq),
        state: 'queued',
        pct: 0,
        phase: null,
        step: null,
        error: null,
        result: null,
        log: [],
        createdAt: now().toISOString(),
        startedAt: null,
        finishedAt: null,
        handle: null,
        cancelled: false,
      }
      jobs.push(job)
      out.push(job)
    }
    prune()
    pump()
    return out.map(publicJob)
  }

  function finish(job, state, error = null) {
    job.state = state
    job.error = error
    job.finishedAt = now().toISOString()
    job.handle = null
  }

  function pump() {
    if (running) return
    const job = jobs.find((j) => j.state === 'queued')
    if (!job) return
    running = job
    job.state = 'running'
    job.startedAt = now().toISOString()
    const args = [
      'build',
      String(job.season),
      String(job.round),
      job.session,
      '--data',
      dataDir,
      '--progress',
    ]
    job.handle = runPipeline(pipeline, args, {
      timeoutMs,
      onLine(line, stream) {
        const ev = stream === 'stdout' ? parseEventLine(line) : null
        if (ev?.kind === 'progress') {
          const pct = Math.round(Number(ev.payload.pct))
          if (Number.isFinite(pct)) job.pct = Math.max(job.pct, Math.min(99, Math.max(0, pct)))
          if (ev.payload.phase === 'download' || ev.payload.phase === 'process') job.phase = ev.payload.phase
          if (typeof ev.payload.step === 'string' && /^[a-z]{1,16}$/.test(ev.payload.step)) {
            job.step = ev.payload.step
          }
          return
        }
        if (ev?.kind === 'result') {
          const session = ev.payload.session
          job.result = {
            session: typeof session === 'string' && SESSION_ID.test(session) ? session : null,
            status: text(ev.payload.status, 32),
            bytes: Number.isFinite(ev.payload.bytes) ? ev.payload.bytes : null,
            // Sesión de desarrollo (p. ej. circuito con fuentes dev): la insignia DEV sale ya antes de releer el catálogo.
            dev: ev.payload.dev === true,
          }
          return
        }
        if (ev?.kind === 'error') {
          job.error = pipelineError(ev.payload)
          return
        }
        job.log.push(line.slice(0, MAX_LINE))
        if (job.log.length > LOG_LINES) job.log.splice(0, job.log.length - LOG_LINES)
      },
    })
    void job.handle.done.then(({ code, spawnError, timedOut }) => {
      if (job.cancelled) finish(job, 'cancelled', { code: 'cancelled', message: '' })
      else if (spawnError) finish(job, 'error', { code: 'pipeline', message: text(spawnError.message, MAX_LINE) })
      else if (timedOut) finish(job, 'error', { code: 'timeout', message: '' })
      else if (code === 0 && job.result) {
        job.pct = 100
        finish(job, 'done')
      } else finish(job, 'error', job.error ?? { code: 'failed', message: lastLine(job.log) })
      running = null
      pump()
    })
  }

  /**
   * Cancela un trabajo en cola o en curso. Si ya terminó no hace nada: un «Cancelar» que llega justo después de
   * acabar no debe borrar el resultado (la interfaz no releería el catálogo ni vería el error).
   */
  function remove(id) {
    const job = jobs.find((j) => j.id === id)
    if (!job) return false
    if (job.state === 'queued') finish(job, 'cancelled', { code: 'cancelled', message: '' })
    else if (job.state === 'running') {
      job.cancelled = true
      job.handle?.kill()
    }
    return true
  }

  return {
    enqueue,
    remove,
    list: () => jobs.map(publicJob),
    close() {
      for (const j of jobs) if (j.state === 'queued') finish(j, 'cancelled', { code: 'cancelled', message: '' })
      running?.handle?.kill()
    },
  }
}

/** Calendarios por temporada, en memoria (el pipeline tarda unos segundos en arrancar). */
export function createScheduleCache({ pipeline, cacheDir, timeoutMs = SCHEDULE_TIMEOUT_MS, ttlMs = SCHEDULE_TTL_MS }) {
  const entries = new Map()

  const running = new Set()

  async function fetchSchedule(season) {
    const out = []
    const err = []
    const args = ['schedule', String(season)]
    if (cacheDir) args.push('--cache', cacheDir)
    const handle = runPipeline(pipeline, args, {
      timeoutMs,
      onLine: (line, stream) => (stream === 'stdout' ? out : err).push(line),
    })
    running.add(handle)
    let result
    try {
      result = await handle.done
    } finally {
      running.delete(handle)
    }
    const { code, spawnError, timedOut } = result
    if (spawnError) return { error: { code: 'pipeline', message: text(spawnError.message, MAX_LINE) } }
    if (timedOut) return { error: { code: 'timeout', message: '' } }
    const errorLine = out.map(parseEventLine).find((ev) => ev?.kind === 'error')
    if (code !== 0) {
      return { error: errorLine ? pipelineError(errorLine.payload) : { code: 'failed', message: lastLine(err) } }
    }
    const json = [...out].reverse().find((l) => l.startsWith('{'))
    let doc = null
    try {
      doc = json ? parseSchedule(JSON.parse(json), season) : null
    } catch {
      doc = null
    }
    return doc ? { value: doc } : { error: { code: 'failed', message: 'calendario no válido' } }
  }

  return {
    get(season, { refresh = false } = {}) {
      const entry = entries.get(season)
      if (entry?.pending) return entry.pending
      if (entry?.value && !refresh && Date.now() - entry.at < ttlMs) return Promise.resolve({ value: entry.value })
      const pending = fetchSchedule(season)
        .catch((err) => ({ error: { code: 'failed', message: text(String(err), MAX_LINE) } }))
        .then((result) => {
          // Solo se guarda un calendario válido: un error se vuelve a intentar en la siguiente petición.
          entries.set(season, result.value ? { value: result.value, at: Date.now() } : { ...entry, pending: null })
          return result
        })
      entries.set(season, { ...entry, pending })
      return pending
    },
    /** Para los calendarios que se estén descargando (al cerrar el servidor). */
    close() {
      for (const handle of running) handle.kill()
    },
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(JSON.stringify(body))
}

function readJson(req) {
  return new Promise((resolveBody) => {
    let size = 0
    let tooLarge = false
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      // Pasado el límite se sigue leyendo (para poder responder) pero no se guarda nada.
      if (size > MAX_BODY) {
        tooLarge = true
        chunks.length = 0
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (tooLarge) return resolveBody({ error: 'too-large' })
      try {
        resolveBody({ value: JSON.parse(Buffer.concat(chunks).toString('utf8')) })
      } catch {
        resolveBody({ error: 'json' })
      }
    })
    req.on('error', () => resolveBody({ error: 'read' }))
  })
}

/**
 * Servidor local. `manager` (opcional) = { pipeline, scheduleCacheDir?, buildTimeoutMs? }: sin él, solo
 * estático (como en los e2e).
 */
export function createLocalServer({ appDir, dataDir, manager = null }) {
  const app = resolve(appDir)
  const data = resolve(dataDir)
  const queue = manager
    ? createJobQueue({ pipeline: manager.pipeline, dataDir: data, timeoutMs: manager.buildTimeoutMs })
    : null
  const schedules = manager
    ? createScheduleCache({ pipeline: manager.pipeline, cacheDir: manager.scheduleCacheDir })
    : null

  async function serveStatic(req, res, url) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' })
      res.end()
      return
    }
    let root = app
    let path = url.pathname
    if (path === '/data' || path.startsWith('/data/')) {
      root = data
      path = path.slice('/data'.length) || '/'
    }
    let file = resolveStatic(root, path)
    let info = file ? await stat(file).catch(() => null) : null
    if (file && info?.isDirectory()) {
      file = join(file, 'index.html')
      info = await stat(file).catch(() => null)
    }
    if (!file || !info?.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('not found')
      return
    }
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'content-length': info.size,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    })
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    createReadStream(file)
      .on('error', () => res.destroy())
      .pipe(res)
  }

  async function serveApi(req, res, url, port) {
    if (!queue || !schedules) return sendJson(res, 404, { error: 'not-found' })
    const rejection = apiRejection(req, port)
    if (rejection) return sendJson(res, 403, { error: 'forbidden', reason: rejection })
    const route = url.pathname
    if (route === '/api/status' && req.method === 'GET') {
      return sendJson(res, 200, { manager: true, version: 1, minSeason: MIN_SEASON })
    }
    if (route === '/api/schedule' && req.method === 'GET') {
      const season = parseSeason(url.searchParams.get('season'))
      if (season === null) return sendJson(res, 400, { error: 'season' })
      const result = await schedules.get(season, { refresh: url.searchParams.get('refresh') === '1' })
      return result.value ? sendJson(res, 200, result.value) : sendJson(res, 502, { error: result.error })
    }
    if (route === '/api/jobs' && req.method === 'GET') return sendJson(res, 200, { jobs: queue.list() })
    if (route === '/api/jobs' && req.method === 'POST') {
      if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) {
        return sendJson(res, 415, { error: 'content-type' })
      }
      const body = await readJson(req)
      if (body.error) return sendJson(res, body.error === 'too-large' ? 413 : 400, { error: body.error })
      const list = body.value?.jobs
      if (!Array.isArray(list) || list.length === 0 || list.length > MAX_BATCH) {
        return sendJson(res, 400, { error: 'jobs' })
      }
      const items = list.map((item) => parseJobItem(item))
      if (items.some((item) => item === null)) return sendJson(res, 400, { error: 'job' })
      return sendJson(res, 202, { jobs: queue.enqueue(items) })
    }
    const m = /^\/api\/jobs\/(\d{1,9})$/.exec(route)
    if (m && req.method === 'DELETE') {
      return queue.remove(m[1]) ? sendJson(res, 200, { ok: true }) : sendJson(res, 404, { error: 'job' })
    }
    return sendJson(res, 404, { error: 'not-found' })
  }

  const server = createServer((req, res) => {
    let url
    try {
      url = new URL(req.url ?? '/', 'http://localhost')
    } catch {
      res.writeHead(400)
      res.end()
      return
    }
    const port = server.address()?.port
    const handler =
      url.pathname === '/api' || url.pathname.startsWith('/api/')
        ? serveApi(req, res, url, port)
        : serveStatic(req, res, url)
    handler.catch(() => {
      if (!res.headersSent) sendJson(res, 500, { error: 'internal' })
      else res.destroy()
    })
  })
  /** Para el servidor y cancela las descargas (también el proceso en curso). */
  server.shutdown = () => {
    queue?.close()
    schedules?.close()
    server.close()
    server.closeAllConnections?.()
  }
  return server
}
