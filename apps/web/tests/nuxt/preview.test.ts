/**
 * Vista previa del timeline (ítem 16): la tarjeta (vuelta y reloj, primero rotulado según la sesión, chips de estado
 * de pista compartidos con la cabecera, «Estimado» si es deducido, marcadores cercanos) y cuándo aparece en el
 * timeline (ratón encima, dedo arrastrando, foco del teclado; Esc la oculta).
 */
import type { LoadedSession } from '~/data/types'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TzTimeline from '~/components/TzTimeline.vue'
import TzTimelinePreview from '~/components/TzTimelinePreview.vue'
import TzTrackStatusChips from '~/components/TzTrackStatusChips.vue'
import { createTimelinePreview, PREVIEW_EXT, type PreviewAt } from '~/engine/timeline/preview'
import { emptySnapshot } from '~/engine/trackstate/TrackState'
import { createReplayRuntime, type ReplayRuntime } from '~/replay/runtime'
import { usePlaybackStore } from '~/stores/playback'
import { loadFixture } from '~/testing/fixture'

let rt: ReplayRuntime | null = null

/** Runtime real sobre el fixture (Spa, libres 1), con `session` cambiada si hace falta. */
async function fixtureRuntime(over: (s: LoadedSession) => LoadedSession = (s) => s) {
  rt = createReplayRuntime(over(await loadFixture()))
  usePlaybackStore().attach(rt)
  return rt
}

afterEach(() => {
  usePlaybackStore().detach() // desecha el runtime
  rt = null
  vi.restoreAllMocks()
})

const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)))

describe('TzTrackStatusChips', () => {
  it('chips con el prefijo pedido; «Estimado» si es deducido; con todo vacío, el texto que se le dé', async () => {
    const state = { ...emptySnapshot(), neutral: 'sc' as const, sectors: { 5: 'YELLOW' as const } }
    const w = await mountSuspended(TzTrackStatusChips, { props: { state, inferred: true, placeable: true, testid: 'x' } })
    expect(w.find('[data-testid="x-neutral"]').attributes('data-kind')).toBe('sc')
    expect(w.find('[data-testid="x-sector"]').attributes('data-sectors')).toBe('5')
    expect(w.find('[data-testid="x-sector"]').attributes('title')).toBeUndefined()
    expect(w.find('[data-testid="track-neutral"]').exists()).toBe(false)
    expect(w.find('[data-testid="estimated"][data-field="trackStatus"]').exists()).toBe(true)

    const empty = await mountSuspended(TzTrackStatusChips, {
      props: { state: emptySnapshot(), inferred: false, placeable: false, emptyLabel: 'Nada' },
    })
    expect(empty.find('[data-testid="track-clear"]').text()).toBe('Nada')
    expect(empty.find('[data-testid="estimated"]').exists()).toBe(false)
    // Sin texto para el vacío (la cabecera), no se pinta ningún chip.
    const header = await mountSuspended(TzTrackStatusChips, { props: { state: emptySnapshot(), inferred: false, placeable: false } })
    expect(header.findAll('span').length).toBe(0)
  })

  it('las banderas de sector de la misma clase van en un chip, de la más grave a la más leve, con sus sectores en orden', async () => {
    const sectors = { 21: 'DOUBLE YELLOW', 4: 'YELLOW', 20: 'DOUBLE YELLOW', 9: 'RED', 3: 'DOUBLE YELLOW' } as const
    const state = { ...emptySnapshot(), neutral: 'sc' as const, sectors }
    const w = await mountSuspended(TzTrackStatusChips, { props: { state, inferred: false, placeable: true, testid: 'x' } })
    const chips = w.findAll('[data-testid="x-sector"]')
    expect(chips.map((c) => [c.attributes('data-flag'), c.attributes('data-sectors')])).toEqual([
      ['RED', '9'],
      ['DOUBLE YELLOW', '3 20 21'],
      ['YELLOW', '4'],
    ])
    // Una lista en el idioma de la interfaz: «sectores 3, 20 y 21» (o «sectors 3, 20, and 21»); uno solo, en singular.
    expect(chips[1]!.text()).toMatch(/^(Doble amarilla · sectores 3, 20 y 21|Double yellow · sectors 3, 20, and 21)$/)
    expect(chips[0]!.text()).toMatch(/^(Roja · sector 9|Red · sector 9)$/)
    expect(chips[2]!.text()).toMatch(/^(Amarilla · sector 4|Yellow · sector 4)$/)
  })
})

describe('TzTimelinePreview', () => {
  const at = (over: Partial<PreviewAt> = {}): PreviewAt => ({
    t: 4_300_000,
    clockMs: 3_723_000,
    lap: null,
    totalLaps: null,
    role: 'bestLap',
    leader: { basis: 'bestLap', car: null, lapMs: null },
    track: emptySnapshot(),
    trackInferred: false,
    markers: [],
    ...over,
  })

  it('fuera de carrera: «Mejor vuelta» (nunca «Líder»), con el piloto y su tiempo; sin coche, «sin dato»', async () => {
    const r = await fixtureRuntime()
    const d = r.drivers[0]!
    const w = await mountSuspended(TzTimelinePreview, {
      props: { at: at({ leader: { basis: 'tower', car: d.number, lapMs: 106_123 } }), x: 50, width: 400, visible: true },
    })
    const leader = w.find('[data-testid="preview-leader"]').text()
    expect(leader).toMatch(/^(Mejor vuelta|Best lap)/)
    expect(leader).not.toMatch(/(Líder|Leader)/)
    expect(w.find('[data-testid="preview-leader-name"]').text()).toBe(d.tla)
    expect(w.find('[data-testid="preview-leader-time"]').text()).toMatch(/^1:46[.,]123$/)
    expect(leader).toMatch(/(torre oficial|official tower)/)
    expect(w.find('[data-testid="preview-when"]').text()).toBe('1:02:03')
    expect(w.attributes('role')).toBe('tooltip')
    // Sin banderas: un chip lo dice (no se calla) y sin «Estimado».
    expect(w.find('[data-testid="preview-clear"]').exists()).toBe(true)
    expect(w.find('[data-testid="estimated"]').exists()).toBe(false)

    await w.setProps({ at: at() })
    expect(w.find('[data-testid="preview-leader-name"]').exists()).toBe(false)
    expect(w.find('[data-testid="preview-leader-nodata"]').text()).toMatch(/^(sin dato|no data)$/)
  })

  it('se centra sobre el instante sin salirse de la pista por los lados', async () => {
    await fixtureRuntime()
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(100)
    const w = await mountSuspended(TzTimelinePreview, { props: { at: at(), x: 200, width: 400, visible: true } })
    const left = () => (w.element as HTMLElement).style.transform
    expect(left()).toBe('translateX(150.0px)')
    await w.setProps({ x: 10 })
    expect(left()).toBe('translateX(0.0px)')
    await w.setProps({ x: 395 })
    expect(left()).toBe('translateX(300.0px)')
  })

  it('carrera: «Líder», vuelta con totales; estado de pista deducido con «Estimado»; marcadores con su texto', async () => {
    await fixtureRuntime()
    const w = await mountSuspended(TzTimelinePreview, {
      props: {
        at: at({
          lap: 23,
          totalLaps: 53,
          role: 'leader',
          leader: { basis: 'line', car: '9999', lapMs: null },
          track: { ...emptySnapshot(), neutral: 'sc' },
          trackInferred: true,
          markers: [
            { kind: 'flag', t: 4_300_500, flag: 'sector_yellow', sector: 5 },
            { kind: 'pit', t: 4_299_000, car: '9999' },
            { kind: 'window', t: 4_301_000, window: 'sc' },
            { kind: 'flag', t: 4_302_000, flag: 'red_flag', sector: null },
          ],
        }),
        x: 0,
        width: 400,
        visible: true,
      },
    })
    expect(w.find('[data-testid="preview-when"]').text()).toMatch(/^(Vuelta|Lap) 23\/53 · 1:02:03$/)
    expect(w.find('[data-testid="preview-leader"]').text()).toMatch(/^(Líder|Leader)/)
    // Un dorsal que no está en la lista de pilotos se muestra como número, sin inventar nombre.
    expect(w.find('[data-testid="preview-leader-name"]').text()).toBe('#9999')
    expect(w.find('[data-testid="preview-leader"]').text()).toMatch(/(paso por meta|line crossings)/)
    expect(w.find('[data-testid="preview-neutral"]').attributes('data-kind')).toBe('sc')
    expect(w.find('[data-testid="estimated"][data-field="trackStatus"]').exists()).toBe(true)
    const marks = w.findAll('[data-testid="preview-marker"]').map((m) => m.text())
    expect(marks).toHaveLength(3)
    expect(marks[0]).toMatch(/^(Amarilla|Yellow) · sector 5 · 1:02:03$/)
    expect(marks[1]).toMatch(/pit lane: 9999 · 1:02:02$/)
    expect(marks[2]).toMatch(/(inicio|start)/)
    expect(w.find('[data-testid="preview-markers"]').text()).toMatch(/\+1 (más|more)/)
  })
})

describe('TzTimeline con vista previa', () => {
  const WIDTH = 1000

  async function mountTimeline() {
    const r = await fixtureRuntime()
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      right: WIDTH,
      top: 0,
      bottom: 36,
      width: WIDTH,
      height: 36,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect)
    const w = await mountSuspended(TzTimeline)
    const track = w.find('[data-testid="timeline"]')
    const el = track.element as HTMLElement
    el.setPointerCapture = () => {}
    el.releasePointerCapture = () => {}
    el.hasPointerCapture = () => false
    return { r, w, track }
  }

  const card = (w: VueWrapper) => w.find('[data-testid="timeline-preview"]')
  /** La tarjeta se ve (al ocultarse se queda montada, desvaneciéndose con lo último que mostró). */
  const shown = (w: VueWrapper) => card(w).exists() && card(w).attributes('data-visible') === 'true'

  it('ratón encima: tarjeta del instante bajo el puntero (perezosa, una por runtime); al salir, se oculta', async () => {
    const { r, w, track } = await mountTimeline()
    const ext = vi.spyOn(r, 'ext')
    expect(shown(w)).toBe(false)
    await track.trigger('pointermove', { clientX: WIDTH / 2, pointerType: 'mouse' })
    await frame()
    await nextTick()
    expect(shown(w)).toBe(true)
    const t = Number(card(w).attributes('data-t'))
    expect(Math.abs(t - (r.clock.startMs + r.clock.duration / 2))).toBeLessThan(1)
    expect(card(w).attributes('data-role')).toBe('bestLap')
    expect(track.attributes('aria-describedby')).toBe(card(w).attributes('id'))
    // El reloj no se ha movido (solo se mira).
    expect(r.clock.timeMs).not.toBe(t)

    await track.trigger('pointermove', { clientX: WIDTH / 4, pointerType: 'mouse' })
    await frame()
    await nextTick()
    expect(Math.abs(Number(card(w).attributes('data-t')) - (r.clock.startMs + r.clock.duration / 4))).toBeLessThan(1)
    expect(ext.mock.calls.filter(([key]) => key === PREVIEW_EXT).length).toBeLessThanOrEqual(1)

    await track.trigger('pointerleave', { pointerType: 'mouse' })
    await nextTick()
    expect(shown(w)).toBe(false)
    expect(track.attributes('aria-describedby')).toBeUndefined()
    // Una sola tarjeta: al volver enseguida no se duplica.
    await track.trigger('pointermove', { clientX: WIDTH / 3, pointerType: 'mouse' })
    await frame()
    await nextTick()
    expect(w.findAll('[data-testid="timeline-preview"]')).toHaveLength(1)
    expect(shown(w)).toBe(true)
  })

  it('dedo: aparece al tocar y sigue al arrastrar (el reloj se mueve); al soltar, se oculta', async () => {
    const { r, w, track } = await mountTimeline()
    await track.trigger('pointermove', { clientX: 300, pointerType: 'touch' })
    await frame()
    await nextTick()
    expect(shown(w)).toBe(false) // pasar el dedo sin tocar la pista no la abre
    await track.trigger('pointerdown', { clientX: 300, pointerType: 'touch', button: 0, pointerId: 1 })
    await frame()
    await nextTick()
    expect(shown(w)).toBe(true)
    await track.trigger('pointermove', { clientX: 600, pointerType: 'touch', pointerId: 1 })
    await frame()
    await nextTick()
    const t = Number(card(w).attributes('data-t'))
    expect(Math.abs(t - (r.clock.startMs + 0.6 * r.clock.duration))).toBeLessThan(1)
    expect(Math.abs(r.clock.timeMs - t)).toBeLessThan(1)
    await track.trigger('pointerup', { clientX: 600, pointerType: 'touch', pointerId: 1 })
    await nextTick()
    expect(shown(w)).toBe(false)
    expect(track.attributes('aria-describedby')).toBeUndefined()
  })

  it('dedo: el foco que da el toque no es del teclado aunque el navegador lo marque :focus-visible; al soltar, se oculta', async () => {
    const { w, track } = await mountTimeline()
    const el = track.element as HTMLElement
    // Chromium marca :focus-visible un focus() por script sin interacción previa de ratón (el del toque, que
    // `pointerdown` da antes que el propio navegador); el foco llega en el mismo instante, como en el navegador.
    vi.spyOn(el, 'matches').mockImplementation((sel: string) => sel === ':focus-visible')
    el.focus = () => void el.dispatchEvent(new FocusEvent('focus'))
    await track.trigger('pointerdown', { clientX: 300, pointerType: 'touch', button: 0, pointerId: 1 })
    await frame()
    await nextTick()
    expect(shown(w)).toBe(true)
    await track.trigger('pointerup', { clientX: 300, pointerType: 'touch', pointerId: 1 })
    await nextTick()
    expect(shown(w)).toBe(false)
  })

  it('la vista previa usa su propio estado de pista: el del reloj no cambia', async () => {
    const { r, track } = await mountTimeline()
    // El bucle del runtime ya ha pintado el instante del reloj (en pausa no vuelve a calcularlo).
    await frame()
    await frame()
    const before = r.trackState.snapshot
    const version = r.trackState.version
    for (const x of [100, 300, 500, 700, 900]) {
      await track.trigger('pointermove', { clientX: x, pointerType: 'mouse' })
      await frame()
    }
    expect(r.trackState.snapshot).toBe(before)
    expect(r.trackState.version).toBe(version)
    expect(r.ext(PREVIEW_EXT, createTimelinePreview).role).toBe('bestLap')
  })

  it('foco del teclado: tarjeta sobre el cabezal que sigue a las flechas; Esc la oculta sin mover el foco', async () => {
    const { r, w, track } = await mountTimeline()
    const el = track.element as HTMLElement
    vi.spyOn(el, 'matches').mockImplementation((sel: string) => sel === ':focus-visible')
    await track.trigger('focus')
    await nextTick()
    expect(shown(w)).toBe(true)
    expect(Number(card(w).attributes('data-t'))).toBe(Math.round(r.clock.timeMs))
    await track.trigger('keydown', { key: 'ArrowRight' })
    await nextTick()
    await nextTick()
    expect(Number(card(w).attributes('data-t'))).toBe(Math.round(r.clock.timeMs))
    await track.trigger('keydown', { key: 'Escape' })
    await nextTick()
    expect(shown(w)).toBe(false)
    expect(track.attributes('aria-describedby')).toBeUndefined()
    // Vuelve con la siguiente tecla.
    await track.trigger('keydown', { key: 'ArrowLeft' })
    await nextTick()
    await nextTick()
    expect(shown(w)).toBe(true)
    await track.trigger('blur')
    await nextTick()
    expect(shown(w)).toBe(false)
  })
})
