/**
 * Miniatura del trazado de cada Gran Premio (D27) y centro del circuito (D37). Los paths vienen de bacinger/f1-circuits
 * (MIT), simplificados por `trazada outlines` en assets/circuit-outlines.json (viewBox 64×64, norte arriba); los
 * centros, del mismo GeoJSON (centro de la caja del trazado, a 0,01°). Sin dato, null: nunca el trazado ni la posición
 * de otra configuración.
 */
import doc from '../assets/circuit-outlines.json'

interface OutlineDoc {
  viewBox: string
  byLocation: Record<string, string>
  exceptions: Record<string, string | null>
  outlines: Record<string, string>
  centers: Record<string, { lat: number; lon: number }>
}

const outlines = doc as OutlineDoc

export const OUTLINE_VIEWBOX = outlines.viewBox

/** Posición de un circuito en grados (WGS84). */
export interface CircuitCenter {
  readonly lat: number
  readonly lon: number
}

/** Circuito (id de bacinger) de un evento: las excepciones por `temporada-ronda` mandan sobre la localidad. */
function circuitIdFor(season: number, round: number, slug: string): string | null {
  const key = `${season}-${round}`
  if (Object.hasOwn(outlines.exceptions, key)) return outlines.exceptions[key] ?? null
  return Object.hasOwn(outlines.byLocation, slug) ? (outlines.byLocation[slug] ?? null) : null
}

/** Path SVG del trazado de un evento (`slug` = la localidad, como en las rutas de datos), o null. */
export function outlineFor(season: number, round: number, slug: string): string | null {
  const id = circuitIdFor(season, round, slug)
  return id && Object.hasOwn(outlines.outlines, id) ? (outlines.outlines[id] ?? null) : null
}

/**
 * Centro del circuito de un evento (mismas reglas que `outlineFor`), o null si no se sabe dónde está: con una
 * localidad desconocida o un trazado que no está en bacinger (GP de Sakhir 2020), nunca la posición de otro.
 */
export function centerFor(season: number, round: number, slug: string): CircuitCenter | null {
  const id = circuitIdFor(season, round, slug)
  const c = id && Object.hasOwn(outlines.centers, id) ? outlines.centers[id] : undefined
  if (!c || !Number.isFinite(c.lat) || !Number.isFinite(c.lon)) return null
  return { lat: c.lat, lon: c.lon }
}
