/**
 * Iconos coherentes (D30): todo icono sale del registro semántico (design/icons.ts) y se pinta con TzIcon.
 * La lista permitida de símbolos sueltos de antes quedó vacía en la Tanda 5 (play/pausa, «ⓘ» de los desplegables y
 * «×» de la telemetría pasaron a TzIcon); una entrada nueva tendría que justificarse aquí.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ICON_NAMES, ICONS, isIconName } from './icons'

const APP = fileURLToPath(new URL('..', import.meta.url))
/** Ruta relativa con «/» (en Windows, `relative` usa «\»). */
const posix = (path: string) => path.split(sep).join('/')

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : [path]
  })
}

const VUE = files(APP)
  .filter((f) => f.endsWith('.vue'))
  .map((f) => ({ file: posix(relative(APP, f)), src: readFileSync(f, 'utf8') }))

/** Plantilla de un SFC, sin comentarios HTML. */
const template = (src: string) => (/<template>([\s\S]*)<\/template>/.exec(src)?.[1] ?? '').replace(/<!--[\s\S]*?-->/g, '')

/** Glifos que hacen de icono: si son todo el texto de un nodo, deberían ser un TzIcon. */
const GLYPH_ONLY = /^[×✕✖✗✘ⓘℹ▸▾▶◀▲▼◂▴►◄←→↑↓‹›⟵⟶⌄⌃☰⋮⋯✓✔]+$/u

function glyphNodes(src: string): string[] {
  return [...template(src).matchAll(/>([^<>]*)</g)].map((m) => m[1]!.trim()).filter((text) => text && GLYPH_ONLY.test(text))
}

const inlineSvgs = (src: string) => (template(src).match(/<svg[\s>]/g) ?? []).length

/** Componentes que dibujan datos, no iconos: pueden llevar su <svg> (trazado del circuito). */
const SVG_DATA_MARKS = new Set(['components/TzTrackOutline.vue'])

/** Infractores de antes de D30: ninguno desde la Tanda 5 (B1 migró los últimos a TzIcon). */
const ALLOWED_INLINE_SVG: Record<string, number> = {}
const ALLOWED_GLYPHS: Record<string, string[]> = {}

describe('iconos (D30)', () => {
  it('el registro solo tiene componentes de Lucide, con nombres de la app', () => {
    expect(ICON_NAMES.length).toBeGreaterThan(0)
    for (const name of ICON_NAMES) {
      expect(name).toMatch(/^[a-z][a-zA-Z]*$/)
      expect(typeof ICONS[name], name).toBe('function')
      expect(isIconName(name)).toBe(true)
    }
    expect(isIconName('no-existe')).toBe(false)
    expect(isIconName('toString')).toBe(false)
  })

  it('sin iconos de IA, coches, trofeos ni banderas a cuadros (legal y honestidad)', () => {
    const imports = /import\s*\{([^}]*)\}\s*from\s*'@lucide\/vue'/.exec(readFileSync(join(APP, 'design/icons.ts'), 'utf8'))?.[1] ?? ''
    const lucideNames = imports.split(',').map((s) => s.replace(/^\s*type\s+/, '').trim().split(/\s+as\s+/)[0]!).filter(Boolean)
    expect(lucideNames.length).toBeGreaterThan(0)
    const banned = /sparkle|wand|bot|brain|cpu|car|racing|trophy|medal|checkered|flagTriangle/i
    for (const n of [...ICON_NAMES, ...lucideNames]) expect(n, n).not.toMatch(banned)
  })

  it('solo design/icons.ts importa @lucide/vue', () => {
    const offenders = files(APP)
      .filter((f) => /\.(vue|ts)$/.test(f) && !f.endsWith('.test.ts') && !posix(f).endsWith('design/icons.ts'))
      .filter((f) => /from\s+['"]@lucide\//.test(readFileSync(f, 'utf8')))
      .map((f) => posix(relative(APP, f)))
    expect(offenders).toEqual([])
  })

  it('ningún <svg> en línea fuera de TzIcon y de las marcas de datos (salvo la lista permitida)', () => {
    const found: Record<string, number> = {}
    for (const { file, src } of VUE) {
      const n = inlineSvgs(src)
      if (n > 0 && !SVG_DATA_MARKS.has(file)) found[file] = n
    }
    expect(found).toEqual(ALLOWED_INLINE_SVG)
  })

  it('ningún glifo suelto (×, ⓘ, ▸, ←…) como texto de un nodo: va un TzIcon (salvo la lista permitida)', () => {
    const found: Record<string, string[]> = {}
    for (const { file, src } of VUE) {
      const glyphs = glyphNodes(src)
      if (glyphs.length) found[file] = glyphs
    }
    expect(found).toEqual(ALLOWED_GLYPHS)
  })

  it('el detector distingue un icono de un dato («×2» de velocidad, «—» sin dato, «·» separador)', () => {
    const tpl = (body: string) => `<template>${body}</template>`
    expect(glyphNodes(tpl('<button>×</button><span>▸</span>'))).toEqual(['×', '▸'])
    expect(glyphNodes(tpl('<button>×{{ r }}</button><span>—</span><span>·</span><b>×2</b>'))).toEqual([])
    expect(inlineSvgs(tpl('<TzIcon name="close" /><svg viewBox="0 0 1 1"></svg>'))).toBe(1)
  })
})
