// Uso personal (D23): la app con tus datos de data/, servida en tu PC. Nada se publica.
//   pnpm local            → http://127.0.0.1:3000 (compila la app si aún no está compilada)
//   pnpm local --build    → recompila antes
//   pnpm local --lan      → también en tu red de casa (p. ej. para el iPad), con la IP que se muestra
import { execFileSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const args = process.argv.slice(2)
const lan = args.includes('--lan')
const portArg = args.indexOf('--port')
const port = portArg > -1 ? args[portArg + 1] : '3000'

if (args.includes('--build') || !existsSync(`${root}apps/web/.output/public/index.html`)) {
  execFileSync('pnpm', ['build'], { cwd: root, stdio: 'inherit' })
}
if (!existsSync(`${root}data/v1/catalog.json`)) {
  console.warn('Aviso: data/v1/catalog.json no existe. Genera antes alguna sesión (cd pipeline && uv run trazada build …).')
}
if (lan) {
  const ips = Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => `http://${i.address}:${port}`)
  console.log(`En tu red local: ${ips.join(', ') || '(sin interfaz de red)'}`)
}
const server = spawn(
  process.execPath,
  [`${root}apps/web/tests/e2e/serve.mjs`, '--port', port, '--host', lan ? '0.0.0.0' : '127.0.0.1'],
  { env: { ...process.env, E2E_DATA_DIR: `${root}data` }, stdio: 'inherit' },
)
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.kill(sig))
server.on('exit', (code) => process.exit(code ?? 0))
