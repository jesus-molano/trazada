// Servidor estático mínimo para los e2e: .output/public en / y los datos de fixture en /data.
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const appDir = resolve(here, '../../.output/public')
const dataDir = resolve(process.env.E2E_DATA_DIR ?? resolve(here, '../fixtures/data'))
const portArg = process.argv.indexOf('--port')
const port = portArg > -1 ? Number(process.argv[portArg + 1]) : 4173
const hostArg = process.argv.indexOf('--host')
const host = hostArg > -1 ? process.argv[hostArg + 1] : '127.0.0.1'

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
  res.writeHead(200, headers)
  createReadStream(file).pipe(res)
}).listen(port, host, () => {
  console.log(`servidor en http://${host}:${port} (app: ${appDir}, datos: ${dataDir})`)
})
