// Prepara el directorio que se publica en el Worker de datos: SOLO sesiones publicables.
// - catálogo sin sesiones `dev` (TracingInsights, sintéticas) ni eventos que se queden vacíos;
// - de cada sesión publicable, su manifest y exactamente los ficheros que referencia (circuito incluido);
// - se rechaza un manifest de fuente dev aunque el catálogo no lo marque, un fichero que no exista,
//   uno de más de 25 MiB (límite por asset de Cloudflare) o más de 15 000 ficheros.
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

export const DEV_SOURCES = new Set(['tracinginsights-dev', 'synthetic'])
export const MAX_FILE_BYTES = 25 * 1024 * 1024
export const MAX_FILES = 15000

function copy(from, to) {
  mkdirSync(dirname(to), { recursive: true })
  copyFileSync(from, to)
}

/**
 * @param {string} dataDir raíz de datos del pipeline (contiene v1/)
 * @param {string} outDir destino (se borra y se rehace)
 * @param {{ headers?: string }} [opts] fichero _headers a incluir
 */
export function stagePublicData(dataDir, outDir, opts = {}) {
  const v1 = join(dataDir, 'v1')
  const catalog = JSON.parse(readFileSync(join(v1, 'catalog.json'), 'utf8'))
  rmSync(outDir, { recursive: true, force: true })
  const outV1 = join(outDir, 'v1')
  const files = new Set()
  const sessions = []
  const skipped = []

  const seasons = catalog.seasons.map((season) => ({
    ...season,
    events: season.events
      .map((ev) => ({
        ...ev,
        sessions: ev.sessions.filter((s) => {
          const id = `${season.season}/${ev.slug}/${s.session}`
          if (s.dev) {
            skipped.push(id)
            return false
          }
          if (!s.path) return true // no-position / sin manifest: entrada informativa
          const manifestPath = resolve(v1, s.path)
          const m = JSON.parse(readFileSync(manifestPath, 'utf8'))
          const devAttribution = (m.attribution ?? []).filter((a) => /\bdev\b/i.test(a))
          if (m.dev || DEV_SOURCES.has(m.pipeline?.source) || devAttribution.length) {
            const why = devAttribution.length ? devAttribution.join('; ') : m.pipeline?.source
            throw new Error(`${id}: usa datos de desarrollo (${why}) y el catálogo no lo marca como dev`)
          }
          files.add(manifestPath)
          if (s.status === 'ok' && m.files) {
            for (const ref of Object.values(m.files)) {
              const p = resolve(dirname(manifestPath), ref.path)
              if (!p.startsWith(v1)) throw new Error(`${id}: ${ref.path} sale de v1/`)
              if (!existsSync(p)) throw new Error(`${id}: falta ${relative(dataDir, p)}`)
              files.add(p)
            }
          }
          sessions.push(id)
          return true
        }),
      }))
      .filter((ev) => ev.sessions.length > 0),
  }))

  let bytes = 0
  for (const f of files) {
    const size = statSync(f).size
    if (size > MAX_FILE_BYTES) throw new Error(`${relative(dataDir, f)} pesa ${size} B (> 25 MiB)`)
    bytes += size
    copy(f, join(outDir, relative(dataDir, f)))
  }
  mkdirSync(outV1, { recursive: true })
  writeFileSync(join(outV1, 'catalog.json'), `${JSON.stringify({ ...catalog, seasons }, null, 2)}\n`)
  if (opts.headers) copy(opts.headers, join(outDir, '_headers'))
  const count = files.size + 1 + (opts.headers ? 1 : 0)
  if (count > MAX_FILES) throw new Error(`${count} ficheros (> ${MAX_FILES})`)
  return { sessions, skipped, files: count, bytes }
}
