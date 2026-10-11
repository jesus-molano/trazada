// Servidor local para las capturas del README (readme-shots.spec.ts): el de `pnpm local` con el gestor de
// datos y el calendario real (`trazada schedule`, de la caché de FastF1 o con red), pero con los datos de
// fixture (extracto de test): node readme-server.mjs --port <n> --data <copia de los datos de fixture>.
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLocalServer } from '../../../../scripts/local-server.mjs'

const here = fileURLToPath(new URL('.', import.meta.url))
const root = resolve(here, '../../../..')
const arg = (name) => process.argv[process.argv.indexOf(name) + 1]

const server = createLocalServer({
  appDir: resolve(here, '../../.output/public'),
  dataDir: resolve(arg('--data')),
  manager: {
    pipeline: { command: 'uv', args: ['run', '--quiet', 'trazada'], cwd: resolve(root, 'pipeline') },
    scheduleCacheDir: resolve(root, '.cache/fastf1-schedule'),
  },
})
server.listen(Number(arg('--port')), '127.0.0.1')
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => (server.shutdown(), process.exit(0)))
