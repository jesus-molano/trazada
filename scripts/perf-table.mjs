// Genera la tabla de peso por sesión de docs/PERFORMANCE.md desde los manifests de data/v1
// (entre los marcadores <!-- sizes:start --> y <!-- sizes:end -->). Uso: pnpm perf:table [raíz de datos]
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const dataDir = resolve(process.argv[2] ?? join(root, 'data'))
const v1 = join(dataDir, 'v1')
const doc = join(root, 'docs/PERFORMANCE.md')

const catalog = JSON.parse(readFileSync(join(v1, 'catalog.json'), 'utf8'))
const kb = (b) => (b / 1024).toFixed(0)
const rows = []
for (const season of catalog.seasons) {
  for (const ev of season.events) {
    for (const s of ev.sessions) {
      if (s.status !== 'ok' || !s.path) continue
      const m = JSON.parse(readFileSync(resolve(v1, s.path), 'utf8'))
      const f = m.files
      const total = Object.values(f).reduce((a, x) => a + x.bytes, 0)
      const minutes = (m.session.playback.endMs - m.session.playback.startMs) / 60000
      rows.push(
        `| ${season.season} ${m.session.event} · ${s.name} | ${m.pipeline.source}${s.dev ? ' (dev, no publicable)' : ''} | ` +
          `${kb(f.motion.bytes)} | ${kb(f.car.bytes)} | ${kb(f.timing.bytes)} | ${kb(f.events.bytes)} | ${kb(f.circuit.bytes)} | ` +
          `**${(total / 1048576).toFixed(2)}** | ${minutes.toFixed(0)} | ${kb(total / minutes)} |`,
      )
    }
  }
}
const table = [
  '| Sesión | Fuente | motion (KB) | car (KB) | timing (KB) | events (KB) | circuito (KB) | Total (MiB) | Reproducción (min) | KB/min |',
  '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|',
  ...rows,
].join('\n')
const text = readFileSync(doc, 'utf8')
const start = '<!-- sizes:start -->'
const end = '<!-- sizes:end -->'
const i = text.indexOf(start)
const j = text.indexOf(end)
if (i < 0 || j < 0) throw new Error('faltan los marcadores de la tabla en docs/PERFORMANCE.md')
writeFileSync(doc, `${text.slice(0, i + start.length)}\n${table}\n${text.slice(j)}`)
console.log(`${rows.length} sesiones en la tabla (${dirname(v1)})`)
