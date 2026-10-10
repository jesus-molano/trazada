import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { duration, parseCssTime } from './motion'
import { token } from './tokens'

const APP = fileURLToPath(new URL('..', import.meta.url))

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : [path]
  })
}

describe('tokens de diseño', () => {
  it('un único fichero con color, espacio, tipografía, radios, capas y movimiento', () => {
    const css = readFileSync(join(APP, 'design/tokens.css'), 'utf8')
    for (const prefix of ['--tz-bg', '--tz-space-', '--tz-text-', '--tz-font-', '--tz-radius-', '--tz-z-', '--tz-dur-', '--tz-ease-']) {
      expect(css, prefix).toContain(prefix)
    }
    const elsewhere = files(APP)
      .filter((f) => /\.(css|vue)$/.test(f) && !f.endsWith('tokens.css'))
      .filter((f) => /^\s*--tz-[\w-]+\s*:/m.test(readFileSync(f, 'utf8')))
    expect(elsewhere).toEqual([])
  })

  it('ningún color literal fuera de tokens.css (three.js y uPlot los leen con token())', () => {
    const offenders: string[] = []
    for (const f of files(APP)) {
      if (!/\.(vue|ts)$/.test(f) || f.endsWith('.test.ts')) continue
      const src = readFileSync(f, 'utf8')
      for (const m of src.matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|rgba?\(\s*\d/g)) offenders.push(`${relative(APP, f)}: ${m[0]}`)
    }
    expect(offenders).toEqual([])
  })

  it('sin documento, token() devuelve el valor de :root (no el de reduced motion)', () => {
    expect(token('--tz-sc')).toMatch(/^#[0-9a-f]{6}$/i)
    expect(token('--tz-dur-camera')).toBe('900ms')
    expect(duration('camera')).toBe(0.9)
    expect(() => token('--tz-no-existe')).toThrow()
  })

  it('duraciones en ms o en s (el CSS minificado escribe 900ms como .9s)', () => {
    expect(parseCssTime('900ms')).toBe(0.9)
    expect(parseCssTime('.9s')).toBe(0.9)
    expect(parseCssTime('0ms')).toBe(0)
    expect(() => parseCssTime('rápido')).toThrow()
  })
})
