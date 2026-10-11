import car from '../trzb/car.layout.json'
import circuit from '../trzb/circuit.layout.json'
import enumsJson from '../trzb/enums.json'
import motion from '../trzb/motion.layout.json'
import timing from '../trzb/timing.layout.json'
import type { TrzbType } from './trzb'

export interface ColumnSpec {
  type: TrzbType
  encoding?: 'raw' | 'delta'
  /** Bytes agrupados por posición (mejor compresión); el lector los reordena. */
  shuffle?: boolean
  unit?: string
  scale?: number
  offset?: number
  decode?: 'f64' | 'f32'
  enum?: string
  description?: string
}

export interface LayoutSpec {
  layout: string
  revision: number
  description?: string
  tables: Record<string, { columns: Record<string, ColumnSpec> }>
}

export const LAYOUTS = {
  motion: motion as LayoutSpec,
  car: car as LayoutSpec,
  circuit: circuit as LayoutSpec,
  timing: timing as LayoutSpec,
} as const

export type LayoutName = keyof typeof LAYOUTS

export const ENUMS: { path: string[]; compound: string[]; sessionStatus: string[] } = enumsJson

export type PathKind = 'track' | 'pit' | 'nodata'
export const PATH_TRACK = 0
export const PATH_PIT = 1
export const PATH_NODATA = 2
