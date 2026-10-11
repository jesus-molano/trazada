/**
 * Huecos por glob (D29): orden, contrato y los huecos reales. En el entorno Nuxt (no en el de unidad): cada módulo de
 * hueco evalúa su `import.meta.glob` al importarse, y en cuanto un hueco tiene un `.vue`, importarlo necesita el
 * plugin de Vue y los alias de Nuxt.
 */
import { describe, expect, it } from 'vitest'
import type { Component } from 'vue'
import { collectSlot, type SlotModule, slotName } from '~/slots/collect'
import { cellsFor, LAYOUT_PRESETS, LEADERBOARD_CELLS, leaderboardCells } from '~/slots/leaderboard-cells'
import { REPLAY_HEADER, REPLAY_OVERLAYS } from '~/slots/replay'
import { REPLAY_DOCK } from '~/slots/replay-dock'
import { SCENE_LAYERS } from '~/slots/scene-layers'
import { groupSceneTools, SCENE_TOOL_GROUPS, SCENE_TOOLS } from '~/slots/scene-tools'
import { TIMELINE_LANES } from '~/slots/timeline-lanes'

const comp = (name: string): Component => ({ name, render: () => null })
const mod = (name: string, extra: Record<string, unknown>): SlotModule => ({ default: comp(name), ...extra })

describe('huecos por glob (D29)', () => {
  it('ordena por el número exportado y, a igualdad, por nombre de fichero', () => {
    const slot = collectSlot({
      '../components/x/TzB.vue': mod('B', { order: 20 }),
      '../components/x/TzC.vue': mod('C', { order: 10 }),
      '../components/x/TzA.vue': mod('A', { order: 20 }),
    })
    expect(slot.map((e) => [e.name, e.order])).toEqual([
      ['TzC', 10],
      ['TzA', 20],
      ['TzB', 20],
    ])
    expect(Object.isFrozen(slot)).toBe(true)
  })

  it('la escena ordena por renderOrder, también negativo (el cielo, −10)', () => {
    const slot = collectSlot(
      { 'a/TzTrails.vue': mod('T', { renderOrder: 4 }), 'a/TzDrsZones.vue': mod('S', { renderOrder: -10 }) },
      'renderOrder',
    )
    expect(slot.map((e) => e.name)).toEqual(['TzDrsZones', 'TzTrails'])
  })

  it('un hueco sin ficheros es una lista vacía', () => {
    expect(collectSlot({})).toEqual([])
    expect(groupSceneTools([])).toEqual([])
    expect(leaderboardCells([])).toEqual([])
  })

  it('un fichero sin su número de orden es un error al cargar, con su ruta', () => {
    expect(() => collectSlot({ 'c/TzX.vue': mod('X', {}) })).toThrow(/c\/TzX\.vue.*order/)
    expect(() => collectSlot({ 'c/TzX.vue': mod('X', { order: '3' }) })).toThrow(/order/)
    expect(() => collectSlot({ 'c/TzX.vue': mod('X', { order: 1 }) }, 'renderOrder')).toThrow(/renderOrder/)
  })

  it('nombre del fichero sin carpeta ni extensión (también con separadores de Windows)', () => {
    expect(slotName('../components/scene-layers/TzTrails.vue')).toBe('TzTrails')
    expect(slotName('C:\\app\\components\\TzX.vue')).toBe('TzX')
  })

  it('herramientas de escena: grupos «Capas» y «Cámara» en orden fijo, solo los que tienen algo', () => {
    const tools = collectSlot({
      't/TzTv.vue': mod('Tv', { order: 1, group: 'camera' }),
      't/TzHeat.vue': mod('Heat', { order: 2, group: 'layers' }),
      't/TzTrailsTool.vue': mod('Tr', { order: 1, group: 'layers' }),
    })
    expect(groupSceneTools(tools).map((g) => [g.group, g.tools.map((t) => t.name)])).toEqual([
      ['layers', ['TzTrailsTool', 'TzHeat']],
      ['camera', ['TzTv']],
    ])
    expect(groupSceneTools(tools.filter((t) => t.module.group === 'camera')).map((g) => g.group)).toEqual(['camera'])
    expect(() => groupSceneTools(collectSlot({ 't/TzX.vue': mod('X', { order: 1, group: 'otro' }) }))).toThrow(
      /scene-tools\/TzX\.vue.*group/,
    )
    expect(SCENE_TOOL_GROUPS).toEqual(['layers', 'camera'])
  })

  it('celdas de la clasificación: ancho obligatorio y diseños en los que salen', () => {
    const cells = leaderboardCells(
      collectSlot({
        'l/TzBest.vue': mod('Best', { order: 2, width: '56px', presets: ['analysis'] }),
        'l/TzSectors.vue': mod('Sec', { order: 1, width: '36px' }),
      }),
    )
    expect(cells.map((c) => [c.name, c.width, c.presets])).toEqual([
      ['TzSectors', '36px', LAYOUT_PRESETS],
      ['TzBest', '56px', ['analysis']],
    ])
    expect(cellsFor(cells, 'spectator').map((c) => c.name)).toEqual(['TzSectors'])
    expect(cellsFor(cells, 'analysis').map((c) => c.name)).toEqual(['TzSectors', 'TzBest'])
    expect(() => leaderboardCells(collectSlot({ 'l/TzX.vue': mod('X', { order: 1 }) }))).toThrow(/TzX\.vue.*width/)
    expect(() =>
      leaderboardCells(collectSlot({ 'l/TzX.vue': mod('X', { order: 1, width: '9px', presets: ['tv'] }) })),
    ).toThrow(/presets/)
  })

  it('los huecos reales cargan (con o sin ficheros) y cumplen su contrato', () => {
    for (const slot of [SCENE_LAYERS, REPLAY_HEADER, REPLAY_OVERLAYS, REPLAY_DOCK, TIMELINE_LANES, LEADERBOARD_CELLS]) {
      expect(Array.isArray(slot)).toBe(true)
      for (const e of slot) expect(Number.isFinite(e.order)).toBe(true)
    }
    for (const g of SCENE_TOOLS) expect(g.tools.length).toBeGreaterThan(0)
  })
})
