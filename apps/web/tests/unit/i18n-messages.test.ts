/** Carga de textos por namespace (D29): orden de ficheros y fusión sin pisar raíces. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadMessages, localeFiles } from '../../i18n/messages'

let dir = ''
function locales(files: Record<string, object>): string {
  dir = mkdtempSync(join(tmpdir(), 'tz-i18n-'))
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), JSON.stringify(content))
  }
  return dir
}
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('textos por namespace', () => {
  it('base primero y el resto en orden alfabético; solo .json', () => {
    const d = locales({ 'es/trails.json': {}, 'es/base.json': {}, 'es/analysis.json': {}, 'es/notas.txt': {} })
    expect(localeFiles('es', d)).toEqual(['es/base.json', 'es/analysis.json', 'es/trails.json'])
  })

  it('fusiona las raíces de todos los ficheros', () => {
    const d = locales({ 'es/base.json': { app: { name: 'Trazada' } }, 'es/trails.json': { trails: { on: 'Estelas' } } })
    expect(loadMessages('es', d)).toEqual({ app: { name: 'Trazada' }, trails: { on: 'Estelas' } })
  })

  it('una raíz repetida en dos ficheros es un error, no una fusión silenciosa', () => {
    const d = locales({ 'es/base.json': { scene: { a: 'x' } }, 'es/heat.json': { scene: { b: 'y' } } })
    expect(() => loadMessages('es', d)).toThrow(/scene.*base\.json.*heat\.json/)
  })
})
