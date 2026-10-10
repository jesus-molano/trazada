import type { RaceControlEvent } from '@trazada/schema'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import TzRaceControl from '~/components/TzRaceControl.vue'
import TzTimeline from '~/components/TzTimeline.vue'
import TzTrackStatus from '~/components/TzTrackStatus.vue'
import type { TimelineMarkers } from '~/engine/timeline/markers'
import { TrackState } from '~/engine/trackstate/TrackState'
import type { ReplayRuntime } from '~/replay/runtime'
import { usePlaybackStore } from '~/stores/playback'

const msg = (t: number, kind: string, text: string, lap: number | null = null): RaceControlEvent => ({
  t,
  lap,
  category: 'Other',
  flag: null,
  scope: null,
  sector: null,
  car: null,
  text,
  parsed: { kind, cars: [], turn: null, lap },
})

const RC = [
  msg(1000, 'sector_yellow', 'YELLOW IN TRACK SECTOR 7'),
  msg(2000, 'sc_deployed', 'SAFETY CAR DEPLOYED', 3),
  msg(3000, 'no_such_kind', 'SOMETHING NEW FROM RACE CONTROL'),
]

const markers = (over: Partial<TimelineMarkers> = {}): TimelineMarkers => ({
  laps: [],
  windows: [],
  flags: [],
  pits: [],
  assists: [],
  ...over,
})

/** Runtime mínimo: el reloj se mueve con `setTime` (empuja el estado grueso como el real). */
function fakeRuntime(opts: { markers?: TimelineMarkers; trackState?: TrackState } = {}) {
  let coarse: ((s: { timeMs: number; playing: boolean; rate: 1 }) => void) | null = null
  const frames = new Set<(t: number) => void>()
  const clock = { timeMs: 0, rate: 1, playing: false, startMs: 0, endMs: 10_000, duration: 10_000 }
  const trackState = opts.trackState ?? new TrackState({ schema: 'trazada.events', schemaVersion: '1.0.0', raceControl: [], sectorFlags: [], windows: [] }, 10_000)
  const rt = {
    clock,
    session: { manifest: { session: { type: 'race', playback: { startMs: 0, endMs: 10_000, lightsOutMs: 0 } } }, timing: { tables: {} } },
    markers: opts.markers ?? markers(),
    drivers: [],
    model: { states: [] },
    circuit: { marshalSectors: [] },
    raceControl: RC,
    trackState,
    onFrame: (cb: (t: number) => void) => (frames.add(cb), () => frames.delete(cb)),
    onCoarse: (cb: typeof coarse) => {
      coarse = cb
      cb!({ timeMs: clock.timeMs, playing: false, rate: 1 })
      return () => {}
    },
    requestFrame: () => {},
    dispose: () => {},
  } as unknown as ReplayRuntime
  const setTime = (t: number) => {
    clock.timeMs = t
    trackState.update(t)
    for (const f of frames) f(t)
    coarse?.({ timeMs: t, playing: false, rate: 1 })
  }
  return { rt, setTime }
}

describe('TzRaceControl', () => {
  it('muestra solo los mensajes con t ≤ reloj, del más reciente al más antiguo, con el texto original', async () => {
    const { rt, setTime } = fakeRuntime()
    usePlaybackStore().attach(rt)
    const w = await mountSuspended(TzRaceControl)
    const shown = () => w.findAll('[data-testid="rc-message"]').map((m) => Number(m.attributes('data-t')))
    expect(shown()).toEqual([])
    setTime(1000)
    await nextTick()
    expect(shown()).toEqual([1000])
    setTime(2500)
    await nextTick()
    expect(shown()).toEqual([2000, 1000])
    const first = w.find('[data-testid="rc-message"]')
    expect(first.find('[data-testid="rc-text"]').text()).toBe('SAFETY CAR DEPLOYED')
    expect(first.find('[data-testid="rc-text"]').attributes('lang')).toBe('en')
    expect(first.find('[data-testid="rc-kind"]').text()).toMatch(/^(Coche de seguridad|Safety car)$/)
    setTime(9000)
    await nextTick()
    // Un kind sin traducción cae en "Otro", pero el texto original sigue intacto.
    const unknown = w.find('[data-kind="no_such_kind"]')
    expect(unknown.find('[data-testid="rc-kind"]').text()).toMatch(/^(Otro|Other)$/)
    expect(unknown.find('[data-testid="rc-text"]').text()).toBe('SOMETHING NEW FROM RACE CONTROL')
    setTime(500) // seek atrás
    await nextTick()
    expect(shown()).toEqual([])
  })
})

describe('TzTrackStatus', () => {
  it('chips de neutralización y de sectores, con texto (no solo color)', async () => {
    const ts = new TrackState(
      {
        schema: 'trazada.events',
        schemaVersion: '1.0.0',
        raceControl: [],
        sectorFlags: [{ sector: 7, flag: 'DOUBLE YELLOW', fromMs: 1000, toMs: 2000 }],
        windows: [{ kind: 'sc', fromMs: 3000, toMs: 4000 }, { kind: 'overtake', fromMs: 5000, toMs: 6000 }],
      },
      10_000,
    )
    const { rt, setTime } = fakeRuntime({ trackState: ts })
    usePlaybackStore().attach(rt)
    const w = await mountSuspended(TzTrackStatus)
    setTime(1500)
    await nextTick()
    const sector = w.find('[data-testid="track-sector"]')
    expect(sector.attributes('data-sector')).toBe('7')
    expect(sector.text()).toMatch(/7/)
    expect(sector.attributes('title')).toBeTruthy() // sin geometría de sectores: se explica
    setTime(3500)
    await nextTick()
    expect(w.find('[data-testid="track-sector"]').exists()).toBe(false)
    expect(w.find('[data-testid="track-neutral"]').attributes('data-kind')).toBe('sc')
    setTime(5500)
    await nextTick()
    expect(w.find('[data-testid="track-neutral"]').exists()).toBe(false)
    expect(w.find('[data-testid="track-overtake"]').exists()).toBe(true)
  })
})

describe('TzTimeline', () => {
  it('pinta las ventanas de OVERTAKE/DRS en su carril, en su posición', async () => {
    const { rt } = fakeRuntime({
      markers: markers({
        assists: [
          { kind: 'overtake', fromMs: 1000, toMs: 3000 },
          { kind: 'overtake', fromMs: 6000, toMs: 10_000 },
        ],
      }),
    })
    usePlaybackStore().attach(rt)
    const w = await mountSuspended(TzTimeline)
    const lanes = w.findAll('[data-marker="assist"]')
    expect(lanes.map((l) => [l.attributes('data-kind'), l.attributes('style')])).toEqual([
      ['overtake', 'left: 10.0000%; width: 20.0000%;'],
      ['overtake', 'left: 60.0000%; width: 40.0000%;'],
    ])
  })
})
