/**
 * «Ver la guía» desde la paleta (ítem 18) sobre la carrera sintética de `testing/commands.ts`: en español y en inglés,
 * con o sin verbo delante, sin quitarle «ver» (VER, Verstappen) a los pilotos; con la paleta vacía, al final y en
 * «Ayuda»; abierta, deshabilitada; sin la guía montada (sin su servicio), no se ofrece.
 */
import { describe, expect, it } from 'vitest'
import { paletteContext, recordingServices, withoutMoments } from '../../../testing/commands'
import { BUILTIN_COMMANDS, suggest } from '../registry'
import { TIPS_FEATURED_SCORE } from './tips'

function run(input: string, o: { open?: boolean; tips?: boolean } = {}) {
  const rec = recordingServices()
  const tips = { open: o.open ?? false, start: () => void rec.calls.push('tips') }
  const services = o.tips === false ? withoutMoments(rec.services) : { ...withoutMoments(rec.services), tips }
  const list = suggest(BUILTIN_COMMANDS, input, paletteContext({ services }))
  return { list, calls: rec.calls }
}

describe('help.tips', () => {
  it.each(['guía', 'guia', 'ver la guía', 'abrir la guia', 'ayuda', 'tutorial', 'primeros pasos', 'help', 'show guide', 'guide', 'tour'])(
    '«%s» → la guía, la primera; Enter la abre',
    (input) => {
      const { list, calls } = run(input)
      const s = list[0]!
      expect(s.key).toBe('help.tips')
      expect(s.group).toBe('help')
      expect(s.title.key).toBe('tips.cmd.title')
      expect(s.detail?.key).toBe('tips.cmd.detail')
      s.run!()
      expect(calls).toEqual(['tips'])
    },
  )

  it('«ver» sigue siendo VER (un piloto), no la guía', () => {
    const { list } = run('ver')
    expect(list[0]!.key).toBe('drivers.select.3')
    expect(list.map((s) => s.key)).not.toContain('help.tips')
  })

  it('con la paleta vacía, al final y en «Ayuda»', () => {
    const { list } = run('')
    const i = list.findIndex((s) => s.key === 'help.tips')
    expect(i).toBe(list.length - 1)
    expect(list[i]!.score).toBe(TIPS_FEATURED_SCORE)
  })

  it('abierta: deshabilitada con su motivo (y fuera de la paleta vacía)', () => {
    const s = run('guía', { open: true }).list[0]!
    expect(s.key).toBe('help.tips')
    expect(s.run).toBeUndefined()
    expect(s.disabled?.key).toBe('tips.cmd.already')
    expect(run('', { open: true }).list.map((x) => x.key)).not.toContain('help.tips')
  })

  it('sin la guía montada, no se ofrece', () => {
    expect(run('guía', { tips: false }).list.map((s) => s.key)).not.toContain('help.tips')
  })
})
