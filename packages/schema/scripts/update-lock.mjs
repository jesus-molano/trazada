// Actualiza layouts.lock.json. Exige que, si un layout cambió, se haya subido su `revision`
// y la `schemaVersion` (minor si solo se añaden columnas; major si el cambio es incompatible).
import { writeFileSync } from 'node:fs'
import { LAYOUT_NAMES, layoutHash, readJson } from './lock-lib.mjs'

const root = new URL('../', import.meta.url)
const version = readJson(new URL('version.json', root))
const lockUrl = new URL('layouts.lock.json', root)
let lock = { schemaVersion: null, layouts: {} }
try {
  lock = readJson(lockUrl)
} catch {}

const next = { schemaVersion: version.schemaVersion, layouts: {} }
for (const name of LAYOUT_NAMES) {
  const layout = readJson(new URL(`trzb/${name}.layout.json`, root))
  const hash = layoutHash(layout)
  const prev = lock.layouts[name]
  if (prev && prev.sha256 !== hash) {
    if (layout.revision <= prev.revision) throw new Error(`${name}: cambió el layout; sube "revision"`)
    if (version.schemaVersion === lock.schemaVersion) throw new Error(`${name}: cambió el layout; sube schemaVersion`)
  }
  next.layouts[name] = { revision: layout.revision, sha256: hash }
}
writeFileSync(lockUrl, `${JSON.stringify(next, null, 2)}\n`)
console.log('layouts.lock.json actualizado')
