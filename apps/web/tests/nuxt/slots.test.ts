/**
 * Huecos por glob (D29) con un componente de prueba en cada uno: el anfitrión lo monta donde toca y con sus props.
 * (Los huecos reales, sin ficheros todavía, se prueban en slots-empty.test.ts: `vi.mock` vale para todo el fichero.)
 */
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'
import TzLeaderboard from '~/components/TzLeaderboard.vue'
import TzReplayDock from '~/components/TzReplayDock.vue'
import TzSceneTools from '~/components/TzSceneTools.vue'
import TzTimeline from '~/components/TzTimeline.vue'
import type { LeaderboardRow } from '~/engine/leaderboard/leaderboard'
import { createReplayRuntime } from '~/replay/runtime'
import { usePlaybackStore } from '~/stores/playback'
import { loadFixture } from '~/testing/fixture'

/** Componente de prueba: pinta su nombre y las props que recibe. */
async function fake(name: string, props: string[] = []) {
  const { defineComponent, h } = await import('vue')
  return defineComponent({
    name,
    props: Object.fromEntries(props.map((p) => [p, { type: null, required: true }])),
    setup(p) {
      return () =>
        h('span', {
          'data-fake': name,
          'data-car': (p.row as LeaderboardRow | undefined)?.car,
          'data-preset': p.preset as string | undefined,
        })
    },
  })
}

vi.mock('~/slots/scene-tools', async (importOriginal) => {
  const orig = await importOriginal<typeof import('~/slots/scene-tools')>()
  const { collectSlot } = await import('~/slots/collect')
  const tool = async (name: string, order: number, group: string) => ({ default: await fake(name), order, group })
  return {
    ...orig,
    SCENE_TOOLS: orig.groupSceneTools(
      collectSlot({
        'scene-tools/TzTvTool.vue': await tool('TzTvTool', 1, 'camera'),
        'scene-tools/TzHeatTool.vue': await tool('TzHeatTool', 2, 'layers'),
        'scene-tools/TzTrailsTool.vue': await tool('TzTrailsTool', 1, 'layers'),
      }),
    ),
  }
})

vi.mock('~/slots/leaderboard-cells', async (importOriginal) => {
  const orig = await importOriginal<typeof import('~/slots/leaderboard-cells')>()
  const { collectSlot } = await import('~/slots/collect')
  return {
    ...orig,
    LEADERBOARD_CELLS: orig.leaderboardCells(
      collectSlot({
        'leaderboard-cells/TzSectorCells.vue': { default: await fake('TzSectorCells', ['row', 'preset']), order: 1, width: '36px' },
        'leaderboard-cells/TzBestLapCell.vue': {
          default: await fake('TzBestLapCell', ['row', 'preset']),
          order: 2,
          width: '56px',
          presets: ['analysis'],
        },
      }),
    ),
  }
})

vi.mock('~/slots/timeline-lanes', async () => {
  const { collectSlot } = await import('~/slots/collect')
  return { TIMELINE_LANES: collectSlot({ 'timeline-lanes/TzWeatherLane.vue': { default: await fake('TzWeatherLane'), order: 1 } }) }
})

vi.mock('~/slots/replay-dock', async () => {
  const { collectSlot } = await import('~/slots/collect')
  return {
    REPLAY_DOCK: collectSlot({
      'replay-dock/TzSummaryButton.vue': { default: await fake('TzSummaryButton'), order: 2 },
      'replay-dock/TzJumpButtons.vue': { default: await fake('TzJumpButtons'), order: 1 },
    }),
  }
})

const fakes = (w: { findAll: (s: string) => { attributes: (a: string) => string | undefined }[] }) =>
  w.findAll('[data-fake]').map((e) => e.attributes('data-fake'))

describe('huecos por glob con componentes', () => {
  it('herramientas de escena: grupos «Capas» y «Cámara», cada uno con su etiqueta y en orden', async () => {
    const w = await mountSuspended(TzSceneTools, { props: { flat: false, estimated: [] } })
    const groups = w.findAll('[data-testid^="tool-group-"]')
    expect(groups.map((g) => g.attributes('data-testid'))).toEqual(['tool-group-layers', 'tool-group-camera'])
    expect(groups.map((g) => g.attributes('role'))).toEqual(['group', 'group'])
    expect(groups[0]!.attributes('aria-label')).toMatch(/^(Capas|Layers)$/)
    expect(groups[1]!.attributes('aria-label')).toMatch(/^(Cámara|Camera)$/)
    expect(fakes(groups[0]!)).toEqual(['TzTrailsTool', 'TzHeatTool'])
    expect(fakes(groups[1]!)).toEqual(['TzTvTool'])
  })

  it('clasificación: cada fila monta sus celdas con row y preset; solo las de ese diseño, con su ancho', async () => {
    const rows: LeaderboardRow[] = ['1', '44'].map((car, i) => ({
      car,
      driver: { number: car, tla: `T${car}`, first: '', last: '', team: '', color: '#3366FF' },
      position: i + 1,
      positionKnown: true,
      gapMs: i * 1000,
      intervalMs: 1000,
      lapsBehind: 0,
      lap: 3,
      compound: 'SOFT',
      tyreLife: 2,
      bestLapMs: null,
      inPit: false,
      noSignal: false,
      blueFlag: false,
    }))
    usePlaybackStore().attach({
      clock: { timeMs: 0, rate: 1, playing: false },
      model: { states: [] },
      leaderboard: { compute: () => rows },
      drivers: rows.map((r) => r.driver!),
      onFrame: () => () => {},
      onCoarse: (cb: (s: { timeMs: number; playing: boolean; rate: 1 }) => void) => (cb({ timeMs: 0, playing: false, rate: 1 }), () => {}),
      requestFrame: () => {},
      dispose: () => {},
    } as never)

    const spectator = await mountSuspended(TzLeaderboard)
    const lb = spectator.find('[data-testid="leaderboard"]')
    expect(lb.classes()).toContain('has-cells')
    expect(lb.attributes('style')).toContain('--lb-cells: 36px')
    const cells = spectator.findAll('[data-car="44"] [data-fake]')
    expect(cells.map((c) => [c.attributes('data-fake'), c.attributes('data-car'), c.attributes('data-preset')])).toEqual([
      ['TzSectorCells', '44', 'spectator'],
    ])

    const analysis = await mountSuspended(TzLeaderboard, { props: { preset: 'analysis' } })
    expect(analysis.find('[data-testid="leaderboard"]').attributes('style')).toContain('--lb-cells: 36px 56px')
    expect(fakes(analysis.find('[data-car="1"]'))).toEqual(['TzSectorCells', 'TzBestLapCell'])
    usePlaybackStore().detach()
  })

  it('timeline: los carriles van dentro de la pista del timeline (su arrastre es el del timeline), bajo las marcas', async () => {
    const rt = createReplayRuntime(await loadFixture())
    usePlaybackStore().attach(rt)
    const w = await mountSuspended(TzTimeline)
    const track = w.find('[data-testid="timeline"]')
    expect(track.classes()).toContain('has-lanes')
    expect(fakes(track.find('.tz-timeline__lanes'))).toEqual(['TzWeatherLane'])
    usePlaybackStore().detach()
  })

  it('dock: los botones van en la fila de los controles, entre las velocidades y el reloj, en orden', async () => {
    const rt = createReplayRuntime(await loadFixture())
    usePlaybackStore().attach(rt)
    const w = await mountSuspended(TzReplayDock, { global: { stubs: { TzTimeline: true } } })
    const row = w.find('.tz-controls')
    expect(fakes(row)).toEqual(['TzJumpButtons', 'TzSummaryButton'])
    const children = [...row.element.children].map((e) => (e as HTMLElement).dataset.fake ?? e.className)
    expect(children.indexOf('TzJumpButtons')).toBeGreaterThan(children.indexOf('tz-rates'))
    expect(children.indexOf('TzSummaryButton')).toBeLessThan(children.findIndex((c) => c.includes('tz-readout')))
    usePlaybackStore().detach()
  })
})
