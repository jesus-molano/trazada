// Servidor local con el gestor de datos y el pipeline falso (tests/fixtures/fake-pipeline.mjs), para
// manager.spec.ts: node manager-server.mjs --port <n> --data <copia de los datos de fixture>.
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLocalServer } from '../../../../scripts/local-server.mjs'

const here = fileURLToPath(new URL('.', import.meta.url))
const arg = (name) => process.argv[process.argv.indexOf(name) + 1]
const port = Number(arg('--port'))
const dataDir = resolve(arg('--data'))

const server = createLocalServer({
  appDir: resolve(here, '../../.output/public'),
  dataDir,
  manager: {
    pipeline: { command: process.execPath, args: [resolve(here, '../fixtures/fake-pipeline.mjs')], cwd: dataDir },
    scheduleCacheDir: dataDir,
  },
})
server.listen(port, '127.0.0.1', () => console.log(`gestor de prueba en http://127.0.0.1:${port}`))
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => (server.shutdown(), process.exit(0)))
