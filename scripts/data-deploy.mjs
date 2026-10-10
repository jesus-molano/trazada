// Despliega data/ en el Worker de Cloudflare "trazada-data" (solo assets).
// Requiere `wrangler login` (o CLOUDFLARE_API_TOKEN/CLOUDFLARE_ACCOUNT_ID) en la máquina local.
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const dataDir = `${root}data`
if (!existsSync(`${dataDir}/v1/catalog.json`)) {
  console.error('data/v1/catalog.json no existe: ejecuta antes el pipeline (uv run trazada build ...).')
  process.exit(1)
}
const count = readdirSync(dataDir, { recursive: true }).length
if (count > 15000) {
  console.error(`data/ tiene ${count} entradas (> 15000, presupuesto bajo el límite de 20000 de Cloudflare).`)
  process.exit(1)
}
copyFileSync(`${root}deploy/data/_headers`, `${dataDir}/_headers`)
execFileSync('pnpm', ['dlx', 'wrangler@4', 'deploy', '--config', 'deploy/data/wrangler.jsonc'], {
  cwd: root,
  stdio: 'inherit',
})
