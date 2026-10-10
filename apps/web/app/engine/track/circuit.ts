/** Modelo del circuito canónico decodificado (layout `circuit`). */
import type { DecodedTrzb } from '@trazada/schema'
import { column } from '../data/columns'
import { newSample, TrackPath } from './TrackPath'

export interface CornerMarker {
  label: string
  s: number
  /** XY de MultiViewer en el sistema canónico (para validar la etiqueta). */
  x: number
  y: number
}

export interface CircuitMeta {
  circuitId: string
  name: string
  lengthM: number
  rotationDeg: number
  pit: { entryS: number; exitS: number; lengthM: number } | null
  quality: Record<string, number>
  sources: string[]
}

export interface CircuitModel {
  meta: CircuitMeta
  centerline: TrackPath
  pitlane: TrackPath | null
  corners: CornerMarker[]
  /** Semiextensión XY (m). */
  extent: number
  /** Radio del círculo que contiene el trazado en planta, centrado en el origen (m). */
  radius: number
  zRange: [number, number]
}

export function circuitModel(dec: DecodedTrzb): CircuitModel {
  const c = (t: string, n: string) => column(dec, t, n)
  const centerline = new TrackPath(c('centerline', 'x'), c('centerline', 'y'), c('centerline', 'z'), true)
  const pitRows = dec.tables.pitlane?.rows ?? 0
  const pitlane = pitRows >= 2 ? new TrackPath(c('pitlane', 'x'), c('pitlane', 'y'), c('pitlane', 'z'), false) : null
  const cornerRows = dec.tables.corners?.rows ?? 0
  const corners: CornerMarker[] = []
  for (let i = 0; i < cornerRows; i++) {
    const letter = c('corners', 'letter')[i]!
    corners.push({
      label: `${c('corners', 'number')[i]}${letter ? String.fromCharCode(letter) : ''}`,
      s: c('corners', 's')[i]!,
      x: c('corners', 'x')[i]!,
      y: c('corners', 'y')[i]!,
    })
  }
  let extent = 0
  let radius = 0
  let zMin = Infinity
  let zMax = -Infinity
  const p = { x: 0, y: 0, z: 0 }
  for (let i = 0; i < centerline.count; i++) {
    centerline.vertex(i, p)
    extent = Math.max(extent, Math.abs(p.x), Math.abs(p.y))
    radius = Math.max(radius, Math.hypot(p.x, p.y))
    zMin = Math.min(zMin, p.z)
    zMax = Math.max(zMax, p.z)
  }
  return { meta: dec.header.meta as unknown as CircuitMeta, centerline, pitlane, corners, extent, radius, zRange: [zMin, zMax] }
}

/** Punto de anclaje de la etiqueta de una curva: la línea central en su s. */
export function cornerAnchor(model: CircuitModel, corner: CornerMarker) {
  return model.centerline.sample(corner.s, newSample())
}
