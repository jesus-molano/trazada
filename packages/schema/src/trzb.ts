/**
 * Decodificador del contenedor binario TRZB (ver docs/DATA_FORMAT.md). Sin dependencias.
 *
 *   "TRZB" | u16 containerVersion | u16 flags | u32 headerLen | header JSON | padding a 8 | columnas (alineadas a 8)
 *
 * Las columnas `raw` se devuelven como vistas sin copia sobre el buffer (por eso la alineación a 8).
 * Las columnas `delta` o cuantizadas (`scale`/`offset`) se materializan en Float64Array (o el tipo pedido).
 * Las columnas `shuffle` guardan los bytes agrupados por posición y se reordenan antes de decodificar.
 */
import type { LayoutSpec } from './layouts'

export type TrzbType = 'u8' | 'i8' | 'u16' | 'i16' | 'u32' | 'i32' | 'f32' | 'f64'

export type TypedColumn =
  | Uint8Array
  | Int8Array
  | Uint16Array
  | Int16Array
  | Uint32Array
  | Int32Array
  | Float32Array
  | Float64Array

export interface TrzbColumnHeader {
  name: string
  type: TrzbType
  encoding?: 'raw' | 'delta'
  shuffle?: boolean
  scale?: number
  offset?: number
  unit?: string
  decode?: 'f64' | 'f32'
  byteOffset: number
  byteLength: number
}

export interface TrzbTableHeader {
  name: string
  rows: number
  columns: TrzbColumnHeader[]
}

export interface TrzbHeader {
  layout: string
  revision: number
  schemaVersion: string
  tables: TrzbTableHeader[]
  meta: Record<string, unknown>
}

export interface DecodedTable {
  rows: number
  columns: Record<string, TypedColumn>
}

export interface DecodedTrzb {
  header: TrzbHeader
  tables: Record<string, DecodedTable>
}

export class TrzbError extends Error {
  override name = 'TrzbError'
}

const MAGIC = 0x425a5254 // "TRZB" leído como u32 little-endian
const PREAMBLE_BYTES = 12
const SUPPORTED_CONTAINER = 1

const CTORS = {
  u8: Uint8Array,
  i8: Int8Array,
  u16: Uint16Array,
  i16: Int16Array,
  u32: Uint32Array,
  i32: Int32Array,
  f32: Float32Array,
  f64: Float64Array,
} as const

const BYTES: Record<TrzbType, number> = { u8: 1, i8: 1, u16: 2, i16: 2, u32: 4, i32: 4, f32: 4, f64: 8 }

const align8 = (n: number): number => Math.ceil(n / 8) * 8

let littleEndian: boolean | undefined
function isLittleEndian(): boolean {
  littleEndian ??= new Uint8Array(new Uint16Array([1]).buffer)[0] === 1
  return littleEndian
}

/** Deshace el agrupado de bytes: byte k del valor i está en `start + k·rows + i`. */
function unshuffle(buffer: ArrayBuffer, start: number, rows: number, type: TrzbType): TypedColumn {
  const size = BYTES[type]
  const src = new Uint8Array(buffer, start, rows * size)
  const dst = new Uint8Array(rows * size)
  for (let k = 0; k < size; k++) {
    const plane = k * rows
    for (let i = 0; i < rows; i++) dst[i * size + k] = src[plane + i]!
  }
  return new CTORS[type](dst.buffer, 0, rows)
}

function decodeColumn(buffer: ArrayBuffer, base: number, rows: number, col: TrzbColumnHeader): TypedColumn {
  const Ctor = CTORS[col.type]
  if (!Ctor) throw new TrzbError(`tipo desconocido: ${col.type}`)
  const start = base + col.byteOffset
  if (start % BYTES[col.type] !== 0) throw new TrzbError(`columna ${col.name} desalineada`)
  if (col.byteLength !== rows * BYTES[col.type]) throw new TrzbError(`columna ${col.name}: longitud inconsistente`)
  if (start + col.byteLength > buffer.byteLength) throw new TrzbError(`columna ${col.name} fuera del fichero`)
  const raw = col.shuffle ? unshuffle(buffer, start, rows, col.type) : new Ctor(buffer, start, rows)
  const isDelta = col.encoding === 'delta'
  const hasScale = col.scale !== undefined || (col.offset !== undefined && col.offset !== 0)
  if (!isDelta && !hasScale && !col.decode) return raw

  const out = col.decode === 'f32' ? new Float32Array(rows) : new Float64Array(rows)
  const scale = col.scale ?? 1
  const offset = col.offset ?? 0
  let acc = 0
  for (let i = 0; i < rows; i++) {
    const v = raw[i]!
    acc = isDelta ? acc + v : v
    out[i] = acc * scale + offset
  }
  return out
}

/** Decodifica un TRZB ya descomprimido. Si se pasa `expected`, valida layout y columnas requeridas. */
export function decodeTrzb(buffer: ArrayBuffer, expected?: LayoutSpec): DecodedTrzb {
  if (!isLittleEndian()) throw new TrzbError('plataforma big-endian no soportada')
  if (buffer.byteLength < PREAMBLE_BYTES) throw new TrzbError('fichero demasiado corto')
  const view = new DataView(buffer)
  if (view.getUint32(0, true) !== MAGIC) throw new TrzbError('magic incorrecto: no es un fichero TRZB')
  const container = view.getUint16(4, true)
  if (container !== SUPPORTED_CONTAINER) throw new TrzbError(`containerVersion ${container} no soportada`)
  const headerLen = view.getUint32(8, true)
  if (PREAMBLE_BYTES + headerLen > buffer.byteLength) throw new TrzbError('cabecera truncada')
  const header = JSON.parse(
    new TextDecoder().decode(new Uint8Array(buffer, PREAMBLE_BYTES, headerLen)),
  ) as TrzbHeader
  const base = align8(PREAMBLE_BYTES + headerLen)

  if (expected) validateAgainstLayout(header, expected)

  const tables: Record<string, DecodedTable> = {}
  for (const table of header.tables) {
    const columns: Record<string, TypedColumn> = {}
    for (const col of table.columns) columns[col.name] = decodeColumn(buffer, base, table.rows, col)
    tables[table.name] = { rows: table.rows, columns }
  }
  return { header, tables }
}

/** Comprueba que el fichero tiene las tablas y columnas que el lector necesita (las extra se ignoran). */
export function validateAgainstLayout(header: TrzbHeader, layout: LayoutSpec): void {
  if (header.layout !== layout.layout) {
    throw new TrzbError(`layout ${header.layout} recibido; se esperaba ${layout.layout}`)
  }
  for (const [tname, tspec] of Object.entries(layout.tables)) {
    const table = header.tables.find((t) => t.name === tname)
    if (!table) throw new TrzbError(`${layout.layout}: falta la tabla ${tname}`)
    for (const [cname, cspec] of Object.entries(tspec.columns)) {
      const col = table.columns.find((c) => c.name === cname)
      if (!col) throw new TrzbError(`${layout.layout}.${tname}: falta la columna ${cname}`)
      const same =
        col.type === cspec.type &&
        (col.encoding ?? 'raw') === (cspec.encoding ?? 'raw') &&
        (col.shuffle ?? false) === (cspec.shuffle ?? false) &&
        (col.scale ?? 1) === (cspec.scale ?? 1) &&
        (col.offset ?? 0) === (cspec.offset ?? 0)
      if (!same) throw new TrzbError(`${layout.layout}.${tname}.${cname}: tipo o codificación incompatibles`)
    }
  }
}

/** Descomprime (gzip por defecto) con DecompressionStream, disponible en navegador, Web Workers y Node ≥ 18. */
export async function decompress(data: ArrayBuffer, format: 'gzip' | 'none' = 'gzip'): Promise<ArrayBuffer> {
  if (format === 'none') return data
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream(format))
  return await new Response(stream).arrayBuffer()
}
