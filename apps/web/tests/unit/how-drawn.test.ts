/**
 * «Cómo se dibuja» (auditoría J): las cifras del texto que dependen del pipeline tienen que ser las suyas.
 * La de 30 m es el umbral de `projection.py` a partir del cual una muestra lejos de la pista pasa a «sin dato»;
 * el hueco de 2 s, el corte de segmentos que comparten pipeline y motor. Si cambian allí, este test avisa.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SEGMENT_GAP_MS } from '../../app/engine/interp/hermite'

type Tree = { [k: string]: string | Tree }
const howDrawn = (lang: string) =>
  (JSON.parse(readFileSync(new URL(`../../i18n/locales/${lang}.json`, import.meta.url), 'utf8')) as Tree)
    .howDrawn as Record<string, string>
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
