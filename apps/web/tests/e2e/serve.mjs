// Servidor estático mínimo para e2e: .output/public en / y los datos de fixture en /data.
// Si la raíz de datos trae un _headers (como deploy/.staging/data), se aplica a /data igual que en
// Cloudflare: así el smoke post-deploy (scripts/smoke-deploy.sh) se puede probar en local.
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const appDir = resolve(here, '../../.output/public')
const dataDir = resolve(process.env.E2E_DATA_DIR ?? resolve(here, '../fixtures/data'))
const portArg = process.argv.indexOf('--port')
const port = portArg > -1 ? Number(process.argv[portArg + 1]) : 4173

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.gz': 'application/gzip',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.glb': 'model/gltf-binary',
  '.ico': 'image/x-icon',
}

/** Reglas de un fichero _headers de Cloudflare: [patrón (con *), { cabecera: valor }]. */
function parseHeaders(file) {
  if (!existsSync(file)) return []
  const rules = []
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    if (!/^\s/.test(line)) {
      const re = new RegExp(`^${line.trim().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`)
      rules.push([re, {}])
    } else if (rules.length) {
      const i = line.indexOf(':')
      rules[rules.length - 1][1][line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim()
    }
  }
  return rules
}
const dataHeaders = parseHeaders(join(dataDir, '_headers'))

function safeJoin(root, urlPath) {
  const p = normalize(join(root, decodeURIComponent(urlPath)))
  return p.startsWith(root) ? p : null
}

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  let root = appDir
  let path = url.pathname
  if (path.startsWith('/data/')) {
    root = dataDir
    path = path.slice('/data'.length)
  }
  let file = safeJoin(root, path)
  if (file && existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')
  if (!file || !existsSync(file)) {
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found')
    return
  }
  const headers = {
    'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  }
  if (root === dataDir) for (const [re, h] of dataHeaders) if (re.test(path)) Object.assign(headers, h)
  res.writeHead(200, headers)
  createReadStream(file).pipe(res)
}).listen(port, '127.0.0.1', () => {
  console.log(`e2e server on http://127.0.0.1:${port} (app: ${appDir}, data: ${dataDir})`)
})
