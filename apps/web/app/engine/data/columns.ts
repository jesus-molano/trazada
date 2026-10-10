/** Acceso tipado a las columnas decodificadas (sin copias). */
import type { DecodedTrzb, TypedColumn } from '@trazada/schema'

export function column(dec: DecodedTrzb, table: string, name: string): TypedColumn {
  const col = dec.tables[table]?.columns[name]
  if (!col) throw new Error(`${dec.header.layout}: falta ${table}.${name}`)
  return col
}

export interface LapsView {
  rows: number
  car: TypedColumn
  lap: TypedColumn
  startMs: TypedColumn
  endMs: TypedColumn
  lapMs: TypedColumn
  pitInMs: TypedColumn
  pitOutMs: TypedColumn
  position: TypedColumn
  compound: TypedColumn
  deleted: TypedColumn
}

export function lapsView(timing: DecodedTrzb): LapsView {
  const c = (n: string) => column(timing, 'laps', n)
  return {
    rows: timing.tables.laps!.rows,
    car: c('car'),
    lap: c('lap'),
    startMs: c('startMs'),
    endMs: c('endMs'),
    lapMs: c('lapMs'),
    pitInMs: c('pitInMs'),
    pitOutMs: c('pitOutMs'),
    position: c('position'),
    compound: c('compound'),
    deleted: c('deleted'),
  }
}
