/**
 * Panel de telemetría con datos honestos: sin muestra vigente del coche seleccionado (también justo al cambiar
 * de coche), «—» en cada celda y gráficas vacías; acelerador sin dato sin barra; freno de encendido/apagado;
 * códigos de DRS desconocidos como «sin dato». Y la última vuelta anulada, marcada en TzLapInfo.
 */
import { mountSuspended } from '@nuxt/test-utils/runtime'
import type { VueWrapper } from '@vue/test-utils'
import type uPlot from 'uplot'
import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import TzLapInfo from '~/components/TzLapInfo.vue'
import TzTelemetry from '~/components/TzTelemetry.vue'
import { usePlaybackStore } from '~/stores/playback'
import { fakeTrzb } from '~/testing/fixture'
import { testLapTable, withExt } from '~/testing/runtime'

/** Gráfica falsa: registra lo que recibe (cuántos puntos tiene ahora cada una). */
const charts: { label: string; series: { label: string; stepped?: boolean }[]; points: number; clears: number }[] = []
const ChartStub = defineComponent({
  props: { label: String, series: Array, ranges: Object, windowS: Number },
  setup(props, { expose }) {
    const rec = { label: props.label ?? '', series: (props.series ?? []) as never, points: -1, clears: 0 }
    charts.push(rec)
    expose({
      setData: (d: uPlot.AlignedData) => (rec.points = d[0]!.length),
      clear: () => {
        rec.points = 0
        rec.clears++
      },
    })
    return () => h('div')
  },
})

// Coche 1: muestras cada 200 ms de 1 s a 5 s (acelerador sin dato en las de 3 s en adelante, DRS 3 = código
// desconocido desde 4 s). Coche 2: solo desde 10 s.
const T1 = Array.from({ length: 21 }, (_, i) => 1000 + i * 200)
const T2 = Array.from({ length: 10 }, (_, i) => 10_000 + i * 200)
const car = fakeTrzb('car', {
  cars: { car: [1, 2], start: [0, T1.length], count: [T1.length, T2.length] },
  tel: {
    t: [...T1, ...T2],
    speed: [...T1.map(() => 250), ...T2.map(() => 180)],
    rpm: [...T1.map(() => 11_000), ...T2.map(() => 9000)],
    gear: [...T1.map(() => 7), ...T2.map(() => 5)],
    throttle: [...T1.map((t) => (t >= 3000 ? 255 : 80)), ...T2.map(() => 50)],
    brake: [...T1.map(() => 1), ...T2.map(() => 0)],
    drs: [...T1.map((t) => (t >= 4000 ? 3 : 12)), ...T2.map(() => 0)],
  },
})

let frame: ((t: number) => void) | null = null

function attach() {
  const driver = (number: string, tla: string) => ({ number, tla, first: '', last: '', team: '', color: '#3366FF' })
  usePlaybackStore().attach({
    session: {
      car,
      manifest: { channels: { drs: 'present' }, session: { season: 2025 }, quality: { estimated: [] } },
    },
    drivers: [driver('1', 'AAA'), driver('2', 'BBB')],
    clock: { timeMs: 0, playing: false },
    onFrame: (cb: (t: number) => void) => ((frame = cb), () => (frame = null)),
    onCoarse: (cb: (s: { timeMs: number; playing: boolean; rate: 1 }) => void) => (
      cb({ timeMs: 0, playing: false, rate: 1 }),
      () => {}
    ),
    requestFrame: () => {},
    dispose: () => {},
  } as never)
}

const cells = (w: VueWrapper) =>
  ['tel-speed', 'tel-gear', 'tel-rpm', 'tel-throttle', 'tel-drs'].map((id) => w.find(`[data-testid="${id}"]`).text())

describe('TzTelemetry: sin dato, nunca cifras de otro coche u otro instante', () => {
  afterEach(() => {
    usePlaybackStore().detach()
    charts.length = 0
  })

  it('al cambiar a un coche sin muestra vigente: «—» en todas las celdas y gráficas vacías', async () => {
    attach()
    const playback = usePlaybackStore()
    playback.selectCar('1')
    const w = await mountSuspended(TzTelemetry, { global: { stubs: { TzMiniChart: ChartStub, TzLapInfo: true } } })
    frame!(2000)
    await nextTick()
    expect(cells(w)).toEqual(['250', '7', expect.stringMatching(/^11[.,\s]?000$/), expect.stringMatching(/^80\s?%$/), expect.stringMatching(/Abierto|Open/)])
    expect(w.find('[data-testid="tel-brake"]').attributes('data-on')).toBe('true')
    expect(charts.map((c) => c.points)).toEqual([6, 6]) // 1,0–2,0 s

    playback.selectCar('2')
    await nextTick()
    frame!(2000)
    await nextTick()
    expect(w.find('[data-testid="telemetry"]').attributes('data-car')).toBe('2')
    expect(cells(w)).toEqual(['—', '—', '—', '—', '—'])
    expect(w.find('[data-testid="tel-brake"]').attributes('data-on')).toBe('none')
    expect(w.find('[data-testid="tel-brake"]').text()).toBe('—')
    expect(w.find('[data-testid="telemetry-nodata"]').exists()).toBe(true)
    expect(charts.map((c) => c.points)).toEqual([0, 0])

    // Ya con muestra del coche 2: sus cifras.
    frame!(10_500)
    await nextTick()
    expect(cells(w)[0]).toBe('180')
    expect(charts.map((c) => c.points)).toEqual([3, 3])
  })

  it('el mismo coche sin muestra reciente (hueco de señal o tras un salto): también «—» y gráficas vacías', async () => {
    attach()
    usePlaybackStore().selectCar('1')
    const w = await mountSuspended(TzTelemetry, { global: { stubs: { TzMiniChart: ChartStub, TzLapInfo: true } } })
    frame!(2000)
    frame!(9000) // la última muestra del coche 1 es de 5 s: más de 2 s
    await nextTick()
    expect(cells(w)).toEqual(['—', '—', '—', '—', '—'])
    expect(charts.map((c) => c.points)).toEqual([0, 0])
  })

  it('acelerador sin dato: sin barra (no un 0 %); DRS con código desconocido: «sin dato», no «cerrado»', async () => {
    attach()
    usePlaybackStore().selectCar('1')
    const w = await mountSuspended(TzTelemetry, { global: { stubs: { TzMiniChart: ChartStub, TzLapInfo: true } } })
    const track = () => w.find('[data-testid="tel-throttle"]').element.parentElement!.querySelector('.tz-tel__bar')!
    frame!(2000)
    expect(track().getAttribute('data-known')).toBe('true')
    frame!(3500)
    expect(w.find('[data-testid="tel-throttle"]').text()).toBe('—')
    expect(track().getAttribute('data-known')).toBe('false')
    frame!(4500)
    expect(w.find('[data-testid="tel-drs"]').text()).toMatch(/^(Sin dato|No data)$/)
    expect(w.find('[data-testid="tel-drs"]').attributes('data-state')).toBe('unknown')
  })

  it('el freno es de encendido/apagado: la gráfica lo dice y lo dibuja en escalones', async () => {
    attach()
    usePlaybackStore().selectCar('1')
    await mountSuspended(TzTelemetry, { global: { stubs: { TzMiniChart: ChartStub, TzLapInfo: true } } })
    const brake = charts[1]!.series[1]!
    expect(brake.label).toMatch(/(sí\/no|on\/off)/)
    expect(brake.stepped).toBe(true)
  })
})

describe('TzLapInfo: última vuelta anulada', () => {
  afterEach(() => usePlaybackStore().detach())

  it('se marca como anulada desde el mensaje de dirección de carrera, con su tiempo tachado', async () => {
    const timing = fakeTrzb('timing', {
      laps: {
        car: [1, 1],
        lap: [1, 2],
        startMs: [0, 91_000],
        endMs: [91_000, 181_000],
        lapMs: [-1, 90_000],
        pitInMs: [-1, -1],
        pitOutMs: [-1, -1],
        position: [1, 1],
        compound: [2, 2],
        deleted: [0, 1],
      },
    })
    const message = {
      t: 240_000,
      lap: null,
      category: 'Other',
      flag: null,
      scope: null,
      sector: null,
      car: null,
      text: 'CAR 1 (AAA) TIME 1:30.000 DELETED - TRACK LIMITS AT TURN 4 LAP 2 13:40:24',
      parsed: { kind: 'lap_deleted', cars: ['1'], turn: null, lap: 2 },
    }
    let timeMs = 200_000
    let push: ((s: { timeMs: number; playing: boolean; rate: 1 }) => void) | null = null
    usePlaybackStore().attach(withExt({
      session: {
        manifest: { session: { type: 'fp1', playback: { startMs: 0, endMs: 300_000 } } },
        timing,
        events: { raceControl: [message] },
      },
      leaderboard: { lapTable: testLapTable('fp1', timing, [message as never]) },
      drivers: [],
      clock: { timeMs },
      onCoarse: (cb: typeof push) => ((push = cb), cb!({ timeMs, playing: false, rate: 1 }), () => {}),
      dispose: () => {},
    }) as never)
    const w = await mountSuspended(TzLapInfo, { props: { car: '1' } })
    expect(w.find('[data-testid="lap-last"]').text()).toMatch(/^1:30[.,]000$/)
    expect(w.find('[data-testid="lap-last-deleted"]').exists()).toBe(false)
    timeMs = 250_000
    push!({ timeMs, playing: false, rate: 1 })
    await nextTick()
    expect(w.find('[data-testid="lap-last"]').classes()).toContain('is-deleted')
    expect(w.find('[data-testid="lap-last-deleted"]').text()).toMatch(/^(Anulada|Deleted)$/)
  })
})
