/**
 * Huecos por glob (D29) vacíos: los anfitriones se pintan exactamente como antes de tener huecos, sin
 * contenedores vacíos. Los huecos se fuerzan a vacío con `vi.mock`, así que este test no cambia cuando una función
 * añade su fichero (los huecos reales se cargan en tests/nuxt/slots-collect.test.ts).
 */
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'
import TzLeaderboard from '~/components/TzLeaderboard.vue'
import TzReplayDock from '~/components/TzReplayDock.vue'
import TzSceneTools from '~/components/TzSceneTools.vue'
import { createReplayRuntime } from '~/replay/runtime'
import { usePlaybackStore } from '~/stores/playback'
import { loadFixture } from '~/testing/fixture'

vi.mock('~/slots/scene-tools', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/slots/scene-tools')>()),
  SCENE_TOOLS: [],
}))
vi.mock('~/slots/leaderboard-cells', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/slots/leaderboard-cells')>()),
  LEADERBOARD_CELLS: [],
}))
vi.mock('~/slots/timeline-lanes', () => ({ TIMELINE_LANES: [] }))
vi.mock('~/slots/replay-dock', () => ({ REPLAY_DOCK: [] }))

describe('huecos vacíos', () => {
  it('sin herramientas de otras funciones, ningún grupo en las herramientas de escena', async () => {
    const w = await mountSuspended(TzSceneTools, { props: { flat: false, estimated: [] } })
    expect(w.find('[data-testid^="tool-group-"]').exists()).toBe(false)
  })

  it('sin celdas extra, la clasificación no cambia su rejilla; sin carriles ni botones, el dock tampoco', async () => {
    const rt = createReplayRuntime(await loadFixture())
    usePlaybackStore().attach(rt)
    const lb = await mountSuspended(TzLeaderboard)
    const section = lb.find('[data-testid="leaderboard"]')
    expect(section.classes()).not.toContain('has-cells')
    expect(section.attributes('style')).toBeUndefined()
    const dock = await mountSuspended(TzReplayDock)
    expect(dock.find('.tz-timeline__lanes').exists()).toBe(false)
    expect(dock.find('[data-testid="timeline"]').classes()).not.toContain('has-lanes')
    expect([...dock.find('.tz-controls').element.children].map((e) => e.tagName)).toEqual(['BUTTON', 'DIV', 'P'])
    usePlaybackStore().detach()
  })
})
