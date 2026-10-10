import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { QUALITY_NOTE_CODES } from '@trazada/schema'
import { describe, expect, it } from 'vitest'
import { classifyLegacy, LEGACY_NOTES, noteKey, qualityNotes } from './quality-notes'

type Tree = { [k: string]: string | Tree }
const locale = (lang: string) =>
  JSON.parse(readFileSync(new URL(`../../i18n/locales/${lang}.json`, import.meta.url), 'utf8')) as Tree
const noteTexts = (lang: string) => ((locale(lang).sessionNotes as Tree).note ?? {}) as Tree

/** Todo el código Python del pipeline, para comprobar que los textos antiguos reconocidos siguen saliendo de ahí. */
function pipelineSource(): string {
  const root = fileURLToPath(new URL('../../../../pipeline/src', import.meta.url))
  const files = readdirSync(root, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.py'))
  return files.map((f) => readFileSync(join(root, f), 'utf8')).join('\n')
}

/** Parámetros que emite el pipeline para cada código (`QualityNote(code, text, params)`), leídos del código. */
function pipelineParams(): Map<string, Set<string>> {
  const src = pipelineSource()
  const out = new Map<string, Set<string>>()
  for (const m of src.matchAll(/QualityNote\(\s*"([a-z0-9-]+)",/g)) {
    // Hasta el paréntesis que cierra la llamada (las f-strings y los params llevan paréntesis dentro).
    let depth = 0
    let end = m.index
    for (; end < src.length; end++) {
      if (src[end] === '(') depth++
      else if (src[end] === ')' && --depth === 0) break
    }
    const keys = [...src.slice(m.index, end).matchAll(/"([A-Za-z]+)":/g)].map((k) => k[1]!)
    out.set(m[1]!, new Set([...(out.get(m[1]!) ?? []), ...keys]))
  }
  return out
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort()

describe('avisos de calidad del manifest', () => {
  it('los avisos con código se traducen por código, con sus parámetros (la cobertura en %)', () => {
    expect(
      qualityNotes([
        { code: 'finish-line-fallback', text: 'Línea de meta aproximada…', params: { laps: 2 } },
        { code: 'position-coverage-low', text: 'cobertura…', params: { cars: 1, minPos: 0.979 } },
        { code: 'circuit-rebuilt', text: '…', params: { circuit: '7-a', reason: 'outdated' } },
      ]),
    ).toEqual([
      { code: 'finish-line-fallback', key: 'finish-line-fallback', params: { laps: 2 } },
      { code: 'position-coverage-low', key: 'position-coverage-low', params: { cars: 1, minPos: 97.9 } },
      { code: 'circuit-rebuilt', key: 'circuit-rebuilt.outdated', params: { circuit: '7-a', reason: 'outdated' } },
    ])
    expect(noteKey('circuit-outdated-kept', { reason: 'nuevo-motivo' })).toBe('circuit-outdated-kept.other')
  })

  it('un código desconocido (pipeline más nuevo) no se descarta: se muestra su texto original', () => {
    const notes = qualityNotes([{ code: 'algo-nuevo' as never, text: '  aviso nuevo  ' }])
    expect(notes).toEqual([{ code: null, text: 'aviso nuevo' }])
  })

  it('manifests anteriores (texto libre): se reconocen por patrón, con sus cifras', () => {
    for (const known of LEGACY_NOTES) expect(classifyLegacy(known.example).code, known.example).toBe(known.code)
    expect(classifyLegacy('cierre de la línea central 2.35 m > 2 m')).toEqual({
      code: 'centerline-not-closed',
      key: 'centerline-not-closed',
      params: { closureM: 2.35 },
    })
    expect(classifyLegacy('  meta desde el valor de reserva (5 m)  ')).toEqual({
      code: null,
      text: 'meta desde el valor de reserva (5 m)',
    })
  })

  it('sin vacíos ni repetidos, en su orden', () => {
    expect(qualityNotes(undefined)).toEqual([])
    const e2e = { code: 'e2e-extract' as const, text: 'Extracto recortado para tests e2e.' }
    expect(qualityNotes([e2e, '', 'otro aviso', e2e, { ...e2e, params: {} }])).toEqual([
      { code: 'e2e-extract', key: 'e2e-extract', params: {} },
      { code: null, text: 'otro aviso' },
    ])
  })

  it('cada código del esquema tiene su texto en es y en (y uno por motivo), con los parámetros que emite el pipeline', () => {
    const emitted = pipelineParams()
    for (const lang of ['es', 'en']) {
      const notes = noteTexts(lang)
      expect(Object.keys(notes).sort()).toEqual([...QUALITY_NOTE_CODES].sort())
      for (const code of QUALITY_NOTE_CODES) {
        const entry = notes[code]!
        const texts = typeof entry === 'string' ? { '': entry } : (entry as Record<string, string>)
        if (typeof entry !== 'string') expect(Object.keys(texts), `${lang}:${code}`).toContain('other')
        const params = emitted.get(code) ?? new Set<string>()
        for (const [reason, text] of Object.entries(texts)) {
          // Cada hueco del texto es un parámetro que el pipeline emite para ese código.
          for (const p of placeholders(text)) expect(params.has(p), `${lang}:${code}${reason && `.${reason}`} {${p}}`).toBe(true)
        }
      }
    }
  })

  it('todo código que emite el pipeline está en el esquema', () => {
    for (const code of pipelineParams().keys()) expect(QUALITY_NOTE_CODES, code).toContain(code)
  })
})
