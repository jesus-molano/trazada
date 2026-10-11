import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compoundLetter, compoundToken } from './compound'

const css = readFileSync(join(__dirname, '../../design/tokens.css'), 'utf8')
const ENUM = ['UNKNOWN', 'SOFT', 'MEDIUM', 'HARD', 'INTERMEDIATE', 'WET', 'TEST_UNKNOWN', 'HYPERSOFT', 'ULTRASOFT', 'SUPERSOFT']

describe('compuestos', () => {
  it('desde 2019, blando/medio/duro relativos (rojo, amarillo, blanco)', () => {
    expect(compoundToken(2026, 'SOFT')).toBe('--tz-tyre-soft')
    expect(compoundToken(2019, 'HARD')).toBe('--tz-tyre-hard')
  })

  it('2018: cada compuesto con su color propio (blando amarillo, medio blanco, duro azul hielo; HS/US/SS)', () => {
    expect(compoundToken(2018, 'SOFT')).toBe('--tz-tyre-soft-2018')
    expect(compoundToken(2018, 'HARD')).toBe('--tz-tyre-hard-2018')
    expect(compoundToken(2018, 'HYPERSOFT')).toBe('--tz-tyre-hypersoft')
    expect(compoundLetter('ULTRASOFT')).toBe('US')
  })

  it('sin dato, gris de «sin dato» y «?»; nunca un compuesto inventado', () => {
    for (const c of ['UNKNOWN', 'TEST_UNKNOWN', 'constructor', '']) {
      expect(compoundToken(2026, c)).toBe('--tz-tyre-unknown')
      expect(compoundLetter(c)).toBe('?')
    }
  })

  it('todo token que devuelve existe en tokens.css (todas las temporadas, todo el enum)', () => {
    for (const season of [2018, 2019, 2026])
      for (const c of ENUM) expect(css, `${season} ${c}`).toContain(`${compoundToken(season, c)}:`)
  })
})
