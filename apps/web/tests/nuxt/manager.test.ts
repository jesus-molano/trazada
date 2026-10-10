import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TzSessionRow from '~/components/TzSessionRow.vue'
import type { Job } from '~/manager/model'
import { useCatalogStore } from '~/stores/catalog'
import { useManagerStore } from '~/stores/manager'

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

describe('TzSessionRow (gestor de datos local)', () => {
  it('enlace a una sesión dev: insignia DEV', async () => {
    const w = await mountSuspended(TzSessionRow, {
      props: { type: 'fp1', view: { kind: 'link', to: '/replay?s=2026/03-suzuka/fp1', bytes: null, dev: true } },
    })
    expect(w.find('a[data-testid="session-fp1"] .tz-badge--dev').text()).toBe('DEV')
  })

  it('enlace a la sesión generada, sin botones', async () => {
    const w = await mountSuspended(TzSessionRow, {
      props: { type: 'fp1', view: { kind: 'link', to: '/replay?s=2026/03-suzuka/fp1', bytes: 1_840_000, dev: false } },
    })
    const link = w.find('a[data-testid="session-fp1"]')
    expect(link.attributes('href')).toBe('/replay?s=2026/03-suzuka/fp1')
    expect(link.attributes('data-state')).toBe('link')
    expect(w.find('button').exists()).toBe(false)
  })

  it('«Descargar» con nombre accesible y evento', async () => {
    const w = await mountSuspended(TzSessionRow, { props: { type: 'race', view: { kind: 'download' } } })
    const button = w.find('[data-testid="download-race"]')
    expect(button.attributes('aria-label')).toMatch(/(Descargar Carrera|Download Race)/)
    await button.trigger('click')
    expect(w.emitted('download')).toHaveLength(1)
  })

  it('en curso: barra de progreso accesible, fase y cancelar con el id del trabajo', async () => {
    const w = await mountSuspended(TzSessionRow, {
      props: { type: 'fp1', view: { kind: 'running', job: job({ state: 'running', pct: 40.4, phase: 'download' }) } },
    })
    const bar = w.find('[role="progressbar"]')
    expect(bar.attributes('aria-valuenow')).toBe('40')
    expect(w.text()).toMatch(/(Descargando|Downloading)…/)
    expect(w.text()).toMatch(/40\s?%/)
    await w.find('[data-testid="cancel-fp1"]').trigger('click')
    expect(w.emitted('cancel')).toEqual([['7']])
  })

  it('en cola: insignia y cancelar', async () => {
    const w = await mountSuspended(TzSessionRow, { props: { type: 'q', view: { kind: 'queued', job: job({ session: 'q' }) } } })
    expect(w.find('[data-testid="session-q"]').attributes('data-state')).toBe('queued')
    expect(w.find('[data-testid="cancel-q"]').exists()).toBe(true)
  })

  it('error: explica el código, deja reintentar y muestra el registro', async () => {
    const failed = job({
      state: 'error',
      error: { code: 'empty', message: 'EmptySessionError: sesión vacía' },
      log: ['Traceback (most recent call last):'],
    })
    const w = await mountSuspended(TzSessionRow, { props: { type: 'q', view: { kind: 'error', job: failed } } })
    expect(w.find('[data-testid="error-q"]').text()).toMatch(/(F1 no ha devuelto datos|F1 returned no data)/)
    expect(w.find('details pre').text()).toContain('EmptySessionError: sesión vacía\nTraceback')
    await w.find('[data-testid="retry-q"]').trigger('click')
    expect(w.emitted('download')).toHaveLength(1)
    // Si el registro ya trae el mensaje, no se repite.
    await w.setProps({ view: { kind: 'error', job: { ...failed, log: ['x', 'EmptySessionError: sesión vacía'] } } })
    expect(w.find('details pre').text()).toBe('x\nEmptySessionError: sesión vacía')
  })

  it('no disponible: explica el motivo real (sin posiciones o entrada de catálogo no válida)', async () => {
    const hint = async (reason: 'no-position' | 'invalid') => {
      const w = await mountSuspended(TzSessionRow, { props: { type: 'fp2', view: { kind: 'unavailable', reason } } })
      const row = w.find('[data-testid="session-fp2"]')
      expect(row.attributes('data-state')).toBe('unavailable')
      expect(row.attributes('aria-disabled')).toBe('true')
      return row.attributes('title')
    }
    expect(await hint('no-position')).toMatch(/(posición|position)/)
    const invalid = await hint('invalid')
    expect(invalid).toMatch(/(catálogo|catalogue)/)
    expect(invalid).not.toMatch(/(posición|position)/)
  })

  it('futura: deshabilitada, con la fecha desde la que se podrá descargar', async () => {
    const w = await mountSuspended(TzSessionRow, {
      props: { type: 'race', view: { kind: 'future', at: Date.UTC(2026, 11, 6, 15, 30) } },
    })
    const row = w.find('[data-testid="session-race"]')
    expect(row.attributes('aria-disabled')).toBe('true')
    // La hora sale de duraciones supuestas: el texto la da como aproximada y lo explica (también al lector).
    const note = w.find('[data-testid="available-from"]')
    expect(note.text()).toMatch(/(Descargable hacia el|Downloadable around)/)
    expect(row.text()).not.toMatch(/(Disponible desde|Available from)/)
    expect(note.attributes('title')).toMatch(/(Hora aproximada|Approximate time).*30 min/)
    expect(row.find('.tz-visually-hidden').text()).toBe(note.attributes('title'))
    expect(w.find('button').exists()).toBe(false)
  })

  it('futura sin hora en el calendario: «Aún no disponible», sin fecha inventada', async () => {
    const w = await mountSuspended(TzSessionRow, { props: { type: 'race', view: { kind: 'future', at: null } } })
    expect(w.find('[data-testid="session-race"]').text()).toMatch(/(Aún no disponible|Not available yet)/)
    expect(w.find('[data-testid="available-from"]').exists()).toBe(false)
  })

  it('en curso: el porcentaje se da como aproximado', async () => {
    const w = await mountSuspended(TzSessionRow, {
      props: { type: 'fp1', view: { kind: 'running', job: job({ state: 'running', pct: 40.4, phase: 'download' }) } },
    })
    expect(w.text()).toMatch(/≈40\s?%/)
  })
})

describe('TzSessionRow: el foco del teclado no se pierde al cambiar de estado', () => {
  it('Descargar → Cancelar → Reintentar es el mismo botón; al terminar, el foco pasa al enlace', async () => {
    const w = await mountSuspended(TzSessionRow, {
      props: { type: 'fp1', view: { kind: 'download' } },
      attachTo: document.body,
    })
    const button = w.find('[data-testid="download-fp1"]').element as HTMLButtonElement
    button.focus()
    await w.setProps({ view: { kind: 'queued', job: job({}) } })
    expect(w.find('[data-testid="cancel-fp1"]').element).toBe(button)
    expect(document.activeElement).toBe(button)
    await w.setProps({ view: { kind: 'error', job: job({ state: 'error', error: { code: 'failed', message: '' } }) } })
    expect(w.find('[data-testid="retry-fp1"]').element).toBe(button)
    await w.setProps({ view: { kind: 'link', to: '/replay?s=2026/03-suzuka/fp1', bytes: null, dev: false } })
    await nextTick()
    expect(document.activeElement).toBe(w.find('a[data-testid="session-fp1"]').element)
    w.unmount()
  })
})

describe('store del gestor', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('relee el catálogo cuando termina una descarga, también si el servidor reinició los ids', async () => {
    let jobs = [{ ...job({ state: 'done' }), createdAt: '2026-10-10T08:00:00.000Z' }]
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const body = url.endsWith('/api/status') ? { manager: true } : url.startsWith('/api/jobs') ? { jobs } : {}
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
      }),
    )
    const catalog = useCatalogStore()
    const refresh = vi.spyOn(catalog, 'refresh').mockResolvedValue()
    const manager = useManagerStore()
    const unsubscribe = manager.subscribe()
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    // Mismo id "1" tras reiniciar `pnpm local`, pero otro trabajo: hay que releer otra vez.
    jobs = [{ ...job({ state: 'done' }), createdAt: '2026-10-10T09:30:00.000Z' }]
    await manager.cancel('99')
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(2))
    // El mismo trabajo visto de nuevo no relee.
    await manager.cancel('99')
    expect(refresh).toHaveBeenCalledTimes(2)
    unsubscribe()
  })
})
