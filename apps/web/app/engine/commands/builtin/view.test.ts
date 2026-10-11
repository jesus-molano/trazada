/**
 * «Centrar» desde la paleta (D53) sobre la carrera sintética de `testing/commands.ts`: en español y en inglés; con la
 * vista ya en su sitio, deshabilitado; sin la escena (sin su servicio), no se ofrece.
 */
import { describe, expect, it } from 'vitest'
import { paletteContext, recordingServices, withoutMoments } from '../../../testing/commands'
import { BUILTIN_COMMANDS, suggest } from '../registry'

function run(input: string, o: { moved?: boolean; view?: boolean } = {}) {
  const rec = recordingServices()
  const view = { moved: o.moved ?? true, recenter: () => void rec.calls.push('recenter') }
  const services = o.view === false ? withoutMoments(rec.services) : { ...withoutMoments(rec.services), view }
  const list = suggest(BUILTIN_COMMANDS, input, paletteContext({ services }))
  return { list, calls: rec.calls }
}

describe('camera.center', () => {
  it.each(['centrar', 'centrar el mapa', 'recentrar', 'center', 'recenter', 'reset view', 'centre map'])(
    '«%s» → «Centrar», la primera y en «Cámara»; Enter centra',
    (input) => {
      const { list, calls } = run(input)
      const s = list[0]!
      expect(s.key).toBe('camera.center')
      expect(s.group).toBe('camera')
      expect(s.title.key).toBe('view.cmd.title')
      s.run!()
      expect(calls).toEqual(['recenter'])
    },
  )

  it('con la vista ya en su sitio: deshabilitado con su motivo', () => {
    const s = run('centrar', { moved: false }).list[0]!
    expect(s.key).toBe('camera.center')
    expect(s.run).toBeUndefined()
    expect(s.disabled?.key).toBe('view.cmd.already')
  })

  it('no sale con la paleta vacía ni sin la escena', () => {
    expect(run('').list.map((s) => s.key)).not.toContain('camera.center')
    expect(run('centrar', { view: false }).list.map((s) => s.key)).not.toContain('camera.center')
  })
})
