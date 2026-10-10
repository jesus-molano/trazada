/** Preparación de los datos publicables (scripts/stage-data.mjs): nunca sale nada de desarrollo. */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error módulo JS de scripts/ sin tipos
import { stagePublicData } from '../../../../scripts/stage-data.mjs'

function write(path: string, body: string) {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, body)
}

function fixture(opts: { taintedAttribution?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'trazada-stage-'))
  const v1 = join(root, 'v1')
  const session = (dir: string, source: string, attribution: string[]) => {
    write(join(v1, dir, 'motion.aaaa1111.trzb.gz'), 'm')
    write(
      join(v1, dir, 'manifest.json'),
      JSON.stringify({
        pipeline: { source },
        attribution,
        files: {
          motion: { path: 'motion.aaaa1111.trzb.gz' },
          circuit: { path: '../../../../circuits/1-x/circuit.bbbb2222.trzb.gz' },
        },
      }),
    )
  }
  write(join(v1, 'circuits/1-x/circuit.bbbb2222.trzb.gz'), 'c')
  write(join(v1, 'circuits/1-x/circuit.json'), '{}')
  write(join(v1, 'circuits/0-x-dev/circuit.cccc3333.trzb.gz'), 'dev')
  session('sessions/2026/01-x/fp1', 'fastf1', [
    'F1 live timing (vía FastF1)',
    ...(opts.taintedAttribution ? ['multiviewer (vía TracingInsights, dev) (curvas, rotación)'] : []),
  ])
  session('sessions/2026/01-x/race', 'tracinginsights-dev', ['TracingInsights (dev)'])
  write(
    join(v1, 'catalog.json'),
    JSON.stringify({
      schema: 'trazada.catalog',
      seasons: [
        {
          season: 2026,
          events: [
            {
              round: 1,
              slug: 'x',
              sessions: [
                { session: 'fp1', status: 'ok', path: 'sessions/2026/01-x/fp1/manifest.json' },
                { session: 'fp2', status: 'no-position' },
                { session: 'race', status: 'ok', path: 'sessions/2026/01-x/race/manifest.json', dev: true },
              ],
            },
            { round: 2, slug: 'y', sessions: [{ session: 'race', status: 'ok', path: 'nope', dev: true }] },
          ],
        },
      ],
    }),
  )
  return root
}

describe('datos publicables', () => {
  it('solo sesiones no dev, con exactamente sus ficheros y un catálogo sin dev', () => {
    const root = fixture()
    const out = join(root, 'out')
    const summary = stagePublicData(root, out)
    expect(summary.sessions).toEqual(['2026/x/fp1'])
    expect(summary.skipped).toEqual(['2026/x/race', '2026/y/race'])
    expect(existsSync(join(out, 'v1/sessions/2026/01-x/fp1/motion.aaaa1111.trzb.gz'))).toBe(true)
    expect(existsSync(join(out, 'v1/circuits/1-x/circuit.bbbb2222.trzb.gz'))).toBe(true)
    expect(existsSync(join(out, 'v1/sessions/2026/01-x/race'))).toBe(false)
    expect(existsSync(join(out, 'v1/circuits/0-x-dev'))).toBe(false)
    expect(existsSync(join(out, 'v1/circuits/1-x/circuit.json'))).toBe(false) // puntero del pipeline
    const catalog = JSON.parse(readFileSync(join(out, 'v1/catalog.json'), 'utf8'))
    expect(JSON.stringify(catalog)).not.toContain('"dev"')
    expect(catalog.seasons[0].events.map((e: { slug: string }) => e.slug)).toEqual(['x'])
    // La entrada sin datos (no-position) sigue en el catálogo, como no disponible.
    expect(catalog.seasons[0].events[0].sessions.map((x: { session: string }) => x.session)).toEqual(['fp1', 'fp2'])
  })

  it('rechaza una sesión que no está marcada como dev pero usa datos de desarrollo', () => {
    const root = fixture({ taintedAttribution: true })
    expect(() => stagePublicData(root, join(root, 'out'))).toThrow(/desarrollo/)
  })
})
