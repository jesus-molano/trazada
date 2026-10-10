// Uso personal (D23, D25, D26): la app con tus datos de data/, servida en tu PC. Nada se publica.
//   pnpm local            → http://127.0.0.1:3000, con el gestor de datos (descargas con el pipeline)
//   pnpm local --build    → regenera la app antes (si no, solo la primera vez)
//   pnpm local --lan      → también en tu red de casa (p. ej. el iPad); el gestor sigue siendo solo de este PC
//   pnpm local --port N
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createLocalServer } from './local-server.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const args = process.argv.slice(2)
const lan = args.includes('--lan')
const portArg = args.indexOf('--port')
const port = portArg > -1 ? Number(args[portArg + 1]) : 3000
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('Puerto no válido: usa --port <1-65535>')
  process.exit(2)
}

if (args.includes('--build') || !existsSync(`${root}apps/web/.output/public/index.html`)) {
  // Comando fijo, sin datos del usuario: en Windows pnpm es un .cmd y necesita shell.
  execFileSync('pnpm', ['build'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })
}
if (!existsSync(`${root}data/v1/catalog.json`)) {
  console.warn('Aún no hay datos en data/: descárgalos desde la portada (botón «Descargar» de cada sesión).')
}

const server = createLocalServer({
  appDir: `${root}apps/web/.output/public`,
  dataDir: `${root}data`,
  manager: {
    // `uv run trazada …` dentro de pipeline/ (uv crea el entorno la primera vez).
    pipeline: { command: 'uv', args: ['run', '--quiet', 'trazada'], cwd: `${root}pipeline` },
    scheduleCacheDir: `${root}.cache/fastf1-schedule`,
  },
})

const host = lan ? '0.0.0.0' : '127.0.0.1'
server.listen(port, host, () => {
  console.log(`Trazada en http://127.0.0.1:${port}`)
  if (lan) {
    for (const nets of Object.values(networkInterfaces())) {
      for (const net of nets ?? []) {
        if (net.family === 'IPv4' && !net.internal) console.log(`  en tu red: http://${net.address}:${port}`)
      }
    }
    console.log('  (las descargas solo se pueden lanzar desde este PC)')
  }
})
server.on('error', (err) => {
  console.error(`No se pudo arrancar el servidor: ${err.message}`)
  process.exit(1)
})
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.shutdown()
    // Deja unos instantes para que el pipeline en curso reciba la señal.
    setTimeout(() => process.exit(0), 300).unref()
  })
}
