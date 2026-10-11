/**
 * Miniatura del trazado de cada Gran Premio (D27). Los paths vienen de bacinger/f1-circuits (MIT), simplificados por
 * `trazada outlines` en assets/circuit-outlines.json (viewBox 64×64, norte arriba). Sin dato, null: nunca el trazado de
 * otra configuración.
 */
import doc from '../assets/circuit-outlines.json'

interface OutlineDoc {
  viewBox: string
  byLocation: Record<string, string>
  exceptions: Record<string, string | null>
  outlines: Record<string, string>
}

const outlines = doc as OutlineDoc

export const OUTLINE_VIEWBOX = outlines.viewBox

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
