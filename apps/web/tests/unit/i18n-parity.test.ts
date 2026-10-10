import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

type Messages = { [key: string]: string | Messages }

function load(locale: string): Messages {
  return JSON.parse(readFileSync(new URL(`../../i18n/locales/${locale}.json`, import.meta.url), 'utf8'))
}

function keys(obj: Messages, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'string' ? [`${prefix}${k}`] : keys(v, `${prefix}${k}.`),
  )
}

describe('i18n', () => {
  it('es y en tienen exactamente las mismas claves', () => {
    expect(keys(load('en')).sort()).toEqual(keys(load('es')).sort())
  })

  it('ningún mensaje está vacío', () => {
    for (const locale of ['es', 'en']) {
      const messages = load(locale)
      for (const key of keys(messages)) {
        const value = key.split('.').reduce<Messages | string>((acc, part) => (acc as Messages)[part]!, messages)
        expect(value, `${locale}:${key}`).not.toBe('')
      }
    }
  })
})
