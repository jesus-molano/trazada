// Pipeline falso para los tests del gestor de datos local: imita `trazada schedule` y `trazada build --progress`
// (mismas líneas `::progress/::result/::error`) sin red ni Python. Comportamiento por sesión en `build`:
//   q   → falla como una sesión vacía de F1 (código "empty")
//   sq  → no termina nunca (para probar cancelar)
//   sprint → como sq, pero con un nieto que hereda las tuberías (como python bajo `uv run`)
//   resto → progreso por pasos y la sesión entra en <data>/v1/catalog.json
// Las sesiones de Suzuka (ronda 3) salen como dev (su circuito usa fuentes de desarrollo, como el real):
// `dev: true` en el resultado y en el catálogo.
// Variables: FAKE_STEP_MS (pausa entre pasos), FAKE_SCHEDULE_FAIL=1 (el calendario falla por red),
// FAKE_SCHEDULE_BIG=1 (calendario de más de 10 KB en una línea), FAKE_SCHEDULE_HANG=1 (el calendario no
// termina nunca; deja su pid en <cache>/schedule.pid).
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const [command] = args
const stepMs = Number(process.env.FAKE_STEP_MS ?? 150)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const emit = (kind, payload) => process.stdout.write(`::${kind} ${JSON.stringify(payload)}\n`)
const DAY = 86_400_000

function schedule(season) {
  const future = Date.now() + 30 * DAY
  const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')
  const sessions = (types, first) => types.map((session, i) => ({ session, startUtc: iso(first + i * 3 * 3600_000) }))
  return {
    season,
    events: [
      {
        round: 3,
        slug: 'suzuka',
        event: 'Japanese Grand Prix',
        country: 'Japan',
        dateStart: `${season}-03-27`,
        sessions: sessions(['fp1', 'fp2', 'fp3', 'q', 'race'], Date.UTC(season, 2, 27, 2, 30)),
      },
      {
        round: 10,
        slug: 'spa-francorchamps',
        event: 'Belgian Grand Prix',
        country: 'Belgium',
        dateStart: `${season}-07-17`,
        sessions: sessions(['fp1', 'fp2', 'fp3', 'sq', 'q', 'race'], Date.UTC(season, 6, 17, 10, 30)),
      },
      {
        round: 23,
        slug: 'yas-marina',
        event: 'Abu Dhabi Grand Prix',
        country: 'United Arab Emirates',
        dateStart: iso(future).slice(0, 10),
        sessions: sessions(['fp1', 'fp2', 'fp3', 'q', 'race'], future),
      },
    ],
  }
}

const isDev = (round) => round === 3

function addToCatalog(dataDir, season, round, session) {
  const event = schedule(season).events.find((e) => e.round === round)
  if (!event) throw new Error(`ronda ${round} no está en el calendario falso`)
  const v1 = join(dataDir, 'v1')
  const path = join(v1, 'catalog.json')
  const catalog = existsSync(path)
    ? JSON.parse(readFileSync(path, 'utf8'))
    : { schema: 'trazada.catalog', schemaVersion: '1.0.0', generatedAt: '', seasons: [] }
  let s = catalog.seasons.find((x) => x.season === season)
  if (!s) catalog.seasons.push((s = { season, events: [] }))
  let e = s.events.find((x) => x.round === round && x.slug === event.slug)
  if (!e) {
    s.events.push(
      (e = { round, slug: event.slug, event: event.event, country: event.country, dateStart: event.dateStart, sessions: [] }),
    )
  }
  const id = `${season}/${String(round).padStart(2, '0')}-${event.slug}/${session}`
  e.sessions = e.sessions.filter((x) => x.session !== session)
  e.sessions.push({
    session,
    name: session,
    status: 'complete',
    path: `sessions/${id}/manifest.json`,
    bytes: 123_456,
    ...(isDev(round) ? { dev: true } : {}),
  })
  s.events.sort((a, b) => a.round - b.round)
  catalog.seasons.sort((a, b) => b.season - a.season)
  mkdirSync(v1, { recursive: true })
  writeFileSync(`${path}.tmp`, JSON.stringify(catalog, null, 2))
  renameSync(`${path}.tmp`, path)
  return id
}

async function main() {
  if (command === 'schedule') {
    const season = Number(args[1])
    const cache = args.indexOf('--cache') > -1 ? args[args.indexOf('--cache') + 1] : null
    if (cache) appendFileSync(join(cache, 'calls.log'), `schedule ${season}\n`)
    console.log('ruido de arranque que no es JSON')
    if (process.env.FAKE_SCHEDULE_HANG === '1') {
      writeFileSync(join(cache, 'schedule.pid'), String(process.pid))
      setInterval(() => {}, 1000)
      return
    }
    if (process.env.FAKE_SCHEDULE_FAIL === '1') {
      console.error('Traceback (most recent call last): ConnectionError')
      emit('error', { code: 'network', message: 'ConnectionError: sin red' })
      process.exit(1)
    }
    const doc = schedule(season)
    // Un calendario real de 24 Grandes Premios ocupa ~10 KB en una sola línea.
    if (process.env.FAKE_SCHEDULE_BIG === '1') {
      for (let round = 11; round <= 22; round++) {
        doc.events.push({ ...doc.events[1], round, slug: `relleno-${round}`, event: `Relleno ${'x'.repeat(100)}` })
      }
    }
    console.log(JSON.stringify(doc))
    return
  }
  if (command === 'build') {
    const [, season, round, session] = args
    const dataDir = args[args.indexOf('--data') + 1]
    appendFileSync(join(dataDir, 'calls.log'), `${JSON.stringify(args)} pid=${process.pid}\n`)
    if (!args.includes('--progress')) throw new Error('falta --progress')
    emit('progress', { pct: 1, phase: 'download', step: 'start' })
    console.error('INFO Loading data for …')
    if (session === 'sprint') {
      const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' })
      writeFileSync(join(dataDir, 'tree.pids'), `${process.pid} ${grandchild.pid}`)
      setInterval(() => {}, 1000)
      return
    }
    if (session === 'sq') {
      writeFileSync(join(dataDir, 'hang.pid'), String(process.pid))
      setInterval(() => {}, 1000)
      return
    }
    for (const [pct, step] of [
      [12, 'timing'],
      [40, 'car'],
      [65, 'position'],
    ]) {
      await sleep(stepMs)
      emit('progress', { pct, phase: 'download', step })
    }
    if (session === 'q') {
      console.error('Traceback (most recent call last):')
      console.error('EmptySessionError: FastF1 devolvió una sesión vacía')
      emit('error', { code: 'empty', message: 'EmptySessionError: FastF1 devolvió una sesión vacía' })
      process.exit(1)
    }
    await sleep(stepMs)
    emit('progress', { pct: 88, phase: 'process', step: 'process' })
    const id = addToCatalog(dataDir, Number(season), Number(round), session)
    emit('result', { session: id, status: 'complete', bytes: 123_456, dev: isDev(Number(round)), warnings: [] })
    return
  }
  console.error(`orden desconocida: ${command}`)
  process.exit(2)
}

await main()
