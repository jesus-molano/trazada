import { readFile } from 'node:fs/promises'
import { SCHEMA_VERSION } from '@trazada/schema'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FIXTURE_ROOT as ROOT, fixtureFetch } from '../testing/fixture'
import { type LoadOptions, loadSession, transferablesOf } from './load-session'
import { LoadError } from './types'

const BASE = 'http://datos.test/data/'
const EVENT = 'v1/sessions/2026/10-spa-francorchamps'

const load = (session: string, fetchImpl = fixtureFetch(), onProgress?: LoadOptions['onProgress']) =>
  loadSession(`${BASE}${EVENT}/${session}/manifest.json`, `2026/10-spa-francorchamps/${session}`, SCHEMA_VERSION, {
    fetch: fetchImpl,
    onProgress,
  })

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p
    return 'ok'
  } catch (err) {
    expect(err).toBeInstanceOf(LoadError)
    return (err as LoadError).code
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('loadSession', () => {
  it('carga la sesión del fixture con progreso monótono hasta el total', async () => {
    const progress: [string, number, number][] = []
    const s = await load('fp1', fixtureFetch({ chunk: 8192 }), (stage, loaded, total) => progress.push([stage, loaded, total]))
    expect(s.manifest.session.type).toBe('fp1')
    expect(s.motion.header.layout).toBe('motion')
    expect(s.circuit.header.layout).toBe('circuit')
    expect(s.motion.tables.cars!.rows).toBe(s.manifest.drivers.length)
    expect(s.events.schema).toBe('trazada.events')
    const downloads = progress.filter(([stage]) => stage === 'download')
    expect(downloads.length).toBeGreaterThan(5)
    for (let i = 1; i < downloads.length; i++) expect(downloads[i]![1]).toBeGreaterThanOrEqual(downloads[i - 1]![1])
    expect(downloads.at(-1)![1]).toBe(downloads.at(-1)![2])
    expect(s.timings.bytes).toBe(downloads.at(-1)![2])
    // s monótona por coche (ya decodificada a metros)
    const { cars, pos } = s.motion.tables
    for (let c = 0; c < cars!.rows; c++) {
      const start = cars!.columns.start![c]!
      const count = cars!.columns.count![c]!
      let prev = -Infinity
      for (let i = start; i < start + count; i++) {
        if (pos!.columns.path![i] === 2) continue
        expect(pos!.columns.s![i]!).toBeGreaterThanOrEqual(prev)
        prev = pos!.columns.s![i]!
      }
    }
  })

  it('sin crypto.subtle (la app por http://192.168.x.x con pnpm local --lan) carga igual y sigue comprobando el hash', async () => {
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) })
    const s = await load('fp1')
    expect(s.manifest.session.type).toBe('fp1')
    // Un fichero alterado sigue sin pasar la comprobación.
    const tampered = fixtureFetch({ mutate: (url, bytes) => (url.includes('/motion.') ? bytes.map((b, i) => (i === 100 ? b ^ 1 : b)) : bytes) })
    expect(await code(load('fp1', tampered))).not.toBe('ok')
  })

  it('los buffers transferibles son únicos y cubren todas las columnas', async () => {
    const s = await load('fp1')
    const buffers = transferablesOf(s)
    expect(new Set(buffers).size).toBe(buffers.length)
    expect(buffers).toContain(s.motion.tables.pos!.columns.t!.buffer)
    // Zonas de DRS (D38): calculadas en el Web Worker y transferidas sin copia; el fixture es de 2026, sin zonas.
    expect(s.drsZones.status).toBe('season')
    expect(buffers).toContain(s.drsZones.spans.buffer)
    expect(buffers).toContain(s.drsZones.passes.buffer)
    expect(s.timings.drsZonesMs).toBeGreaterThanOrEqual(0)
  })

  it('clasifica los errores', async () => {
    expect(await code(load('race'))).toBe('not-found')
    expect(await code(load('fp2'))).toBe('no-position')
    expect(await code(load('fp3'))).toBe('unsupported-version')
    expect(await code(load('q'))).toBe('corrupt')
    expect(await code(load('fp1', fixtureFetch({ fail: /motion\./ })))).toBe('network')
    expect(await code(load('fp1', fixtureFetch({ fail: /manifest\.json$/ })))).toBe('network')
  })

  it('rechaza ficheros fuera del origen de datos', async () => {
    const evil = (async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('manifest.json')) {
        const m = JSON.parse(await readFile(`${ROOT}${EVENT}/fp1/manifest.json`, 'utf8'))
        m.files.motion.path = 'https://evil.test/x.gz'
        return new Response(JSON.stringify(m))
      }
      return fixtureFetch()(input)
    }) as typeof fetch
    expect(await code(load('fp1', evil))).toBe('invalid-manifest')
  })
})
