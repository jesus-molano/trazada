import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import TzSessionRow from '~/components/TzSessionRow.vue'
import type { Job } from '~/manager/model'

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
  ...over,
})

describe('TzSessionRow (gestor de datos local)', () => {
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

  it('futura: deshabilitada, con la fecha desde la que se podrá descargar', async () => {
    const w = await mountSuspended(TzSessionRow, {
      props: { type: 'race', view: { kind: 'future', at: Date.UTC(2026, 11, 6, 15, 30) } },
    })
    const row = w.find('[data-testid="session-race"]')
    expect(row.attributes('aria-disabled')).toBe('true')
    expect(row.text()).toMatch(/(Disponible desde|Available from)/)
    expect(w.find('button').exists()).toBe(false)
  })
})
