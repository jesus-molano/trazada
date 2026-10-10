/**
 * Comparar dos pilotos (ítem 1, D31): el panel (diferencia en vivo con «Estimado» y en décimas, «sin dato» con su
 * motivo, diferencia oficial al cerrar la vuelta, trazas por distancia y estado del fantasma), la vista «Comparar» del
 * panel del coche, Mayús+clic en la clasificación, Esc con su prioridad y la preferencia del fantasma.
 */
import { mountSuspended } from '@nuxt/test-utils/runtime'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type uPlot from 'uplot'
import { afterEach, beforeEach, describe, expect, it, onTestFinished } from 'vitest'
import { defineComponent, h } from 'vue'
import TzCompare from '~/components/TzCompare.vue'
import TzLeaderboard from '~/components/TzLeaderboard.vue'
import TzTelemetry from '~/components/TzTelemetry.vue'
import { ESC_PRIORITY, handleEscape, registerEscape } from '~/replay/keys'
import { useCompareStore } from '~/stores/compare'
import { usePlaybackStore } from '~/stores/playback'
import { compareTestRuntime } from '~/testing/compare'

const KEY = 'trazada.compare'

/** Gráfica por distancia falsa: registra lo que recibe. */
const charts: { label: string; points: number; series: number; cursor: number | null; clears: number }[] = []
const ChartStub = defineComponent({
  props: { label: String, series: Array, ranges: Object, lengthM: Number, compact: Boolean, testid: String },
  setup(props, { expose }) {
    const rec = { label: props.label ?? '', points: -1, series: 0, cursor: null as number | null, clears: 0 }
    charts.push(rec)
    expose({
      setData: (d: uPlot.AlignedData) => {
        rec.points = d[0]!.length
        rec.series = d.length - 1
      },
      clear: () => {
        rec.points = 0
        rec.clears++
      },
      setCursor: (d: number | null) => (rec.cursor = d),
    })
    return () => h('div', { 'data-testid': props.testid })
  },
})

let frame: (t: number) => void = () => {}
/** Montados en el caso: se desmontan al acabar (comparten la Pinia de la app y seguirían reaccionando). */
const wrappers: VueWrapper[] = []
const track = <W extends VueWrapper>(w: W): W => (wrappers.push(w), w)

function attach() {
  const { rt, frame: f } = compareTestRuntime()
  usePlaybackStore().attach(rt as never)
  frame = f
  return rt
}

async function mountCompare(a: string, b: string | null) {
  usePlaybackStore().selectCar(a)
  const compare = useCompareStore()
  compare.setCompareCar(b)
  const w = track(await mountSuspended(TzCompare, { global: { stubs: { TzDistanceChart: ChartStub } } }))
  await nextTick()
  return w
}

const text = (w: VueWrapper, id: string) => w.find(`[data-testid="${id}"]`).text()
const attr = (w: VueWrapper, id: string, name: string) => w.find(`[data-testid="${id}"]`).attributes(name)

beforeEach(() => localStorage.removeItem(KEY))
afterEach(() => {
  for (const w of wrappers.splice(0)) w.unmount()
  useCompareStore().setRef(null)
  usePlaybackStore().detach()
  charts.length = 0
})

describe('TzCompare: diferencia en vivo y oficial', () => {
  it('misma vuelta (por defecto en carrera): décimas con signo, etiqueta «Estimado» (lapDelta) y fantasma «aún no»', async () => {
    attach()
    const w = await mountCompare('1', '2')
    frame(90_000)
    await nextTick()
    expect(w.find('[data-testid="compare"]').attributes('data-mode')).toBe('same')
    expect(attr(w, 'compare-delta', 'data-state')).toBe('ok')
    expect(attr(w, 'compare-delta', 'data-ms')).toBe('-3000')
    expect(attr(w, 'compare-delta', 'data-sign')).toBe('gain')
    expect(text(w, 'compare-delta')).toMatch(/^[-−]3[.,]0 s$/)
    const label = w.find('[data-testid="estimated"][data-field="lapDelta"]')
    expect(label.exists()).toBe(true)
    expect(text(w, 'compare-ref-info')).toMatch(/[VL]2 .*BBB [VL]2/)
    expect(attr(w, 'compare-ghost-state', 'data-state')).toBe('notYet')
    // Trazas: A hasta el instante actual y B, en un eje común; la línea de A en su distancia.
    expect(charts.map((c) => c.series)).toEqual([2, 2, 2])
    expect(charts[0]!.points).toBeGreaterThan(30)
    expect(charts.every((c) => Math.abs(c.cursor! - 1500) < 1e-6)).toBe(true)
  })

  it('nunca milésimas en vivo; la oficial (tiempos de vuelta) al cerrar los dos la vuelta, en milésimas', async () => {
    attach()
    const w = await mountCompare('1', '2')
    frame(130_000)
    await nextTick()
    // V2 de A cerrada (60 s), la de B aún no: pendiente.
    expect(attr(w, 'compare-official', 'data-sign')).toBeUndefined()
    expect(text(w, 'compare-official')).toMatch(/[VL]2/)
    expect(text(w, 'compare-official')).toMatch(/BBB/)
    frame(160_000)
    await nextTick()
    expect(text(w, 'compare-official')).toMatch(/^[VL]2 .*[-−]15[.,]000 s/)
    expect(text(w, 'compare-official')).toMatch(/1:00[.,]000.*1:15[.,]000/)
    expect(attr(w, 'compare-official', 'data-sign')).toBe('gain')
    expect(text(w, 'compare-delta')).toMatch(/^[-−+]?\d+[.,]\d s$/)
  })

  it('sin vuelta de referencia o sin posiciones de B: «sin dato» con el motivo, nunca una cifra', async () => {
    attach()
    const compare = useCompareStore()
    const w = await mountCompare('1', '2')
    // Mejor vuelta: a los 90 s, B solo ha cerrado la 1 (que no cuenta).
    compare.setRef('best')
    await nextTick()
    frame(90_000)
    await nextTick()
    expect(w.find('[data-testid="compare"]').attributes('data-mode')).toBe('best')
    expect(attr(w, 'compare-delta', 'data-state')).toBe('missing')
    expect(text(w, 'compare-delta')).toMatch(/^(Sin dato|No data)$/)
    expect(attr(w, 'compare-ref-info', 'data-missing')).toBe('noLap')
    expect(text(w, 'compare-ref-info')).toMatch(/BBB/)
    expect(w.find('[data-testid="estimated"][data-field="lapDelta"]').exists()).toBe(true)

    // B con vueltas pero sin posiciones.
    compare.setRef(null)
    compare.setCompareCar('3')
    await nextTick()
    frame(91_000)
    await nextTick()
    expect(text(w, 'compare-delta')).toMatch(/^(Sin dato|No data)$/)
    expect(attr(w, 'compare-ref-info', 'data-missing')).toBe('noPosition')
    expect(attr(w, 'compare-ghost-state', 'data-state')).toBe('none')

    // B sin ninguna vuelta.
    compare.setCompareCar('4')
    await nextTick()
    frame(92_000)
    await nextTick()
    expect(attr(w, 'compare-ref-info', 'data-missing')).toBe('noLap')
    expect(text(w, 'compare-ref-info')).toMatch(/DDD/)
    expect(text(w, 'compare-delta')).toMatch(/^(Sin dato|No data)$/)
    // La traza de A (dato real) sigue; la de B no existe.
    expect(charts[0]!.points).toBeGreaterThan(0)
  })

  it('sin piloto elegido: la lista (sin A) y cómo elegirlo; elegirlo en la lista abre la comparación', async () => {
    attach()
    const w = await mountCompare('1', null)
    expect(w.find('[data-testid="compare-empty"]').exists()).toBe(true)
    expect(w.find('[data-testid="compare-delta"]').exists()).toBe(false)
    const options = w.findAll('[data-testid="compare-car"] option').map((o) => o.attributes('value'))
    expect(options).toEqual(['', '2', '3', '4'])
    await w.find('[data-testid="compare-car"]').setValue('2')
    expect(useCompareStore().compareCar).toBe('2')
    expect(w.find('[data-testid="compare-delta"]').exists()).toBe(true)
  })
})

describe('vista «Comparar» del panel del coche y Esc', () => {
  it('el conmutador de la cabecera cambia de vista sin otra fila; Esc cierra la comparación antes que el seguimiento', async () => {
    attach()
    const playback = usePlaybackStore()
    const compare = useCompareStore()
    // Los de la página (useReplayShortcuts): seguimiento y selección, por debajo de la comparación.
    const offs = [
      registerEscape(ESC_PRIORITY.follow, { active: () => playback.following, run: () => playback.setFollowing(false) }),
      registerEscape(ESC_PRIORITY.selection, { active: () => playback.selectedCar !== null, run: () => playback.selectCar(null) }),
    ]
    onTestFinished(() => offs.forEach((off) => off()))
    playback.selectCar('1')
    const w = track(
      await mountSuspended(TzTelemetry, {
        global: { stubs: { TzMiniChart: true, TzLapInfo: true, TzCompare: { template: '<div data-testid="compare-stub" />' } } },
      }),
    )
    const toggle = w.find('[data-testid="compare-toggle"]')
    expect(toggle.element.closest('header')).not.toBeNull()
    expect(toggle.attributes('aria-pressed')).toBe('false')
    expect(toggle.attributes('aria-label')).toMatch(/^(Comparar|Compare)$/)
    expect(w.find('[data-testid="compare-stub"]').exists()).toBe(false)
    expect(w.find('[data-testid="tel-speed"]').exists()).toBe(true)

    await toggle.trigger('click')
    expect(toggle.attributes('aria-pressed')).toBe('true')
    expect(w.find('[data-testid="compare-stub"]').exists()).toBe(true)
    expect(w.find('[data-testid="tel-speed"]').exists()).toBe(false)

    compare.setCompareCar('2')
    playback.setFollowing(true)
    expect(handleEscape()).toBe(true)
    expect([compare.tab, compare.compareCar, playback.following, playback.selectedCar]).toEqual(['live', null, true, '1'])
    await nextTick()
    expect(w.find('[data-testid="tel-speed"]').exists()).toBe(true)
    expect(handleEscape()).toBe(true)
    expect(playback.following).toBe(false)
    expect(handleEscape()).toBe(true)
    expect(playback.selectedCar).toBeNull()
  })

  it('la comparación se cierra sola al deseleccionar, y B se olvida si pasa a ser A', () => {
    attach()
    const playback = usePlaybackStore()
    const compare = useCompareStore()
    playback.selectCar('1')
    compare.setCompareCar('1')
    expect(compare.compareCar).toBeNull() // nunca A frente a sí mismo
    compare.setCompareCar('2')
    expect([compare.tab, compare.comparing]).toEqual(['compare', true])
    playback.selectCar('2')
    expect([compare.compareCar, compare.comparing]).toEqual([null, false])
    compare.setCompareCar('3')
    playback.selectCar(null)
    expect([compare.tab, compare.compareCar]).toEqual(['live', null])
  })
})

describe('Mayús+clic en la clasificación', () => {
  it('con un coche elegido, elige el de la fila para comparar (otra vez, lo quita); marcas «A» y «B»', async () => {
    attach()
    const playback = usePlaybackStore()
    const compare = useCompareStore()
    const w = track(await mountSuspended(TzLeaderboard))
    const button = (car: string) => w.find(`[data-car="${car}"] button`)
    // Sin coche elegido, Mayús+clic es una selección normal.
    await button('1').trigger('click', { shiftKey: true })
    expect([playback.selectedCar, compare.compareCar]).toEqual(['1', null])

    await button('2').trigger('click', { shiftKey: true })
    expect([playback.selectedCar, compare.compareCar, compare.tab]).toEqual(['1', '2', 'compare'])
    await nextTick()
    expect(w.find('[data-car="1"]').attributes('data-compare')).toBe('a')
    expect(w.find('[data-car="2"]').attributes('data-compare')).toBe('b')
    expect(w.find('[data-car="2"] [data-testid="compare-role"]').text()).toMatch(/^B/)
    expect(w.find('[data-car="3"] [data-testid="compare-role"]').exists()).toBe(false)

    await button('2').trigger('click', { shiftKey: true })
    expect(compare.compareCar).toBeNull()
    await nextTick()
    expect(w.find('[data-testid="compare-role"]').exists()).toBe(false)

    // Un clic normal sigue seleccionando (y B pasa a ser A: la comparación se queda sin B).
    await button('2').trigger('click', { shiftKey: true })
    await button('2').trigger('click')
    expect([playback.selectedCar, compare.compareCar]).toEqual(['2', null])
  })
})

describe('preferencia del fantasma', () => {
  // Una Pinia nueva por caso: la preferencia se lee una vez por store.
  beforeEach(() => setActivePinia(createPinia()))

  it('activado por defecto; se guarda por navegador con su versión de formato', () => {
    const compare = useCompareStore()
    compare.hydrate()
    expect(compare.showGhost).toBe(true)
    compare.setShowGhost(false)
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ showGhost: false, _v: 1 })
    setActivePinia(createPinia())
    const again = useCompareStore()
    again.hydrate()
    expect(again.showGhost).toBe(false)
  })

  it('descarta lo que no entiende (otro tipo, otra versión del formato o JSON roto)', () => {
    for (const raw of [{ showGhost: 'no', _v: 1 }, { showGhost: false, _v: 2 }, { showGhost: false }, 'no json']) {
      setActivePinia(createPinia())
      localStorage.setItem(KEY, typeof raw === 'string' ? raw : JSON.stringify(raw))
      const s = useCompareStore()
      s.hydrate()
      expect(s.showGhost, JSON.stringify(raw)).toBe(true)
    }
  })
})
