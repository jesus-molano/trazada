/** Servidor local (scripts/local-server.mjs): estático seguro y API del gestor de datos con un pipeline falso. */
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { request, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  apiRejection,
  createJobQueue,
  createLocalServer,
  isLoopbackAddress,
  parseEventLine,
  parseJobItem,
  parseSchedule,
  parseSeason,
  resolveStatic,
  windowsTreeKill,
  // @ts-expect-error módulo JS de scripts/ sin tipos
} from '../../../../scripts/local-server.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const FIXTURE_DATA = resolve(here, '../fixtures/data')
const FAKE = resolve(here, '../fixtures/fake-pipeline.mjs')

interface Res {
  status: number
  headers: Record<string, string | string[] | undefined>
  body: string
  json: () => any // eslint-disable-line @typescript-eslint/no-explicit-any
}

function call(
  port: number,
  path: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string; api?: boolean } = {},
): Promise<Res> {
  const headers: Record<string, string> = {
    host: `127.0.0.1:${port}`,
    ...(opts.api === false ? {} : { 'x-trazada': '1' }),
    ...opts.headers,
  }
  return new Promise((resolveRes, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: opts.method ?? 'GET', headers }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8')
        resolveRes({ status: res.statusCode ?? 0, headers: res.headers, body, json: () => JSON.parse(body) })
      })
    })
    req.on('error', reject)
    if (opts.body !== undefined) req.write(opts.body)
    req.end()
  })
}

const postJobs = (port: number, jobs: unknown, headers: Record<string, string> = {}) =>
  call(port, '/api/jobs', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ jobs }),
  })

async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, timeoutMs = 10_000): Promise<T> {
  const start = Date.now()
  for (;;) {
    const value = await fn()
    if (value) return value
    if (Date.now() - start > timeoutMs) throw new Error('timeout esperando la condición')
    await new Promise((r) => setTimeout(r, 30))
  }
}

/** ¿Sigue vivo? Un zombi (muerto pero sin recoger por su nuevo padre) cuenta como muerto. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
  } catch {
    return false
  }
  try {
    return !/^\d+ \(.*\) Z/.test(readFileSync(`/proc/${pid}/stat`, 'utf8'))
  } catch {
    return true
  }
}

async function jobOf(port: number, id: string) {
  const res = await call(port, '/api/jobs')
  return (res.json().jobs as { id: string; state: string }[]).find((j) => j.id === id)
}

describe('validación y rutas (puro)', () => {
  it('resolveStatic no sale de la raíz (tampoco a carpetas hermanas con el mismo prefijo)', () => {
    const root = resolve('/srv/app/public')
    expect(resolveStatic(root, '/index.html')).toBe(join(root, 'index.html'))
    expect(resolveStatic(root, '/../public-secret/x')).toBeNull()
    expect(resolveStatic(root, '/%2e%2e/%2e%2e/etc/passwd')).toBeNull()
    expect(resolveStatic(root, '/%E0%A4%A')).toBeNull()
    expect(resolveStatic(root, '/a%00b')).toBeNull()
  })

  it('loopback', () => {
    expect(isLoopbackAddress('127.0.0.1')).toBe(true)
    expect(isLoopbackAddress('::1')).toBe(true)
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true)
    expect(isLoopbackAddress('192.168.1.20')).toBe(false)
    expect(isLoopbackAddress('::ffff:192.168.1.20')).toBe(false)
    expect(isLoopbackAddress(undefined)).toBe(false)
  })

  it('apiRejection: solo loopback, Host del propio servidor, mismo origen y cabecera X-Trazada', () => {
    const req = (headers: Record<string, string>, remoteAddress = '127.0.0.1') => ({
      socket: { remoteAddress },
      headers: { host: '127.0.0.1:3000', 'x-trazada': '1', ...headers },
    })
    expect(apiRejection(req({}), 3000)).toBeNull()
    expect(apiRejection(req({ host: 'localhost:3000', origin: 'http://localhost:3000' }), 3000)).toBeNull()
    expect(apiRejection(req({ 'sec-fetch-site': 'same-origin' }), 3000)).toBeNull()
    expect(apiRejection(req({}, '192.168.1.20'), 3000)).toBe('remote')
    expect(apiRejection(req({ host: 'evil.example:3000' }), 3000)).toBe('host')
    expect(apiRejection(req({ host: '127.0.0.1:3001' }), 3000)).toBe('host')
    expect(apiRejection(req({ 'x-trazada': '' }), 3000)).toBe('header')
    expect(apiRejection(req({ origin: 'http://evil.example' }), 3000)).toBe('origin')
    expect(apiRejection(req({ origin: 'null' }), 3000)).toBe('origin')
    expect(apiRejection(req({ 'sec-fetch-site': 'cross-site' }), 3000)).toBe('site')
  })

  it('parseJobItem y parseSeason solo aceptan valores acotados', () => {
    const now = new Date('2026-10-10T12:00:00Z')
    expect(parseJobItem({ season: 2026, round: 10, session: 'fp1' }, now)).toEqual({
      season: 2026,
      round: 10,
      session: 'fp1',
    })
    for (const bad of [
      { season: '2026', round: 10, session: 'fp1' },
      { season: 2017, round: 10, session: 'fp1' },
      { season: 2028, round: 10, session: 'fp1' },
      { season: 2026, round: 0, session: 'fp1' },
      { season: 2026, round: 10.5, session: 'fp1' },
      { season: 2026, round: 10, session: 'fp1; rm -rf ~' },
      { season: 2026, round: 10, session: '--data=/etc' },
      [2026, 10, 'fp1'],
      null,
    ]) {
      expect(parseJobItem(bad, now)).toBeNull()
    }
    expect(parseSeason('2026', now)).toBe(2026)
    expect(parseSeason('2026 ', now)).toBeNull()
    expect(parseSeason('1999', now)).toBeNull()
    expect(parseSeason(null, now)).toBeNull()
  })

  it('parseSchedule descarta calendarios con slugs o sesiones raros', () => {
    const ok = {
      season: 2026,
      events: [{ round: 1, slug: 'melbourne', event: 'A', country: 'B', sessions: [{ session: 'fp1', startUtc: null }] }],
    }
    expect(parseSchedule(ok, 2026)?.events).toHaveLength(1)
    expect(parseSchedule(ok, 2025)).toBeNull()
    const bad = (patch: object) => ({ ...ok, events: [{ ...ok.events[0], ...patch }] })
    expect(parseSchedule(bad({ slug: '../x' }), 2026)).toBeNull()
    expect(parseSchedule(bad({ sessions: [{ session: 'fp9', startUtc: null }] }), 2026)).toBeNull()
    expect(parseSchedule(bad({ sessions: [{ session: 'fp1', startUtc: 'mañana' }] }), 2026)).toBeNull()
  })

  it('parseEventLine', () => {
    expect(parseEventLine('::progress {"pct": 40}')).toEqual({ kind: 'progress', payload: { pct: 40 } })
    expect(parseEventLine('::result {"session": "x"}')?.kind).toBe('result')
    expect(parseEventLine('::progress [1]')).toBeNull()
    expect(parseEventLine('::other {}')).toBeNull()
    expect(parseEventLine('INFO ::progress {"pct": 1}')).toBeNull()
    expect(parseEventLine('::error {roto')).toBeNull()
  })
})

describe('servidor local con el gestor (pipeline falso)', () => {
  let root: string
  let data: string
  let app: string
  let cache: string
  let server: Server & { shutdown: () => void }
  let port: number

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'trazada-local-'))
    data = join(root, 'data')
    app = join(root, 'public')
    cache = join(root, 'cache')
    cpSync(FIXTURE_DATA, data, { recursive: true })
    mkdirSync(app)
    mkdirSync(cache)
    writeFileSync(join(app, 'index.html'), '<!doctype html><title>Trazada</title>')
    writeFileSync(join(root, 'secret.txt'), 'no')
    mkdirSync(join(data, 'v1', 'radio-test'), { recursive: true })
    writeFileSync(join(data, 'v1', 'radio-test', '0123456789abcdef.mp3'), Buffer.from('ID3'))
    process.env.FAKE_STEP_MS = '40'
    server = createLocalServer({
      appDir: app,
      dataDir: data,
      manager: {
        pipeline: { command: process.execPath, args: [FAKE], cwd: root },
        scheduleCacheDir: cache,
      },
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    port = (server.address() as AddressInfo).port
  })

  afterAll(() => {
    server.shutdown()
    rmSync(root, { recursive: true, force: true })
  })

  afterEach(() => {
    delete process.env.FAKE_SCHEDULE_FAIL
  })

  it('sirve la app y los datos, y nada fuera de ellos', async () => {
    expect((await call(port, '/', { api: false })).body).toContain('Trazada')
    const catalog = await call(port, '/data/v1/catalog.json', { api: false })
    expect(catalog.status).toBe(200)
    expect(catalog.headers['content-type']).toContain('application/json')
    // Los clips de la radio (D51), como audio.
    const clip = await call(port, '/data/v1/radio-test/0123456789abcdef.mp3', { api: false })
    expect(clip.status).toBe(200)
    expect(clip.headers['content-type']).toBe('audio/mpeg')
    expect((await call(port, '/data/../secret.txt', { api: false })).status).toBe(404)
    expect((await call(port, '/%2e%2e/secret.txt', { api: false })).status).toBe(404)
    expect((await call(port, '/data/%2e%2e/%2e%2e/secret.txt', { api: false })).status).toBe(404)
    expect((await call(port, '/%E0%A4%A', { api: false })).status).toBe(404)
    expect((await call(port, '/', { api: false, method: 'POST' })).status).toBe(405)
  })

  it('la API rechaza peticiones sin la cabecera, con otro Host o de otro origen', async () => {
    expect((await call(port, '/api/status', { api: false })).status).toBe(403)
    expect((await call(port, '/api/status', { headers: { host: 'attacker.example' } })).status).toBe(403)
    expect((await call(port, '/api/status', { headers: { origin: 'http://attacker.example' } })).status).toBe(403)
    const ok = await call(port, '/api/status')
    expect(ok.status).toBe(200)
    expect(ok.json()).toMatchObject({ manager: true })
    expect(ok.headers['access-control-allow-origin']).toBeUndefined()
    const preflight = await call(port, '/api/jobs', { method: 'OPTIONS', headers: { origin: 'http://attacker.example' } })
    expect(preflight.status).toBe(403)
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('calendario: validado, en caché y con refresco a demanda', async () => {
    const calls = () => (existsSync(join(cache, 'calls.log')) ? readFileSync(join(cache, 'calls.log'), 'utf8') : '')
    const before = calls().split('\n').filter(Boolean).length
    const res = await call(port, '/api/schedule?season=2026')
    expect(res.status).toBe(200)
    expect(res.json().events.map((e: { slug: string }) => e.slug)).toEqual(['suzuka', 'spa-francorchamps', 'yas-marina'])
    await call(port, '/api/schedule?season=2026')
    expect(calls().split('\n').filter(Boolean).length).toBe(before + 1)
    await call(port, '/api/schedule?season=2026&refresh=1')
    expect(calls().split('\n').filter(Boolean).length).toBe(before + 2)
    expect((await call(port, '/api/schedule?season=1990')).status).toBe(400)
    expect((await call(port, '/api/schedule?season=2026;ls')).status).toBe(400)
  })

  it('calendario: una línea JSON larga (temporada completa) llega entera', async () => {
    process.env.FAKE_SCHEDULE_BIG = '1'
    const res = await call(port, '/api/schedule?season=2023')
    delete process.env.FAKE_SCHEDULE_BIG
    expect(res.status).toBe(200)
    expect(res.json().events).toHaveLength(15)
  })

  it('calendario: los errores del pipeline llegan clasificados y no se guardan en caché', async () => {
    process.env.FAKE_SCHEDULE_FAIL = '1'
    const res = await call(port, '/api/schedule?season=2024')
    expect(res.status).toBe(502)
    expect(res.json().error).toMatchObject({ code: 'network' })
    delete process.env.FAKE_SCHEDULE_FAIL
    expect((await call(port, '/api/schedule?season=2024')).status).toBe(200)
  })

  it('valida las peticiones de descarga', async () => {
    const plain = await call(port, '/api/jobs', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ jobs: [{ season: 2026, round: 3, session: 'fp1' }] }),
    })
    expect(plain.status).toBe(415)
    expect((await postJobs(port, [{ season: 2026, round: 3, session: 'fp1 && calc' }])).status).toBe(400)
    expect((await postJobs(port, [])).status).toBe(400)
    expect((await postJobs(port, 'x')).status).toBe(400)
    const huge = await call(port, '/api/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jobs: [], pad: 'x'.repeat(70_000) }),
    })
    expect(huge.status).toBe(413)
    expect((await call(port, '/api/jobs/999', { method: 'DELETE' })).status).toBe(404)
  })

  it('descarga en cola, de una en una, con progreso; la sesión entra en el catálogo', async () => {
    const res = await postJobs(port, [
      { season: 2026, round: 3, session: 'fp1' },
      { season: 2026, round: 3, session: 'race' },
    ])
    expect(res.status).toBe(202)
    const [first, second] = res.json().jobs as { id: string; state: string }[]
    expect(first!.state).toBe('running')
    expect(second!.state).toBe('queued')
    // Pedir otra vez lo mismo no duplica el trabajo.
    const again = await postJobs(port, [{ season: 2026, round: 3, session: 'fp1' }])
    expect(again.json().jobs[0].id).toBe(first!.id)

    const progressSeen = await waitFor(async () => {
      const j = (await jobOf(port, first!.id)) as { state: string; pct: number } | undefined
      return j && j.state === 'running' && j.pct >= 12 ? j : null
    })
    expect(progressSeen.pct).toBeLessThan(100)
    // La radio de los equipos (D51) es una fase propia; una fase que no conoce no se enseña.
    const radio = (await waitFor(async () => {
      const j = (await jobOf(port, first!.id)) as { phase: string | null; pct: number } | undefined
      return j && j.pct >= 92 ? j : null
    })) as unknown as { phase: string | null }
    expect(radio.phase).toBe('radio')
    const done = (await waitFor(async () => {
      const j = await jobOf(port, second!.id)
      return j?.state === 'done' ? j : null
    })) as unknown as { result: { session: string; status: string; dev: boolean }; pct: number }
    expect(done.pct).toBe(100)
    // `dev` del pipeline pasa tal cual: la insignia DEV sale antes de releer el catálogo.
    expect(done.result).toMatchObject({ session: '2026/03-suzuka/race', status: 'complete', dev: true })
    const catalog = JSON.parse(readFileSync(join(data, 'v1', 'catalog.json'), 'utf8'))
    const suzuka = catalog.seasons[0].events.find((e: { slug: string }) => e.slug === 'suzuka')
    expect(suzuka.sessions.map((s: { session: string }) => s.session).sort()).toEqual(['fp1', 'race'])
    // Argumentos fijos: nada de lo que llega por HTTP se pasa sin validar.
    const calls = readFileSync(join(data, 'calls.log'), 'utf8').trim().split('\n')
    expect(calls.map((l) => JSON.parse(l.replace(/ pid=\d+$/, '')))).toEqual([
      ['build', '2026', '3', 'fp1', '--data', data, '--progress'],
      ['build', '2026', '3', 'race', '--data', data, '--progress'],
    ])
  })

  it('un fallo queda como error con su código y el registro; reintentar lo sustituye', async () => {
    const res = await postJobs(port, [{ season: 2026, round: 3, session: 'q' }])
    const id = res.json().jobs[0].id as string
    const failed = (await waitFor(async () => {
      const j = await jobOf(port, id)
      return j?.state === 'error' ? j : null
    })) as unknown as { error: { code: string; message: string }; log: string[] }
    expect(failed.error.code).toBe('empty')
    expect(failed.error.message).toContain('EmptySessionError')
    expect(failed.log.join('\n')).toContain('Traceback')
    const retry = await postJobs(port, [{ season: 2026, round: 3, session: 'q' }])
    const retryId = retry.json().jobs[0].id as string
    expect(retryId).not.toBe(id)
    expect(await jobOf(port, id)).toBeUndefined()
    await waitFor(async () => (await jobOf(port, retryId))?.state === 'error')
    // Un «Cancelar» que llega cuando ya terminó no borra el resultado.
    expect((await call(port, `/api/jobs/${retryId}`, { method: 'DELETE' })).status).toBe(200)
    expect((await jobOf(port, retryId))?.state).toBe('error')
  })

  it('cancelar para el proceso en curso (y sus hijos) y deja pasar al siguiente', async () => {
    const pidFile = join(data, 'hang.pid')
    rmSync(pidFile, { force: true })
    const res = await postJobs(port, [
      { season: 2026, round: 10, session: 'sq' },
      { season: 2026, round: 3, session: 'fp2' },
    ])
    const [hang, next] = res.json().jobs as { id: string }[]
    const pid = Number(await waitFor(async () => existsSync(pidFile) && readFileSync(pidFile, 'utf8')))
    expect((await call(port, `/api/jobs/${hang!.id}`, { method: 'DELETE' })).status).toBe(200)
    await waitFor(async () => (await jobOf(port, hang!.id))?.state === 'cancelled')
    await waitFor(async () => !alive(pid), 3000)
    await waitFor(async () => (await jobOf(port, next!.id))?.state === 'done')
  })

  it('cancelar mata también los nietos que heredan las tuberías (grupo de procesos)', async () => {
    const pidFile = join(data, 'tree.pids')
    rmSync(pidFile, { force: true })
    const res = await postJobs(port, [{ season: 2026, round: 10, session: 'sprint' }])
    const id = res.json().jobs[0].id as string
    const pids = (await waitFor(async () => existsSync(pidFile) && readFileSync(pidFile, 'utf8')))
      .split(' ')
      .map(Number)
    await call(port, `/api/jobs/${id}`, { method: 'DELETE' })
    await waitFor(async () => (await jobOf(port, id))?.state === 'cancelled')
    await waitFor(async () => pids.every((pid) => !alive(pid)), 3000)
  })

  it('sin gestor, /api no existe (servidor de los e2e)', async () => {
    const plain = createLocalServer({ appDir: app, dataDir: data }) as Server & { shutdown: () => void }
    await new Promise<void>((r) => plain.listen(0, '127.0.0.1', r))
    const p = (plain.address() as AddressInfo).port
    expect((await call(p, '/api/status')).status).toBe(404)
    plain.shutdown()
    appendFileSync(join(root, 'done'), 'ok')
  })
})

describe('la cola nunca se queda bloqueada', () => {
  it('Windows: el árbol se mata con taskkill /T', () => {
    expect(windowsTreeKill(1234)).toEqual(['taskkill', ['/pid', '1234', '/T', '/F']])
  })

  it('si un nieto sigue con las tuberías abiertas tras matar al hijo, el trabajo termina igualmente', async () => {
    // Emula Windows sin taskkill: solo muere el proceso hijo y el nieto conserva stdout/stderr abiertos.
    const root = mkdtempSync(join(tmpdir(), 'trazada-tree-'))
    const data = join(root, 'data')
    cpSync(FIXTURE_DATA, data, { recursive: true })
    const queue = createJobQueue({
      pipeline: { command: process.execPath, args: [FAKE], cwd: root, platform: 'win32', killGraceMs: 100 },
      dataDir: data,
    })
    const [hang, next] = queue.enqueue([
      { season: 2026, round: 10, session: 'sprint' },
      { season: 2026, round: 3, session: 'fp2' },
    ]) as { id: string }[]
    const pidFile = join(data, 'tree.pids')
    const [, grandchild] = (await waitFor(async () => existsSync(pidFile) && readFileSync(pidFile, 'utf8')))
      .split(' ')
      .map(Number)
    try {
      const start = Date.now()
      queue.remove(hang!.id)
      const state = (id: string) => (queue.list() as { id: string; state: string }[]).find((j) => j.id === id)?.state
      await waitFor(async () => state(hang!.id) === 'cancelled', 3000)
      expect(Date.now() - start).toBeLessThan(2000)
      expect(alive(grandchild!)).toBe(true) // sigue vivo: la cola no lo ha esperado
      await waitFor(async () => state(next!.id) === 'done', 10_000)
    } finally {
      try {
        process.kill(grandchild!, 'SIGKILL')
      } catch {
        // ya había terminado
      }
      queue.close()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('al cerrar el servidor se paran también los calendarios en curso', async () => {
    const root = mkdtempSync(join(tmpdir(), 'trazada-sched-'))
    mkdirSync(join(root, 'public'))
    const server = createLocalServer({
      appDir: join(root, 'public'),
      dataDir: root,
      manager: { pipeline: { command: process.execPath, args: [FAKE], cwd: root }, scheduleCacheDir: root },
    }) as Server & { shutdown: () => void }
    process.env.FAKE_SCHEDULE_HANG = '1'
    try {
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
      const p = (server.address() as AddressInfo).port
      void call(p, '/api/schedule?season=2026').catch(() => null)
      const pid = Number(
        await waitFor(async () => existsSync(join(root, 'schedule.pid')) && readFileSync(join(root, 'schedule.pid'), 'utf8')),
      )
      server.shutdown()
      await waitFor(async () => !alive(pid), 3000)
    } finally {
      delete process.env.FAKE_SCHEDULE_HANG
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('borrar una sesión descargada (DELETE /api/sessions/…)', () => {
  let root: string
  let data: string
  let server: Server & { shutdown: () => void }
  let port: number
  const FP1 = '2026/10-spa-francorchamps/fp1'

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'trazada-delete-'))
    data = join(root, 'data')
    cpSync(FIXTURE_DATA, data, { recursive: true })
    mkdirSync(join(root, 'public'))
    mkdirSync(join(root, 'cache'))
    writeFileSync(join(root, 'public', 'index.html'), '<!doctype html><title>Trazada</title>')
    process.env.FAKE_STEP_MS = '400'
    server = createLocalServer({
      appDir: join(root, 'public'),
      dataDir: data,
      manager: { pipeline: { command: process.execPath, args: [FAKE], cwd: root }, scheduleCacheDir: join(root, 'cache') },
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    port = (server.address() as AddressInfo).port
  })

  afterAll(() => {
    server.shutdown()
    rmSync(root, { recursive: true, force: true })
  })

  const sessionsIn = () =>
    (JSON.parse(readFileSync(join(data, 'v1', 'catalog.json'), 'utf8')).seasons as { events: { sessions: { path: string }[] }[] }[])
      .flatMap((s) => s.events.flatMap((e) => e.sessions.map((x) => x.path)))

  it('valida la sesión y solo atiende al propio equipo con su cabecera', async () => {
    expect((await call(port, '/api/sessions/2026/10/xx', { method: 'DELETE' })).status).toBe(400)
    expect((await call(port, '/api/sessions/2026/10/../fp1', { method: 'DELETE' })).status).toBe(404) // la ruta no casa
    expect((await call(port, '/api/sessions/1999/10/fp1', { method: 'DELETE' })).status).toBe(400)
    expect((await call(port, '/api/sessions/2026/99/fp1', { method: 'DELETE' })).status).toBe(400)
    expect((await call(port, '/api/sessions/2026/10/fp1', { method: 'DELETE', api: false })).status).toBe(403)
    expect(existsSync(join(data, 'v1', 'sessions', ...FP1.split('/'), 'manifest.json'))).toBe(true)
  })

  it('con una descarga en marcha, no (el pipeline también escribe el catálogo)', async () => {
    const res = await postJobs(port, [{ season: 2026, round: 3, session: 'fp1' }])
    expect(res.status).toBe(202)
    expect((await call(port, '/api/sessions/2026/10/fp1', { method: 'DELETE' })).status).toBe(409)
    await waitFor(async () => {
      const jobs = (await call(port, '/api/jobs')).json().jobs as { state: string }[]
      return jobs.every((j) => j.state !== 'queued' && j.state !== 'running')
    }, 20_000)
  })

  it('borra su carpeta y su entrada del catálogo (y nada más); la segunda vez, 404', async () => {
    const before = sessionsIn()
    expect(before).toContain(`sessions/${FP1}/manifest.json`)
    const res = await call(port, '/api/sessions/2026/10/fp1', { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect(existsSync(join(data, 'v1', 'sessions', ...FP1.split('/')))).toBe(false)
    expect(sessionsIn()).toEqual(before.filter((p) => p !== `sessions/${FP1}/manifest.json`))
    // Los circuitos se quedan (los comparten otras sesiones).
    expect(existsSync(join(data, 'v1', 'circuits'))).toBe(true)
    expect((await call(port, '/api/sessions/2026/10/fp1', { method: 'DELETE' })).status).toBe(404)
  })
})
