/**
 * Iconos y pistas (D30): TzIcon es decorativo salvo que lleve nombre, y TzHint es una pista que se abre al
 * pulsar (en iPad un `title` no se ve), con el patrón de disclosure: aria-expanded, aria-controls, Esc y clic fuera.
 */
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it } from 'vitest'
import { h, nextTick } from 'vue'
import TzHint from '~/components/TzHint.vue'
import TzIcon from '~/components/TzIcon.vue'
import { ICON_NAMES } from '~/design/icons'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('TzIcon', () => {
  it('sin etiqueta es decorativo: aria-hidden, sin rol ni nombre', async () => {
    const w = await mountSuspended(TzIcon, { props: { name: 'close' } })
    const svg = w.find('svg')
    expect(svg.exists()).toBe(true)
    expect(svg.attributes('aria-hidden')).toBe('true')
    expect(svg.attributes('role')).toBeUndefined()
    expect(svg.attributes('aria-label')).toBeUndefined()
    expect(svg.attributes('data-icon')).toBe('close')
    expect(svg.classes()).toEqual(expect.arrayContaining(['tz-icon', 'tz-icon--md']))
    // Trazo con el color del texto: ningún color propio.
    expect(svg.attributes('stroke')).toBe('currentColor')
  })

  it('con etiqueta es una imagen con nombre (y sin aria-hidden)', async () => {
    const w = await mountSuspended(TzIcon, { props: { name: 'info', size: 'lg', label: 'Más información' } })
    const svg = w.find('svg')
    expect(svg.attributes('role')).toBe('img')
    expect(svg.attributes('aria-label')).toBe('Más información')
    expect(svg.attributes('aria-hidden')).toBeUndefined()
    expect(svg.classes()).toContain('tz-icon--lg')
  })

  it('todos los nombres del registro pintan un <svg>', async () => {
    for (const name of ICON_NAMES) {
      const w = await mountSuspended(TzIcon, { props: { name } })
      expect(w.find('svg').exists(), name).toBe(true)
      expect(w.find('svg').element.childElementCount, name).toBeGreaterThan(0)
    }
  })
})

describe('TzHint', () => {
  it('es un botón de icono con nombre que muestra y oculta su texto (aria-expanded y aria-controls)', async () => {
    const w = await mountSuspended(TzHint, {
      props: { label: 'Por qué es estimado', text: 'Se deduce de la telemetría.', testid: 'why' },
      attachTo: document.body,
    })
    const button = w.find('[data-testid="why"]')
    const panel = w.find('[data-testid="why-panel"]')
    expect(button.element.tagName).toBe('BUTTON')
    expect(button.attributes('type')).toBe('button')
    expect(button.attributes('aria-label')).toBe('Por qué es estimado')
    expect(button.classes()).toContain('tz-iconbtn')
    expect(button.find('svg').attributes('aria-hidden')).toBe('true')
    expect(button.attributes('aria-expanded')).toBe('false')
    expect(button.attributes('aria-controls')).toBe(panel.attributes('id'))
    expect((panel.element as HTMLElement).style.display).toBe('none')
    expect(panel.text()).toBe('Se deduce de la telemetría.')

    await button.trigger('click')
    await nextTick()
    expect(button.attributes('aria-expanded')).toBe('true')
    expect((panel.element as HTMLElement).style.display).toBe('')
    expect(panel.classes()).toContain('is-placed')

    await button.trigger('click')
    await nextTick()
    expect(button.attributes('aria-expanded')).toBe('false')
    expect((panel.element as HTMLElement).style.display).toBe('none')
  })

  it('Esc la cierra, devuelve el foco al botón y el evento queda atendido (no llega al Esc global)', async () => {
    const w = await mountSuspended(TzHint, { props: { label: 'Más información', text: 'Texto' }, attachTo: document.body })
    const button = w.find('[data-testid="hint"]')
    await button.trigger('click')
    await nextTick()
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    w.find('[data-testid="hint-panel"]').element.dispatchEvent(esc)
    await nextTick()
    expect(esc.defaultPrevented).toBe(true)
    expect(button.attributes('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(button.element)

    // Cerrada, Esc no se atiende: sigue hasta el atajo global.
    const free = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    button.element.dispatchEvent(free)
    expect(free.defaultPrevented).toBe(false)
  })

  it('un toque fuera la cierra; dentro del panel, no', async () => {
    const w = await mountSuspended(TzHint, { props: { label: 'Más información', text: 'Texto' }, attachTo: document.body })
    const button = w.find('[data-testid="hint"]')
    await button.trigger('click')
    await nextTick()
    w.find('[data-testid="hint-panel"]').element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await nextTick()
    expect(button.attributes('aria-expanded')).toBe('true')
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await nextTick()
    expect(button.attributes('aria-expanded')).toBe('false')
  })

  it('el contenido puede llegar por el slot', async () => {
    const w = await mountSuspended(TzHint, {
      props: { label: 'Más información' },
      slots: { default: () => h('strong', 'Detalle') },
    })
    expect(w.find('[data-testid="hint-panel"] strong').text()).toBe('Detalle')
  })
})
