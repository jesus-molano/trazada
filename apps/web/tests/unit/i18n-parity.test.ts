import { readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BASE_NAMESPACE, loadMessages, loadNamespace, LOCALES_DIR, type Messages, namespaces } from '../../i18n/messages'

const LOCALES = ['es', 'en']

function keys(obj: Messages, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'string' ? [`${prefix}${k}`] : keys(v, `${prefix}${k}.`),
  )
}

describe('i18n', () => {
  it('hay una carpeta por idioma y nada más en locales/', () => {
    expect(readdirSync(LOCALES_DIR).sort()).toEqual([...LOCALES].sort())
  })

  it('es y en tienen los mismos namespaces (un fichero por namespace, base incluido)', () => {
    expect(namespaces('es')).toContain(BASE_NAMESPACE)
    expect(namespaces('en')).toEqual(namespaces('es'))
  })

  it('cada namespace que no es base tiene una sola raíz, con su nombre', () => {
    for (const locale of LOCALES) {
      for (const ns of namespaces(locale).filter((n) => n !== BASE_NAMESPACE)) {
        expect(Object.keys(loadNamespace(locale, ns)), `${locale}/${ns}.json`).toEqual([ns])
      }
    }
  })

  it('ninguna raíz se repite entre ficheros (se fusionarían en silencio)', () => {
    for (const locale of LOCALES) expect(() => loadMessages(locale)).not.toThrow()
  })

  it('es y en tienen exactamente las mismas claves, también fichero a fichero', () => {
    expect(keys(loadMessages('en')).sort()).toEqual(keys(loadMessages('es')).sort())
    for (const ns of namespaces('es')) {
      expect(keys(loadNamespace('en', ns)).sort(), ns).toEqual(keys(loadNamespace('es', ns)).sort())
    }
  })

  it('ningún mensaje está vacío', () => {
    for (const locale of LOCALES) {
      const messages = loadMessages(locale)
      for (const key of keys(messages)) {
        const value = key.split('.').reduce<Messages | string>((acc, part) => (acc as Messages)[part]!, messages)
        expect(value, `${locale}:${key}`).not.toBe('')
      }
    }
  })
})
