import { readFileSync } from 'node:fs'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'
import { assertManifest, canRead, ManifestError, QUALITY_NOTE_CODES } from '../src'

const read = (p: string) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'))

function validator(schema: string) {
  const ajv = new Ajv2020({ allErrors: true, strict: true })
  addFormats(ajv)
  return ajv.compile(read(schema))
}

describe('JSON Schemas', () => {
  it.each([
    ['manifest.schema.json', 'examples/manifest.example.json'],
    ['catalog.schema.json', 'examples/catalog.example.json'],
    ['events.schema.json', 'examples/events.example.json'],
  ])('%s valida su ejemplo', (schema, example) => {
    const validate = validator(schema)
    const ok = validate(read(example))
    expect(validate.errors ?? []).toEqual([])
    expect(ok).toBe(true)
  })

  it('las notas de calidad llevan un código conocido (el mismo enum en el esquema y en TS)', () => {
    const schema = read('manifest.schema.json')
    expect(schema.$defs.qualityNote.properties.code.enum).toEqual([...QUALITY_NOTE_CODES])
    const validate = validator('manifest.schema.json')
    const m = read('examples/manifest.example.json')
    m.quality.notes = [{ code: 'inventado', text: 'x' }]
    expect(validate(m)).toBe(false)
    m.quality.notes = [{ code: 'no-corners' }]
    expect(validate(m)).toBe(false) // sin texto
  })

  it('el manifest rechaza el nombre oficial con patrocinadores en campos no previstos', () => {
    const validate = validator('manifest.schema.json')
    const m = read('examples/manifest.example.json')
    m.session.officialName = 'FORMULA 1 SPONSOR GRAND PRIX'
    expect(validate(m)).toBe(false)
  })
})

describe('compatibilidad de versiones (minReader)', () => {
  it('canRead respeta major y mínimo', () => {
    expect(canRead('1.2.0', '1.0.0')).toBe(true)
    expect(canRead('1.0.0', '1.1.0')).toBe(false)
    expect(canRead('2.0.0', '1.0.0')).toBe(false)
  })

  it('assertManifest acepta el ejemplo y rechaza majors no soportados', () => {
    const m = read('examples/manifest.example.json')
    expect(() => assertManifest(m, '1.0.0')).not.toThrow()
    const future = { ...m, schemaVersion: '2.0.0', minReader: '2.0.0' }
    try {
      assertManifest(future, '1.0.0')
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(ManifestError)
      expect((e as ManifestError).code).toBe('unsupported-version')
    }
    expect(() => assertManifest({ schema: 'otro' }, '1.0.0')).toThrow(ManifestError)
  })
})
