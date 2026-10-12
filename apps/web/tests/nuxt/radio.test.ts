/**
 * Radio de los equipos en el front (D51): en el panel de dirección de carrera, el filtro «Todo / Dirección de carrera /
 * Radio» y los clips mezclados por hora, solo hasta el reloj; reproducir, pausa y progreso con un solo clip a la vez;
 * los avisos sin radio y de una sesión anterior a 1.2.0; «Escuchar en directo» (del coche elegido o de todos, y se para
 * al saltar); los radios del coche elegido en la telemetría y el carril del timeline. Con un `Audio` falso.
 */
import type { RaceControlEvent, RadioClip } from '@trazada/schema'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TzRadioLive from '~/components/replay-overlays/TzRadioLive.vue'
import TzRadioLane from '~/components/timeline-lanes/TzRadioLane.vue'
import TzCarRadio from '~/components/TzCarRadio.vue'
import TzRaceControl from '~/components/TzRaceControl.vue'
import { TrackState } from '~/engine/trackstate/TrackState'
import type { ReplayRuntime } from '~/replay/runtime'
import { usePlaybackStore } from '~/stores/playback'
import { useRadioStore } from '~/stores/radio'

const file = (n: number) => `radio/${String(n).padStart(16, '0')}.mp3`
const CLIPS: RadioClip[] = [
  { t: 1200, car: '44', file: file(1), bytes: 1000 },
  { t: 2500, car: '1', file: file(2), bytes: 1000 },
  { t: 6000, car: '44', file: file(3), bytes: 1000 },
]
const RC: RaceControlEvent[] = [1000, 2000].map((t) => ({
  t,
  lap: null,
  category: 'Other',
  flag: null,
  scope: null,
  sector: null,
  car: null,
  text: `MESSAGE AT ${t}`,
  parsed: { kind: 'other', cars: [], turn: null, lap: null },
}))

/** `Audio` falso: guarda la fuente y avisa como el de verdad (playing, pause). */
class FakeAudio extends EventTarget {
  static last: FakeAudio | null = null
  src = ''
  preload = ''
  currentTime = 0
  duration = 10
  plays = 0
  constructor() {
    super()
    FakeAudio.last = this
  }
  play() {
    this.plays++
    this.dispatchEvent(new Event('playing'))
    return Promise.resolve()
  }
  pause() {
    this.dispatchEvent(new Event('pause'))
  }
}

function fakeRuntime(radio: 'present' | 'absent' | 'outdated' = 'present') {
  let coarse: ((s: { timeMs: number; playing: boolean; rate: number }) => void) | null = null
  const clock = { timeMs: 0, rate: 1, playing: false, startMs: 0, endMs: 10_000, duration: 10_000 }
  const events = { schema: 'trazada.events', schemaVersion: '1.2.0', raceControl: [], sectorFlags: [], windows: [], ...(radio === 'present' ? { radio: CLIPS } : {}) }
  const rt = {
    clock,
    session: {
      id: '2026/14-madrid/race',
      manifest: {
        session: { type: 'race', playback: { startMs: 0, endMs: 10_000, lightsOutMs: 0 } },
        quality: { estimated: [] },
        channels: { drs: 'absent', elevation: 'flat', ...(radio === 'outdated' ? {} : { radio }) },
      },
      timing: { tables: {} },
      events,
    },
    drivers: [
      { number: '44', tla: 'HAM', color: '#00d2be' },
      { number: '1', tla: 'VER', color: '#3671c6' },
    ],
    model: { states: [], tracks: [] },
    raceControl: RC,
    trackState: new TrackState(events as never, 10_000),
    onFrame: () => () => {},
    onCoarse: (cb: typeof coarse) => {
      coarse = cb
      cb!({ timeMs: clock.timeMs, playing: false, rate: 1 })
      return () => {}
    },
    requestFrame: () => {},
    dispose: () => {},
  } as unknown as ReplayRuntime
  /** Mueve el reloj: en pausa (un salto) o reproduciendo a `rate`. */
  const at = (t: number, playing = false, rate = 1) => {
    clock.timeMs = t
    clock.playing = playing
    clock.rate = rate
    coarse?.({ timeMs: t, playing, rate })
  }
  return { rt, at }
}

beforeEach(() => {
  vi.stubGlobal('Audio', FakeAudio)
  useRadioStore().filter = 'all'
  useRadioStore().live = false
})
afterEach(() => {
  useRadioPlayer().stop()
  vi.unstubAllGlobals()
})

describe('radio en el panel de dirección de carrera', () => {
  it('mezclada por hora y solo hasta el reloj; el filtro elige qué se ve', async () => {
    const { rt, at } = fakeRuntime()
    usePlaybackStore().attach(rt)
    const w = await mountSuspended(TzRaceControl)
    const rows = () => w.findAll('[data-testid="rc-message"], [data-testid="rc-radio"]').map((r) => Number(r.attributes('data-t')))
    at(3000)
    await nextTick()
    expect(rows()).toEqual([2500, 2000, 1200, 1000]) // el de 6000 aún no se ha publicado
    expect(w.find('[data-testid="rc-count"]').text()).toMatch(/^4 /)
    await w.find('[data-testid="rc-filter-radio"]').trigger('click')
    expect(rows()).toEqual([2500, 1200])
    expect(w.find('[data-testid="rc-filter-radio"]').attributes('aria-pressed')).toBe('true')
    await w.find('[data-testid="rc-filter-rc"]').trigger('click')
    expect(rows()).toEqual([2000, 1000])
    // Quién y cuándo: la sigla con la marca de su equipo y la hora de publicación (con su aviso).
    await w.find('[data-testid="rc-filter-all"]').trigger('click')
    const ver = w.find('[data-testid="rc-radio"][data-car="1"]')
    expect(ver.text()).toContain('VER')
    expect(ver.find('.tz-rc__time').attributes('title')).toMatch(/(publicación|Publication)/)
  })

  it('reproducir y pausar, con su progreso; suena uno a la vez', async () => {
    const { rt, at } = fakeRuntime()
    usePlaybackStore().attach(rt)
    const w = await mountSuspended(TzRaceControl)
    at(3000)
    await nextTick()
    const play = (car: string) => w.find(`[data-testid="rc-radio"][data-car="${car}"] [data-testid="radio-play"]`)
    await play('44').trigger('click')
    await nextTick()
    expect(FakeAudio.last!.src).toMatch(new RegExp(`/2026/14-madrid/race/${file(1)}$`))
    expect(play('44').attributes('aria-pressed')).toBe('true')
    expect(play('44').attributes('aria-label')).toMatch(/HAM/)
    FakeAudio.last!.currentTime = 5
    FakeAudio.last!.dispatchEvent(new Event('timeupdate'))
    await nextTick()
    expect(w.find('[data-testid="radio-progress"]').attributes('aria-valuenow')).toBe('50')
    // Otro clip: el anterior deja de sonar.
    await play('1').trigger('click')
    await nextTick()
    expect(FakeAudio.last!.src).toMatch(new RegExp(`${file(2)}$`))
    expect(play('44').attributes('aria-pressed')).toBe('false')
    expect(play('1').attributes('aria-pressed')).toBe('true')
    await play('1').trigger('click')
    await nextTick()
    expect(play('1').attributes('aria-pressed')).toBe('false')
  })

  it('sin radio, ni filtro ni nada que ocupe alto; de antes de 1.2.0, una línea pide volver a descargarla', async () => {
    for (const status of ['absent', 'outdated'] as const) {
      const { rt } = fakeRuntime(status)
      usePlaybackStore().attach(rt)
      useRadioStore().filter = 'radio' // lo elegido en otra sesión no esconde los mensajes de esta
      const w = await mountSuspended(TzRaceControl)
      expect(w.find('[data-testid="rc-tools"]').exists()).toBe(false)
      expect(w.find('[data-testid="radio-outdated"]').exists()).toBe(status === 'outdated')
      if (status === 'outdated') expect(w.find('[data-testid="radio-outdated"]').text()).toMatch(/(vuelve a descargarla|download it again)/)
      expect(w.find('[data-testid="rc-empty"]').text()).toMatch(/(mensajes|messages)/)
      w.unmount()
    }
  })

  it('en directo: a ×1 suena el clip al llegar el reloj (del coche elegido); se para al saltar y a más de ×2', async () => {
    const { rt, at } = fakeRuntime()
    const playback = usePlaybackStore()
    playback.attach(rt)
    const w = await mountSuspended(TzRaceControl)
    // Lo que suena en directo va aparte (montado siempre: con un piloto elegido, el panel se oculta).
    await mountSuspended(TzRadioLive)
    expect(w.find('[data-testid="radio-live"]').attributes('aria-pressed')).toBe('false') // apagado por defecto
    await w.find('[data-testid="radio-live"]').trigger('click')
    at(1100, true)
    await nextTick()
    at(1250, true)
    await nextTick()
    expect(FakeAudio.last?.src).toMatch(new RegExp(`${file(1)}$`))
    expect(useRadioPlayer().now.value).toMatchObject({ key: file(1), live: true })
    // Un salto lo para.
    at(5000, true)
    await nextTick()
    expect(useRadioPlayer().now.value).toBeNull()
    // Con un coche elegido, solo los suyos: el de VER (2500) no suena con HAM elegido.
    playback.selectCar('44')
    at(2400, true)
    await nextTick()
    at(2550, true)
    await nextTick()
    expect(useRadioPlayer().now.value).toBeNull()
    // A ×4 no suena nada.
    at(5900, true, 4)
    await nextTick()
    at(6100, true, 4)
    await nextTick()
    expect(useRadioPlayer().now.value).toBeNull()
  })
})

describe('radio del coche elegido y carril del timeline', () => {
  it('la telemetría lista los suyos hasta el reloj, el más reciente primero', async () => {
    const { rt, at } = fakeRuntime()
    usePlaybackStore().attach(rt)
    const w = await mountSuspended(TzCarRadio, { props: { car: '44' } })
    at(1000)
    await nextTick()
    expect(w.findAll('[data-testid="car-radio-clip"]')).toHaveLength(0)
    expect(w.text()).toMatch(/(Aún no hay radio|No radio from this car)/)
    at(7000)
    await nextTick()
    expect(w.findAll('[data-testid="radio-clip"]').map((c) => c.attributes('data-file'))).toEqual([file(3), file(1)])
  })

  it('el carril marca solo los publicados hasta el reloj', async () => {
    const { rt, at } = fakeRuntime()
    usePlaybackStore().attach(rt)
    const w = await mountSuspended(TzRadioLane)
    at(3000)
    await nextTick()
    expect(w.find('[data-testid="radio-lane"]').attributes('data-count')).toBe('2')
    expect(w.findAll('[data-marker="radio"]')).toHaveLength(2)
  })
})
