/**
 * Carga de una sesión: manifest → descarga con progreso → sha256 → gunzip → TRZB/JSON.
 * Código puro (sin Vue ni DOM): corre en el Web Worker y en los tests de Node.
 */
import {
  assertManifest,
  decodeTrzb,
  decompress,
  type DecodedTrzb,
  type FileRef,
  LAYOUTS,
  type LayoutName,
  type Manifest,
  ManifestError,
  type SessionEvents,
} from '@trazada/schema'
import { sessionDrsZones } from '../engine/drs/zones'
import { computeTangents } from '../engine/replay/motion'
import { realignPositionTimes } from '../engine/replay/realign'
import { LoadError, type LoadedSession, type LoadStage, type LoadTimings } from './types'

export interface LoadOptions {
  onProgress?: (stage: LoadStage, loaded: number, total: number) => void
  onManifest?: (manifest: Manifest) => void
  fetch?: typeof fetch
  now?: () => number
  /** Reajuste de la hora de las posiciones (D52); solo se apaga para medir su efecto (tests @local). */
  realign?: boolean
}

const FILE_KEYS = ['circuit', 'motion', 'car', 'timing', 'events'] as const
type FileKey = (typeof FILE_KEYS)[number]

async function getOrThrow(fetchImpl: typeof fetch, url: string, notFound: 'not-found' | 'network'): Promise<Response> {
  let res: Response
  try {
    res = await fetchImpl(url)
  } catch (err) {
    throw new LoadError('network', `no se pudo descargar ${url}: ${String(err)}`)
  }
  if (res.status === 404) throw new LoadError(notFound, `${url} no existe (404)`)
  if (!res.ok) throw new LoadError('network', `${url} respondió ${res.status}`)
  return res
}

/** Lee el cuerpo entero informando del avance; `expected` es el tamaño del manifest (si el servidor no da otro). */
async function readBody(res: Response, expected: number, onChunk: (n: number) => void): Promise<Uint8Array> {
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer())
    onChunk(buf.byteLength)
    return buf
  }
  const reader = res.body.getReader()
  let out = new Uint8Array(Math.max(expected, 1024))
  let length = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (length + value.byteLength > out.byteLength) {
      const grown = new Uint8Array(Math.max(out.byteLength * 2, length + value.byteLength))
      grown.set(out.subarray(0, length))
      out = grown
    }
    out.set(value, length)
    length += value.byteLength
    onChunk(value.byteLength)
  }
  return out.subarray(0, length)
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? (bytes.buffer as ArrayBuffer)
    : (bytes.slice().buffer as ArrayBuffer)
}

function resolveFile(manifestUrl: string, ref: FileRef): string {
  const url = new URL(ref.path, manifestUrl)
  if (url.origin !== new URL(manifestUrl).origin) {
    throw new LoadError('invalid-manifest', `fichero fuera del origen de datos: ${ref.path}`)
  }
  return url.href
}

export async function loadSession(
  manifestUrl: string,
  id: string,
  readerVersion: string,
  opts: LoadOptions = {},
): Promise<LoadedSession> {
  const fetchImpl = opts.fetch ?? fetch
  const now = opts.now ?? (() => performance.now())
  const t0 = now()

  // 1. Manifest
  opts.onProgress?.('manifest', 0, 1)
  const res = await getOrThrow(fetchImpl, manifestUrl, 'not-found')
  let manifest: unknown
  try {
    manifest = await res.json()
  } catch {
    throw new LoadError('invalid-manifest', 'el manifest no es JSON válido')
  }
  try {
    assertManifest(manifest, readerVersion)
  } catch (err) {
    if (err instanceof ManifestError) {
      throw new LoadError(err.code === 'unsupported-version' ? 'unsupported-version' : 'invalid-manifest', err.message)
    }
    throw err
  }
  const m = manifest as Manifest
  opts.onManifest?.(m)
  if (m.session.status === 'no-position') throw new LoadError('no-position', 'sesión sin datos de posición')
  for (const key of FILE_KEYS) {
    if (m.files[key].compression !== 'gzip' && m.files[key].compression !== 'none') {
      throw new LoadError('unsupported-version', `compresión ${m.files[key].compression} no soportada`)
    }
  }
  const t1 = now()

  // 2. Descarga (en paralelo) con progreso agregado
  const total = FILE_KEYS.reduce((acc, k) => acc + m.files[k].bytes, 0)
  let loaded = 0
  opts.onProgress?.('download', 0, total)
  const raw = await Promise.all(
    FILE_KEYS.map(async (key) => {
      const ref = m.files[key]
      const body = await getOrThrow(fetchImpl, resolveFile(manifestUrl, ref), 'network')
      return readBody(body, ref.bytes, (n) => {
        loaded += n
        opts.onProgress?.('download', Math.min(loaded, total), total)
      })
    }),
  )
  const t2 = now()

  // 3. Integridad
  opts.onProgress?.('decode', 0, FILE_KEYS.length)
  const hashes = await Promise.all(raw.map(sha256Hex))
  FILE_KEYS.forEach((key, i) => {
    if (hashes[i] !== m.files[key].sha256) {
      throw new LoadError('corrupt', `${key}: sha256 no coincide con el manifest`)
    }
  })
  const t3 = now()

  // 4. Descompresión
  const plain = await Promise.all(
    FILE_KEYS.map(async (key, i) => {
      try {
        return await decompress(toArrayBuffer(raw[i]!), m.files[key].compression === 'none' ? 'none' : 'gzip')
      } catch (err) {
        throw new LoadError('corrupt', `${key}: no se pudo descomprimir (${String(err)})`)
      }
    }),
  )
  const t4 = now()

  // 5. Decodificación
  const decoded = {} as Record<Exclude<FileKey, 'events'>, DecodedTrzb>
  let events: SessionEvents
  try {
    for (const [i, key] of FILE_KEYS.entries()) {
      if (key === 'events') continue
      decoded[key] = decodeTrzb(plain[i]!, LAYOUTS[key as LayoutName])
      opts.onProgress?.('decode', i + 1, FILE_KEYS.length)
    }
    const ev = JSON.parse(new TextDecoder().decode(plain[FILE_KEYS.indexOf('events')]!)) as SessionEvents
    if (ev?.schema !== 'trazada.events' || !Array.isArray(ev.raceControl)) throw new Error('events.json inválido')
    events = ev
  } catch (err) {
    throw new LoadError('decode', `no se pudieron decodificar los datos: ${(err as Error).message}`)
  }
  opts.onProgress?.('decode', FILE_KEYS.length, FILE_KEYS.length)
  const t5 = now()

  // 6. Hora de las posiciones reajustada por consenso entre coches (D52: sin los tirones del feed), y tangentes de la
  //    interpolación (velocidad medida, con el limitador de monotonía) sobre esas horas.
  if (opts.realign !== false) realignPositionTimes(decoded.motion, decoded.car)
  const tangents = computeTangents(decoded.motion, decoded.car, 'speed')
  const t6 = now()

  // 7. Zonas de DRS deducidas de la telemetría (D38): solo 2018–2025; si no, solo el motivo.
  const drsZones = sessionDrsZones(m, { ...decoded, events }, tangents)
  const t7 = now()

  const timings: LoadTimings = {
    manifestMs: t1 - t0,
    downloadMs: t2 - t1,
    verifyMs: t3 - t2,
    decompressMs: t4 - t3,
    decodeMs: t5 - t4,
    tangentsMs: t6 - t5,
    drsZonesMs: t7 - t6,
    totalMs: t7 - t0,
    bytes: total,
  }
  return { id, manifest: m, ...decoded, events, tangents, drsZones, timings }
}

/** Buffers únicos de todos los typed arrays de la sesión, para transferirlos sin copia. */
export function transferablesOf(session: LoadedSession): ArrayBuffer[] {
  const out = new Set<ArrayBuffer>([
    session.tangents.buffer as ArrayBuffer,
    session.drsZones.spans.buffer as ArrayBuffer,
    session.drsZones.passes.buffer as ArrayBuffer,
  ])
  for (const dec of [session.motion, session.car, session.timing, session.circuit]) {
    for (const table of Object.values(dec.tables)) {
      for (const col of Object.values(table.columns)) out.add(col.buffer as ArrayBuffer)
    }
  }
  return [...out]
}
