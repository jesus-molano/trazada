import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { classifyNote, KNOWN_NOTES, qualityNotes } from './quality-notes'

type Tree = { [k: string]: string | Tree }
const locale = (lang: string) =>
  JSON.parse(readFileSync(new URL(`../../i18n/locales/${lang}.json`, import.meta.url), 'utf8')) as Tree

/** Todo el código Python del pipeline, para comprobar que los textos reconocidos siguen saliendo de ahí. */
function pipelineSource(): string {
  const root = fileURLToPath(new URL('../../../../pipeline/src', import.meta.url))
  const files = readdirSync(root, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.py'))
  return files.map((f) => readFileSync(join(root, f), 'utf8')).join('\n')
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

describe('avisos de calidad del manifest', () => {
  it('reconoce cada aviso que escribe hoy el pipeline, con sus cifras', () => {
    for (const known of KNOWN_NOTES) expect(classifyNote(known.example).code, known.example).toBe(known.code)
    expect(classifyNote('cierre de la línea central 2.35 m > 2 m')).toEqual({ code: 'closure', params: { m: 2.35 } })
    expect(classifyNote('longitud 7104 m vs oficial 7004 m (> 3 %)')).toEqual({
      code: 'length',
      params: { m: 7104, official: 7004 },
    })
    expect(classifyNote(KNOWN_NOTES.find((k) => k.code === 'circuitDev')!.example)).toEqual({
      code: 'circuitDev',
      params: { circuit: 'suzuka-dev' },
    })
  })

  it('un aviso desconocido no se descarta: se devuelve con su texto original', () => {
    expect(classifyNote('  meta desde el valor de reserva (5 m)  ')).toEqual({
      code: null,
      text: 'meta desde el valor de reserva (5 m)',
    })
  })

  it('sin vacíos ni repetidos, en su orden', () => {
    expect(qualityNotes(undefined)).toEqual([])
    expect(
      qualityNotes(['Extracto recortado para tests e2e.', '', 'otro aviso', 'Extracto recortado para tests e2e.']),
    ).toEqual([{ code: 'e2eExtract', params: {} }, { code: null, text: 'otro aviso' }])
  })

  it('los textos reconocidos siguen en el código del pipeline (si cambian allí, hay que cambiarlos aquí)', () => {
    const src = pipelineSource()
    for (const known of KNOWN_NOTES) expect(src.includes(known.anchor), known.anchor).toBe(true)
  })

  it('un umbral fijo que dice el texto traducido («99 %», «3 %») está en el ancla: si cambia en el pipeline, se avisa', () => {
    const notes = (locale('es').sessionNotes as Tree).note as Tree
    for (const known of KNOWN_NOTES) {
      const fixed = [...(notes[known.code] as string).matchAll(/(\d+(?:,\d+)?) %/g)].map((m) => `${m[1]!.replace(',', '.')} %`)
      for (const f of fixed) expect(known.anchor, `${known.code}: ${f}`).toContain(f)
    }
  })

  it('cada código tiene su texto en es y en, con los mismos parámetros que extrae', () => {
    for (const lang of ['es', 'en']) {
      const notes = ((locale(lang).sessionNotes as Tree).note ?? {}) as Tree
      for (const known of KNOWN_NOTES) {
        const text = notes[known.code]
        expect(typeof text, `${lang}:${known.code}`).toBe('string')
        const parsed = classifyNote(known.example)
        const params = parsed.code === null ? [] : Object.keys(parsed.params).sort()
        expect(placeholders(text as string), `${lang}:${known.code}`).toEqual(params)
      }
      // Ninguna clave de más (un código que ya no existe).
      expect(Object.keys(notes).sort()).toEqual(KNOWN_NOTES.map((k) => k.code).sort())
    }
  })
})
