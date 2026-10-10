/** Solo para tests (Node): carga el fixture e2e desde disco con el mismo código que el Web Worker. */
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type DecodedTrzb, SCHEMA_VERSION } from '@trazada/schema'
import { loadSession } from '../data/load-session'
import type { LoadedSession } from '../data/types'

/**
 * Ruta relativa a apps/web, con `/` final. Sin `new URL(…, import.meta.url)`: Vite reescribe ese patrón
 * como un asset en el entorno Nuxt de Vitest.
 */
function webPath(rel: string): string {
  return `${resolve(dirname(fileURLToPath(import.meta.url)), '../..', rel)}/`
}

export const FIXTURE_ROOT = webPath('tests/fixtures/data')
export const FIXTURE_FP1 = '2026/10-spa-francorchamps/fp1'

/** Raíz de datos completos en local (data/ del repo, ignorado por git). */
export const LOCAL_DATA_ROOT = webPath('../../data')

export function fixtureFetch(opts: { fail?: RegExp; chunk?: number; root?: string } = {}): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = new URL(String(input))
    if (opts.fail?.test(url.pathname)) throw new TypeError('network down')
    const rel = url.pathname.replace(/^\/data\//, '')
    try {
      const bytes = await readFile((opts.root ?? FIXTURE_ROOT) + rel)
      const chunk = opts.chunk ?? bytes.byteLength
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (let i = 0; i < bytes.byteLength; i += chunk) controller.enqueue(new Uint8Array(bytes.subarray(i, i + chunk)))
          controller.close()
        },
      })
      return new Response(stream, { status: 200 })
    } catch {
      return new Response('not found', { status: 404 })
    }
  }) as typeof fetch
}

let cached: Promise<LoadedSession> | null = null

export function loadFixture(id = FIXTURE_FP1): Promise<LoadedSession> {
  if (id === FIXTURE_FP1 && cached) return cached
  const p = loadSession(`http://datos.test/data/v1/sessions/${id}/manifest.json`, id, SCHEMA_VERSION, {
    fetch: fixtureFetch(),
  })
  if (id === FIXTURE_FP1) cached = p
  return p
}

/** Sesión completa de data/ (solo en local). */
export function loadLocal(id: string): Promise<LoadedSession> {
  return loadSession(`http://datos.test/data/v1/sessions/${id}/manifest.json`, id, SCHEMA_VERSION, {
    fetch: fixtureFetch({ root: LOCAL_DATA_ROOT }),
  })
}

/** DecodedTrzb sintético para tests de lógica. */
export function fakeTrzb(layout: string, tables: Record<string, Record<string, ArrayLike<number>>>): DecodedTrzb {
  return {
    header: { layout, revision: 1, schemaVersion: SCHEMA_VERSION, tables: [], meta: {} },
    tables: Object.fromEntries(
      Object.entries(tables).map(([name, cols]) => {
        const columns = Object.fromEntries(Object.entries(cols).map(([k, v]) => [k, Float64Array.from(v)]))
        const rows = Object.values(columns)[0]?.length ?? 0
        return [name, { rows, columns }]
      }),
    ),
  }
}
