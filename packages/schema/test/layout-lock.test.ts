import { describe, expect, it } from 'vitest'
// @ts-expect-error módulo JS sin tipos (script de mantenimiento)
import { LAYOUT_NAMES, layoutHash, readJson } from '../scripts/lock-lib.mjs'
import { SCHEMA_VERSION } from '../src'

const root = new URL('../', import.meta.url)

describe('layouts.lock.json', () => {
  const lock = readJson(new URL('layouts.lock.json', root)) as {
    schemaVersion: string
    layouts: Record<string, { revision: number; sha256: string }>
  }

  it('está al día con la versión de esquema', () => {
    expect(lock.schemaVersion).toBe(SCHEMA_VERSION)
  })

  for (const name of LAYOUT_NAMES as string[]) {
    it(`${name}: el layout no ha cambiado sin subir revision y schemaVersion (pnpm lock:update)`, () => {
      const layout = readJson(new URL(`trzb/${name}.layout.json`, root)) as { revision: number }
      expect(layout.revision).toBe(lock.layouts[name]!.revision)
      expect(layoutHash(layout)).toBe(lock.layouts[name]!.sha256)
    })
  }
})
