/**
 * Portada (Tanda 5, worker A; D30, D42, D44, D47): iconos del registro junto al texto (nunca en su lugar), estados
 * claros de las filas de sesión, «sin dato» con su estilo y el destello único al terminar una descarga. El panel de
 * carga y el del bench, también.
 */
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import TzBench from '~/components/TzBench.vue'
import TzLoadPanel from '~/components/TzLoadPanel.vue'
import TzSessionRow from '~/components/TzSessionRow.vue'
import type { Job } from '~/manager/model'
import type { BenchResult } from '~/replay/bench'
import { useSessionStore } from '~/stores/session'

/** El bench real necesita la escena: aquí devuelve al momento el resultado que ponga cada test. */
const bench = vi.hoisted(() => ({ result: null as unknown }))
vi.mock('~/replay/bench', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/replay/bench')>()),
  runBench: (_rt: unknown, _opts: unknown, _select: unknown, onChange: (s: unknown) => void) => {
    onChange({ status: 'done', elapsedS: 3, result: bench.result })
    return () => {}
  },
}))
vi.mock('~/stores/playback', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/stores/playback')>()),
  getRuntime: () => ({}),
}))

const job = (over: Partial<Job>): Job => ({
  id: '7',
  season: 2026,
  round: 3,
  session: 'fp1',
  state: 'queued',
  pct: 0,
  phase: null,
  error: null,
  result: null,
  createdAt: '2026-10-10T08:00:00.000Z',
  ...over,
})

const LINK = { kind: 'link', to: '/replay?s=2026/03-suzuka/fp1', bytes: 1_840_000, dev: false } as const

afterEach(() => {
  document.body.innerHTML = ''
})

describe('TzSessionRow: iconos junto al texto y estados claros', () => {
  it('Descargar, Cancelar y Reintentar llevan su icono decorativo; el texto y el nombre accesible no cambian', async () => {
    const w = await mountSuspended(TzSessionRow, { props: { type: 'race', view: { kind: 'download' } } })
    const download = w.find('[data-testid="download-race"]')
    expect(download.find('svg[data-icon="download"]').attributes('aria-hidden')).toBe('true')
    expect(download.text()).toMatch(/^(Descargar|Download)$/)
    expect(download.attributes('aria-label')).toMatch(/(Descargar Carrera|Download Race)/)

    await w.setProps({ view: { kind: 'running', job: job({ session: 'race', state: 'running', pct: 12 }) } })
    const cancel = w.find('[data-testid="cancel-race"]')
    expect(cancel.find('svg[data-icon="close"]').attributes('aria-hidden')).toBe('true')
    expect(cancel.text()).toMatch(/^(Cancelar|Cancel)$/)

    await w.setProps({ view: { kind: 'error', job: job({ session: 'race', state: 'error', error: { code: 'failed', message: 'x' } }) } })
    const retry = w.find('[data-testid="retry-race"]')
    expect(retry.find('svg[data-icon="retry"]').attributes('aria-hidden')).toBe('true')
    expect(retry.text()).toMatch(/^(Reintentar|Retry)$/)
  })

  it('lista para ver: toda la fila es el enlace, con el icono de abrir decorativo y sin botones', async () => {
    const w = await mountSuspended(TzSessionRow, { props: { type: 'fp1', view: LINK } })
    const link = w.find('a[data-testid="session-fp1"]')
    expect(link.find('svg[data-icon="play"]').attributes('aria-hidden')).toBe('true')
    expect(link.text()).toMatch(/(Libres 1|Practice 1)/)
    expect(w.find('button').exists()).toBe(false)
  })

  it('no disponible: el motivo en texto visible (en iPad un title no se ve), con su icono al lado', async () => {
    const reason = async (r: 'no-position' | 'invalid') => {
      const w = await mountSuspended(TzSessionRow, { props: { type: 'fp2', view: { kind: 'unavailable', reason: r } } })
      const row = w.find('[data-testid="session-fp2"]')
      const note = row.find('[data-testid="unavailable-reason"]')
      expect(note.classes()).not.toContain('tz-visually-hidden')
      expect(note.text()).toBe(row.attributes('title'))
      return { text: note.text(), icon: note.find('svg').attributes('data-icon'), hidden: note.find('svg').attributes('aria-hidden') }
    }
    const noPosition = await reason('no-position')
    expect(noPosition.text).toMatch(/(posición|position)/)
    expect(noPosition.icon).toBe('noSignal')
    expect(noPosition.hidden).toBe('true')
    const invalid = await reason('invalid')
    expect(invalid.text).toMatch(/(catálogo|catalogue)/)
    expect(invalid.icon).toBe('alert')
  })

  it('error: icono junto al motivo y «Detalles» como desplegable con aspecto de enlace (.tz-link) y chevron propio', async () => {
    const failed = job({ state: 'error', error: { code: 'empty', message: 'EmptySessionError' }, log: ['Traceback'] })
    const w = await mountSuspended(TzSessionRow, { props: { type: 'q', view: { kind: 'error', job: failed } } })
    const error = w.find('[data-testid="error-q"]')
    expect(error.find('svg[data-icon="error"]').attributes('aria-hidden')).toBe('true')
    expect(error.text()).toMatch(/(F1 no ha devuelto datos|F1 returned no data)/)
    const summary = w.find('details summary')
    expect(summary.classes()).toContain('tz-link')
    expect(summary.find('svg[data-icon="chevron"]').attributes('aria-hidden')).toBe('true')
    expect(summary.text()).toMatch(/^(Detalles|Details)$/)
  })
})

describe('TzSessionRow: destello único al terminar una descarga (D42)', () => {
  it('en curso → lista para ver: la fila destella (data-fresh) y lo pierde al acabar tz-flash', async () => {
    const w = await mountSuspended(TzSessionRow, {
      props: { type: 'fp1', view: { kind: 'running', job: job({ state: 'running', pct: 95 }) } },
    })
    await w.setProps({ view: LINK })
    const link = w.find('a[data-testid="session-fp1"]')
    expect(link.attributes('data-fresh')).toBe('')
    expect(link.classes()).toContain('is-fresh')
    // Otra animación (p. ej. la entrada de la lista) no lo apaga; el final del destello, sí.
    await link.trigger('animationend', { animationName: 'tz-enter' })
    expect(w.find('a[data-testid="session-fp1"]').attributes('data-fresh')).toBe('')
    await link.trigger('animationend', { animationName: 'tz-flash' })
    await nextTick()
    expect(w.find('a[data-testid="session-fp1"]').attributes('data-fresh')).toBeUndefined()
    expect(w.find('a[data-testid="session-fp1"]').classes()).not.toContain('is-fresh')
  })

  it('en cola → lista también; sin descarga en curso (o si acaba sin posiciones), ningún destello', async () => {
    const queued = await mountSuspended(TzSessionRow, { props: { type: 'fp1', view: { kind: 'queued', job: job({}) } } })
    await queued.setProps({ view: LINK })
    expect(queued.find('a').attributes('data-fresh')).toBe('')

    const idle = await mountSuspended(TzSessionRow, { props: { type: 'fp1', view: { kind: 'download' } } })
    await idle.setProps({ view: LINK })
    expect(idle.find('a').attributes('data-fresh')).toBeUndefined()

    const fresh = await mountSuspended(TzSessionRow, { props: { type: 'fp1', view: LINK } })
    expect(fresh.find('a').attributes('data-fresh')).toBeUndefined()

    const noPosition = await mountSuspended(TzSessionRow, {
      props: { type: 'fp2', view: { kind: 'running', job: job({ session: 'fp2', state: 'running' }) } },
    })
    await noPosition.setProps({ view: { kind: 'unavailable', reason: 'no-position' } })
    expect(noPosition.find('[data-fresh]').exists()).toBe(false)
  })
})

describe('TzLoadPanel', () => {
  afterEach(() => {
    useSessionStore().unload()
  })

  it('error: icono junto al mensaje (que sigue en texto) y acciones con icono, también «Volver al selector»', async () => {
    const session = useSessionStore()
    session.status = 'error'
    session.error = { code: 'network', message: 'fetch failed' }
    const w = await mountSuspended(TzLoadPanel)
    const error = w.find('[data-testid="load-error"]')
    expect(error.attributes('role')).toBe('alert')
    expect(error.find('.tz-load__message svg[data-icon="error"]').attributes('aria-hidden')).toBe('true')
    expect(error.find('.tz-load__message').text()).toMatch(/(No se pudieron descargar|could not be downloaded)/)
    expect(w.find('[data-testid="load-retry"] svg[data-icon="retry"]').exists()).toBe(true)
    const back = w.find('[data-testid="load-back"]')
    expect(back.find('svg[data-icon="back"]').attributes('aria-hidden')).toBe('true')
    expect(back.text()).toMatch(/(Volver al selector|Back to the selector)/)
  })

  it('cargando: la fase en texto y la barra de progreso accesible', async () => {
    const session = useSessionStore()
    session.status = 'loading'
    session.stage = 'download'
    session.progress = 0.42
    const w = await mountSuspended(TzLoadPanel)
    expect(w.find('.tz-load__stage').text()).toMatch(/(Descargando datos|Downloading data)/)
    expect(w.find('[data-testid="load-progress"]').attributes('aria-valuenow')).toBe('42')
  })
})

describe('TzBench', () => {
  const result = (heapMB: number | null): BenchResult => ({
    frames: 120,
    p50: 8,
    p95: 12.3,
    p99: 15.1,
    max: 20,
    over50: 0,
    durationS: 2,
    heapMB,
    longTasks: 0,
    longTaskMaxMs: 0,
    dpr: 1,
    dprChanges: 0,
    drawCalls: 13,
    triangles: 1000,
    visibleCars: 22,
    telemetryOpen: true,
    gpu: 'SwiftShader',
    viewport: [1440, 900],
    devicePixelRatio: 1,
    userAgent: 'test',
    session: '2026/10-spa-francorchamps/fp1',
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sin heap (solo Chromium lo expone): «sin dato» con su estilo, nunca un número inventado', async () => {
    bench.result = result(null)
    const w = await mountSuspended(TzBench)
    const heap = w.find('[data-testid="bench-heap"]')
    expect(heap.text()).toMatch(/^(sin dato|no data)$/)
    expect(heap.classes()).toContain('is-missing')
  })

  it('con heap: la cifra, sin el estilo de «sin dato»', async () => {
    bench.result = result(48.5)
    const w = await mountSuspended(TzBench)
    const heap = w.find('[data-testid="bench-heap"]')
    expect(heap.text()).toBe('48.5')
    expect(heap.classes()).not.toContain('is-missing')
  })

  it('copiar: icono junto al texto; al copiar, «Copiado» con el icono de hecho; si falla, se dice', async () => {
    bench.result = result(48.5)
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const w = await mountSuspended(TzBench)
    const copy = w.find('[data-testid="bench-copy"]')
    expect(copy.find('svg[data-icon="copy"]').attributes('aria-hidden')).toBe('true')
    await copy.trigger('click')
    await vi.waitFor(() => expect(w.find('[data-testid="bench-copy"] svg').attributes('data-icon')).toBe('check'))
    expect(w.find('[data-testid="bench-copy"]').text()).toMatch(/^(Copiado|Copied)$/)
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"heapMB": 48.5'))

    writeText.mockRejectedValueOnce(new Error('denied'))
    await w.find('[data-testid="bench-copy"]').trigger('click')
    await vi.waitFor(() => expect(w.find('[data-testid="bench-copy-failed"]').exists()).toBe(true))
    expect(w.find('[data-testid="bench-copy-failed"]').attributes('role')).toBe('alert')
    expect(w.find('[data-testid="bench-copy-failed"]').text()).toMatch(/(No se pudo copiar|Could not copy)/)
  })
})
