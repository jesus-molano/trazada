import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

type Tree = { [k: string]: string | Tree }
const load = (lang: string) => JSON.parse(readFileSync(new URL(`../../i18n/locales/${lang}.json`, import.meta.url), 'utf8')) as Tree

function flatten(tree: Tree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>()
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string') out.set(key, v)
    else for (const [kk, vv] of flatten(v, key)) out.set(kk, vv)
  }
  return out
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

describe('i18n', () => {
  const es = flatten(load('es'))
  const en = flatten(load('en'))

  it('es y en tienen exactamente las mismas claves', () => {
    expect([...es.keys()].filter((k) => !en.has(k))).toEqual([])
    expect([...en.keys()].filter((k) => !es.has(k))).toEqual([])
  })

  it('cada clave usa los mismos parámetros en los dos idiomas y ningún texto está vacío', () => {
    for (const [k, v] of es) {
      expect(placeholders(v), k).toEqual(placeholders(en.get(k)!))
      expect(v.trim(), k).not.toBe('')
      expect(en.get(k)!.trim(), k).not.toBe('')
    }
  })
})
