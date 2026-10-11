import { describe, expect, it } from 'vitest'
import { loadFixture } from '../../testing/fixture'
import { paletteContext, recordingServices } from '../../testing/commands'
import { buildLapTable } from '../analysis/lapTable'
import { buildTimelineMarkers } from '../timeline/markers'
import { commandSessionInfo } from './context'
import { BUILTIN_COMMANDS, collectCommands, flatten, groupSuggestions, MAX_SUGGESTIONS, suggest } from './registry'
import { type CommandDef, type Suggestion, t } from './types'

const fixed = (id: string, list: Partial<Suggestion>[], needs?: CommandDef['needs']): CommandDef => ({
  id,
  needs,
  suggest: () =>
    list.map((s, i) => ({ key: `${id}.${i}`, group: 'goto', score: 0.5, title: t('palette.title'), ...s }) as Suggestion),
})

describe('registro de comandos', () => {
  it('los de serie salen de builtin/*.ts por glob (sin los tests), con ids únicos', () => {
    const ids = BUILTIN_COMMANDS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ['playback.play', 'playback.rate', 'drivers.follow', 'goto.lap', 'goto.markers', 'compare.pair', 'resume.back']) {
      expect(ids, id).toContain(id)
    }
  })

  it('un fichero sin `commands`, sin id o con un id repetido es un error al cargar', () => {
    expect(() => collectCommands({ './builtin/x.ts': {} })).toThrow(/commands/)
    expect(() => collectCommands({ './builtin/x.ts': { commands: [{ id: '', suggest: () => [] }] } })).toThrow(/id/)
    const a = fixed('a', [])
    expect(() => collectCommands({ './builtin/x.ts': { commands: [a] }, './builtin/y.ts': { commands: [a] } })).toThrow(/repetido/)
  })

  it('ordena por puntuación (a igualdad, por grupo y llegada), quita repetidas, corta y deja fuera lo que no encaja', () => {
    const cmds = [
      fixed('a', [
        { key: 'x', score: 0.4, group: 'playback' },
        { key: 'y', score: 0.9, group: 'goto' },
        { key: 'low', score: 0.1 },
      ]),
      fixed('b', [
        { key: 'x', score: 0.4, group: 'drivers' },
        { key: 'z', score: 0.4, group: 'drivers' },
      ]),
    ]
    const keys = suggest(cmds, 'algo', paletteContext()).map((s) => s.key)
    expect(keys).toEqual(['y', 'x', 'z'])
    const many = fixed('m', Array.from({ length: 40 }, (_, i) => ({ key: `k${i}`, score: 0.5 })))
    expect(suggest([many], 'algo', paletteContext())).toHaveLength(MAX_SUGGESTIONS)
  })

  it('un comando sin sus servicios no se ofrece', () => {
    const cmd = fixed('c', [{ key: 'c' }], ['compare'])
    const { services } = recordingServices()
    expect(suggest([cmd], 'x', paletteContext({ services }))).toHaveLength(1)
    expect(suggest([cmd], 'x', paletteContext({ services: { playback: services.playback } }))).toHaveLength(0)
  })

  it('agrupa en el orden en que aparece cada grupo; ↑/↓ recorre los grupos en ese orden', () => {
    const s = (key: string, group: Suggestion['group']) => ({ key, group, score: 1, title: t('palette.title') }) as Suggestion
    const groups = groupSuggestions([s('a', 'goto'), s('b', 'drivers'), s('c', 'goto')])
    expect(groups.map((g) => [g.group, g.items.map((i) => i.key)])).toEqual([
      ['goto', ['a', 'c']],
      ['drivers', ['b']],
    ])
    expect(flatten(groups).map((i) => i.key)).toEqual(['a', 'c', 'b'])
  })
})

describe('commandSessionInfo', () => {
  it('con el fixture (libres 1 de Spa): sin vueltas del líder, reloj desde el inicio de la sesión', async () => {
    const session = await loadFixture()
    const { type, playback } = session.manifest.session
    const info = commandSessionInfo(
      {
        session,
        drivers: session.manifest.drivers,
        markers: buildTimelineMarkers(type, session.timing, session.events, playback.endMs),
        leaderboard: { lapTable: buildLapTable(type, session.timing, session.events.raceControl) },
      },
      playback.startMs,
    )
    expect(info.race).toBe(false)
    expect(info.totalLaps).toBeNull()
    expect(info.markers.laps).toEqual([])
    expect(info.startMs).toBe(playback.startMs)
    expect(info.originMs).toBeGreaterThanOrEqual(0)
    expect(info.laps.cars.size).toBeGreaterThan(0)
  })
})
