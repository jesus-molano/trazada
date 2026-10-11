// Servidor estático para los e2e: .output/public en / y los datos de fixture en /data (sin gestor de datos).
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLocalServer } from '../../../../scripts/local-server.mjs'

const here = fileURLToPath(new URL('.', import.meta.url))
const appDir = resolve(here, '../../.output/public')
const dataDir = resolve(process.env.E2E_DATA_DIR ?? resolve(here, '../fixtures/data'))
const portArg = process.argv.indexOf('--port')
const port = portArg > -1 ? Number(process.argv[portArg + 1]) : 4173
const hostArg = process.argv.indexOf('--host')
const host = hostArg > -1 ? process.argv[hostArg + 1] : '127.0.0.1'

createLocalServer({ appDir, dataDir }).listen(port, host, () => {
  console.log(`servidor en http://${host}:${port} (app: ${appDir}, datos: ${dataDir})`)
})
