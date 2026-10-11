import { readFileSync } from 'node:fs'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'
import { assertManifest, canRead, ManifestError, MIN_READER, QUALITY_NOTE_CODES, SCHEMA_VERSION } from '../src'

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

  it('meteorología (1.1.0): opcional en eventos y en el manifest, con null como «sin dato»', () => {
    const events = validator('events.schema.json')
    const withWeather = read('examples/events.example.json')
    expect(withWeather.weather.airC).toContain(null)
    expect(events(withWeather)).toBe(true)
    // Unos eventos de 1.0.0 (sin meteorología) siguen siendo válidos.
    const { weather: _weather, ...old } = withWeather
    expect(events({ ...old, schemaVersion: '1.0.0' })).toBe(true)
    // Lluvia sí/no, nunca intensidad; dirección en grados enteros 0–359; humedad 0–100.
    for (const [key, bad] of [
      ['rain', [0.4, false, null]],
      ['windDeg', [360, 0, null]],
      ['windDeg', [12.5, 0, null]],
      ['humidity', [101, 50, null]],
      ['pressureHpa', [0, 966, null]],
      ['windMs', [-1, 0, null]],
    ] as const) {
      expect(events({ ...withWeather, weather: { ...withWeather.weather, [key]: bad } }), `${key}: ${bad}`).toBe(false)
    }
    const { windDeg: _deg, ...missing } = withWeather.weather
    expect(events({ ...withWeather, weather: missing })).toBe(false)

    const manifest = validator('manifest.schema.json')
    const m = read('examples/manifest.example.json')
    expect(m.channels.weather).toBe('present')
    expect(manifest({ ...m, channels: { ...m.channels, weather: 'absent' } })).toBe(true)
    const { weather: _channel, ...oldChannels } = m.channels
    expect(manifest({ ...m, channels: oldChannels })).toBe(true)
    expect(manifest({ ...m, channels: { ...m.channels, weather: 'partial' } })).toBe(false)
  })

  it('radio (1.2.0): opcional en eventos y en el manifest; clips con su ruta por contenido', () => {
    const events = validator('events.schema.json')
    const withRadio = read('examples/events.example.json')
    expect(withRadio.radio).toHaveLength(2)
    expect(events(withRadio)).toBe(true)
    // Unos eventos de 1.1.0 (sin radio) siguen siendo válidos.
    const { radio: _radio, ...old } = withRadio
    expect(events({ ...old, schemaVersion: '1.1.0' })).toBe(true)
    const clip = withRadio.radio[0]
    for (const bad of [
      { ...clip, file: '../../etc/passwd' },
      { ...clip, file: 'radio/0123456789ABCDEF.mp3' },
      { ...clip, file: 'https://example.com/a.mp3' },
      { ...clip, car: 'HAM' },
      { ...clip, bytes: 0 },
      { ...clip, t: 1.5 },
      { t: clip.t, car: clip.car, file: clip.file },
    ]) {
      expect(events({ ...withRadio, radio: [bad] }), JSON.stringify(bad)).toBe(false)
    }

    const manifest = validator('manifest.schema.json')
    const m = read('examples/manifest.example.json')
    for (const radio of ['present', 'absent', 'partial']) expect(manifest({ ...m, channels: { ...m.channels, radio } })).toBe(true)
    const { radio: _channel, ...oldChannels } = m.channels
    expect(manifest({ ...m, channels: oldChannels })).toBe(true)
    expect(manifest({ ...m, channels: { ...m.channels, radio: 'some' } })).toBe(false)
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
    // Datos 1.1.0 (meteorología) con lector mínimo 1.0.0: un lector 1.0.0 los lee e ignora lo que no conoce.
    expect(m.schemaVersion).toBe(SCHEMA_VERSION)
    expect(MIN_READER).toBe('1.0.0')
    expect(m.minReader).toBe(MIN_READER)
    expect(() => assertManifest(m, SCHEMA_VERSION)).not.toThrow()
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
