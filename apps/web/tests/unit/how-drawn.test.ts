/**
 * «Cómo se dibuja» (auditoría J): las cifras del texto que dependen del pipeline tienen que ser las suyas.
 * La de 30 m es el umbral de `projection.py` a partir del cual una muestra lejos de la pista pasa a «sin dato»;
 * el hueco de 2 s, el corte de segmentos que comparten pipeline y motor. Si cambian allí, este test avisa.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SEGMENT_GAP_MS } from '../../app/engine/interp/hermite'
import { loadMessages } from '../../i18n/messages'

type Tree = { [k: string]: string | Tree }
const howDrawn = (lang: string) => (loadMessages(lang) as Tree).howDrawn as Record<string, string>
const projection = readFileSync(
  new URL('../../../../pipeline/src/trazada_pipeline/projection.py', import.meta.url),
  'utf8',
)
const pyConst = (name: string) => Number(projection.match(new RegExp(`^${name} = ([\\d.]+)$`, 'm'))?.[1])

describe('«Cómo se dibuja»: cifras ligadas al pipeline', () => {
  it('la distancia a la línea central a partir de la que el coche se oculta es la del pipeline', () => {
    const maxDist = pyConst('TRACK_MAX_DIST_M')
    expect(maxDist).toBeGreaterThan(0)
    expect(howDrawn('es').centreLine).toContain(`${maxDist} m de la línea central`)
    expect(howDrawn('en').centreLine).toContain(`${maxDist} m from the centre line`)
  })

  it('el hueco sin posición que deja de interpolarse es el mismo en el pipeline y en el motor', () => {
    expect(pyConst('SEGMENT_GAP_MS')).toBe(SEGMENT_GAP_MS)
    for (const lang of ['es', 'en']) expect(howDrawn(lang).interpolation, lang).toContain('{s} s')
  })

  it('explica el pit lane: en boxes, sobre su línea; en el garaje, oculto', () => {
    expect(howDrawn('es').pit).toMatch(/pit lane.*garaje/)
    expect(howDrawn('en').pit).toMatch(/pit lane.*garage/)
  })
})

describe('«Cómo se dibuja» y el README dicen lo mismo', () => {
  /** Claves de `howDrawn` que no son puntos del modelo (títulos, botón y lo que viene de la fuente). */
  const NOT_MODEL = ['button', 'title', 'dataTitle', 'modelTitle', 'positions', 'timing', 'sessionEstimated']

  it('un punto de la app por cada punto de «Modelo (solo para dibujar)» del README', () => {
    // El README dice que el botón «Cómo se dibuja» explica qué es dato y qué es modelo: si una lista crece, la otra también.
    const readme = readFileSync(new URL('../../../../README.md', import.meta.url), 'utf8')
    const section = readme.split('**Modelo (solo para dibujar)**')[1]?.split(/\n## /)[0] ?? ''
    const bullets = section.split('\n').filter((l) => l.startsWith('- '))
    expect(bullets.length).toBeGreaterThan(0)
    for (const lang of ['es', 'en']) {
      const model = Object.keys(howDrawn(lang)).filter((k) => !NOT_MODEL.includes(k))
      expect(model, lang).toHaveLength(bullets.length)
    }
  })
})
