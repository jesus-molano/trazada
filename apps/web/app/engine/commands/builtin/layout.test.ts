/**
 * Comandos de diseño (ítem 15, con la paleta del ítem 14): de lo escrito (español e inglés, sin tildes ni mayúsculas)
 * al diseño, al otro diseño o a los anchos por defecto, y lo deshabilitado con su motivo.
 */
import { describe, expect, it } from 'vitest'
import { paletteContext, recordingServices, withoutMoments } from '../../../testing/commands'
import type { LayoutPreset } from '../../layout/presets'
import { BUILTIN_COMMANDS, suggest } from '../registry'
import type { Suggestion } from '../types'
import type { LayoutService } from './layout'

interface LayoutOptions {
  preset?: LayoutPreset
  customized?: boolean
  resizable?: boolean
}

function run(input: string, o: LayoutOptions = {}) {
  const rec = recordingServices()
  const calls: string[] = []
  const layout: LayoutService = {
    preset: o.preset ?? 'spectator',
    customized: o.customized ?? false,
    resizable: o.resizable ?? true,
    setPreset: (p) => calls.push(`preset:${p}`),
    resetWidths: () => calls.push('reset'),
  }
  const ctx = paletteContext({ services: { ...withoutMoments(rec.services), layout } })
  return { list: suggest(BUILTIN_COMMANDS, input, ctx), calls }
}

const top = (input: string, o?: LayoutOptions): Suggestion => {
  const s = run(input, o).list[0]
  if (!s) throw new Error(`sin sugerencias para «${input}»`)
  return s
}

describe('diseño desde la paleta (ítem 15)', () => {
  it.each([
    ['diseño análisis', 'layout.preset.analysis'],
    ['modo analisis', 'layout.preset.analysis'],
    ['analysis layout', 'layout.preset.analysis'],
    ['Diseño Espectador', 'layout.preset.spectator'],
    ['spectator', 'layout.preset.spectator'],
    ['restablecer anchos', 'layout.reset'],
    ['reset layout', 'layout.reset'],
  ])('«%s» → %s', (input, key) => {
    // Habilitada o no (ya en ese diseño, nada que restablecer), es la primera sugerencia.
    expect(top(input).key).toBe(key)
  })

  it('elegir el otro diseño: lo dice antes de Enter y lo aplica', () => {
    const { list, calls } = run('diseño analisis')
    const s = list[0]!
    expect(s.key).toBe('layout.preset.analysis')
    expect(s.group).toBe('layout')
    expect(s.title.key).toBe('layout.cmd.analysis.title')
    expect(s.detail?.key).toBe('layout.cmd.analysis.detail')
    s.run!()
    expect(calls).toEqual(['preset:analysis'])
  })

  it('el diseño en el que ya estás sale deshabilitado, con el motivo', () => {
    const s = top('modo espectador', { preset: 'spectator' })
    expect(s.key).toBe('layout.preset.spectator')
    expect(s.run).toBeUndefined()
    expect(s.disabled?.key).toBe('layout.cmd.already')
  })

  it('«cambiar de diseño» sin decir cuál: el otro', () => {
    expect(top('cambiar de diseño', { preset: 'spectator' }).key).toBe('layout.preset.analysis')
    expect(top('switch layout', { preset: 'analysis' }).key).toBe('layout.preset.spectator')
  })

  it('restablecer: solo con anchos elegidos y fuera de la tablet en vertical', () => {
    const ok = run('restablecer anchos', { preset: 'analysis', customized: true })
    const s = ok.list[0]!
    expect(s.key).toBe('layout.reset')
    expect(s.detail?.key).toBe('layout.cmd.reset.detail.analysis')
    s.run!()
    expect(ok.calls).toEqual(['reset'])

    const none = top('restablecer anchos', { customized: false })
    expect(none.run).toBeUndefined()
    expect(none.disabled?.key).toBe('layout.cmd.reset.none')

    const portrait = top('reset widths', { customized: true, resizable: false })
    expect(portrait.run).toBeUndefined()
    expect(portrait.disabled?.key).toBe('layout.cmd.reset.portrait')
  })

  it('sin consulta no se ofrecen (la lista inicial es de las demás funciones)', () => {
    expect(run('').list.filter((s) => s.group === 'layout')).toEqual([])
  })

  it('sin el servicio de diseño, no se ofrecen', () => {
    const ctx = paletteContext({ services: withoutMoments(recordingServices().services) })
    expect(suggest(BUILTIN_COMMANDS, 'diseño analisis', ctx).filter((s) => s.group === 'layout')).toEqual([])
  })
})
