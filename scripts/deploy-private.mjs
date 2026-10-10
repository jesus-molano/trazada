// Despliegue PRIVADO (D24) en Cloudflare: la app y las sesiones publicables de data/ en una Worker con
// contraseña (deploy/private/worker.mjs). Gratis (Workers Free, sin tarjeta). Desde tu PC:
//   pnpm deploy:private            → compila, prepara deploy/.staging/private y despliega
//   pnpm deploy:private --dry-run  → solo compila y prepara (no sube nada)
// La primera vez: `pnpm dlx wrangler@4 login`. Si la Worker aún no tiene contraseña, se pide aquí.
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { stagePublicData } from './stage-data.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const staging = `${root}deploy/.staging/private`
const config = 'deploy/private/wrangler.jsonc'
const dry = process.argv.includes('--dry-run')
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit', ...opts })

if (!existsSync(`${root}data/v1/catalog.json`)) {
  console.error('data/v1/catalog.json no existe: genera antes alguna sesión (cd pipeline && uv run trazada build …).')
  process.exit(1)
}
run('pnpm', ['build'])
rmSync(staging, { recursive: true, force: true })
cpSync(`${root}apps/web/.output/public`, staging, { recursive: true })
const data = stagePublicData(`${root}data`, `${staging}/data`)
const files = readdirSync(staging, { recursive: true }).length
console.log(`Sesiones: ${data.sessions.length}${data.skipped.length ? ` (excluidas por dev: ${data.skipped.join(', ')})` : ''}; ficheros: ${files}`)
if (files > 19000) {
  console.error(`${files} ficheros: demasiados para una Worker (límite 20 000).`)
  process.exit(1)
}
if (dry) process.exit(0)

const wrangler = (args, opts) => run('pnpm', ['dlx', 'wrangler@4', ...args, '--config', config], opts)
run('pnpm', ['dlx', 'wrangler@4', 'deploy', '--config', config])
let hasSecret = false
try {
  const out = execFileSync('pnpm', ['dlx', 'wrangler@4', 'secret', 'list', '--format', 'json', '--config', config], {
    cwd: root,
    encoding: 'utf8',
  })
  hasSecret = out.includes('"ACCESS_PASSWORD"')
} catch {
  // sin lista de secretos: se pide la contraseña igualmente
}
if (!hasSecret) {
  console.log('\nLa Worker aún no tiene contraseña. Escribe una (12 caracteres o más) cuando la pida wrangler:')
  wrangler(['secret', 'put', 'ACCESS_PASSWORD'])
}
console.log('\nListo. La URL es la de workers.dev que muestra wrangler arriba (trazada-privada.<tu-subdominio>.workers.dev).')
console.log('Cambiar la contraseña: pnpm dlx wrangler@4 secret put ACCESS_PASSWORD --config deploy/private/wrangler.jsonc')
