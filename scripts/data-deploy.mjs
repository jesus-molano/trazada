// Despliega en el Worker de Cloudflare "trazada-data" (solo assets) los datos PUBLICABLES de data/:
// se preparan en deploy/.staging/data (sin sesiones dev) y se sube ese directorio.
// Requiere `wrangler login` (o CLOUDFLARE_API_TOKEN/CLOUDFLARE_ACCOUNT_ID). Con --dry-run solo prepara.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { stagePublicData } from './stage-data.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const dataDir = `${root}data`
if (!existsSync(`${dataDir}/v1/catalog.json`)) {
  console.error('data/v1/catalog.json no existe: ejecuta antes el pipeline (uv run trazada build ...).')
  process.exit(1)
}
const summary = stagePublicData(dataDir, `${root}deploy/.staging/data`, { headers: `${root}deploy/data/_headers` })
console.log(`Sesiones publicables: ${summary.sessions.length}; ficheros: ${summary.files}; ${(summary.bytes / 1e6).toFixed(1)} MB`)
if (summary.skipped.length) console.log(`Excluidas (dev): ${summary.skipped.join(', ')}`)
if (summary.sessions.length === 0) {
  console.error('No hay ninguna sesión publicable: no se despliega.')
  process.exit(1)
}
if (process.argv.includes('--dry-run')) process.exit(0)
execFileSync('pnpm', ['dlx', 'wrangler@4', 'deploy', '--config', 'deploy/data/wrangler.jsonc'], {
  cwd: root,
  stdio: 'inherit',
})
