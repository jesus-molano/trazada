import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import TzFlag from '~/components/TzFlag.vue'
import TzTrackOutline from '~/components/TzTrackOutline.vue'

describe('TzFlag', () => {
  it('bandera decorativa como imagen data: (sin red ni v-html)', async () => {
    const w = await mountSuspended(TzFlag, { props: { country: 'Belgium' } })
    const img = w.find('img[data-testid="flag"]')
    expect(img.attributes('data-iso')).toBe('BE')
    expect(img.attributes('src')).toMatch(/^data:image\/svg\+xml,/)
    expect(img.attributes('alt')).toBe('')
  })

  it('país desconocido o vacío: sin bandera', async () => {
    expect((await mountSuspended(TzFlag, { props: { country: '' } })).find('img').exists()).toBe(false)
    expect((await mountSuspended(TzFlag, { props: { country: 'Atlantis' } })).find('img').exists()).toBe(false)
  })
})

describe('TzTrackOutline', () => {
  it('pinta el trazado con el viewBox común y sin colores propios', async () => {
    const w = await mountSuspended(TzTrackOutline, { props: { d: 'M4 4 60 4 60 60Z' } })
    const svg = w.find('svg[data-testid="track-outline"]')
    expect(svg.attributes('viewBox')).toBe('0 0 64 64')
    expect(svg.attributes('aria-hidden')).toBe('true')
    expect(svg.find('path').attributes('d')).toBe('M4 4 60 4 60 60Z')
    expect(svg.find('path').attributes('stroke')).toBeUndefined()
  })

  it('sin trazado: hueco neutro, nunca uno inventado', async () => {
    const w = await mountSuspended(TzTrackOutline, { props: { d: null } })
    expect(w.find('svg').exists()).toBe(false)
    expect(w.find('[data-testid="track-outline-empty"]').attributes('title')).toMatch(/^(Sin trazado|No outline)$/)
  })
})
