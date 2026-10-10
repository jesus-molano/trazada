/**
 * Malla de las zonas de DRS (TS puro, sin three): los cuadriláteros de la cinta de la pista cuyo punto medio cae en
 * alguna zona (`rangeIndices`, como los sectores de comisarios), todos en un solo índice (una draw call) y con solo
 * los vértices que usan. Lleva los atributos de la anchura de mapa (`mapCenter`, `mapNormal`): con el mismo shader y
 * los mismos parámetros que la pista, la cubre entera a cualquier distancia.
 */
import { buildRibbon, rangeIndices, TRACK_WIDTH_M } from '../track/ribbon'
import type { TrackPath } from '../track/TrackPath'

export interface ZoneMesh {
  positions: Float32Array
  mapCenter: Float32Array
  mapNormal: Float32Array
  indices: Uint32Array
}

/** `spans`: pares [inicio, fin) en m (inicio > fin si cruza s = 0), los de `DrsZones.spans`. */
export function drsZoneMesh(path: TrackPath, spans: ArrayLike<number>, flat: boolean, width = TRACK_WIDTH_M): ZoneMesh {
  const parts: Uint32Array[] = []
  for (let k = 0; k + 1 < spans.length; k += 2) parts.push(rangeIndices(path, spans[k]!, spans[k + 1]!))
  const total = parts.reduce((acc, p) => acc + p.length, 0)
  if (total === 0) {
    return {
      positions: new Float32Array(0),
      mapCenter: new Float32Array(0),
      mapNormal: new Float32Array(0),
      indices: new Uint32Array(0),
    }
  }
  const ribbon = buildRibbon(path, width, flat)
  const remap = new Int32Array(ribbon.positions.length / 3).fill(-1)
  const indices = new Uint32Array(total)
  let used = 0
  let o = 0
  for (const part of parts) {
    for (const v of part) {
      if (remap[v]! < 0) remap[v] = used++
      indices[o++] = remap[v]!
    }
  }
  const positions = new Float32Array(used * 3)
  const mapCenter = new Float32Array(used * 3)
  const mapNormal = new Float32Array(used * 3)
  for (let v = 0; v < remap.length; v++) {
    const w = remap[v]!
    if (w < 0) continue
    for (let k = 0; k < 3; k++) {
      positions[w * 3 + k] = ribbon.positions[v * 3 + k]!
      mapCenter[w * 3 + k] = ribbon.mapCenter[v * 3 + k]!
      mapNormal[w * 3 + k] = ribbon.mapNormal[v * 3 + k]!
    }
  }
  return { positions, mapCenter, mapNormal, indices }
}
