/**
 * Miniatura del trazado de cada Gran Premio (D27). Los paths vienen de bacinger/f1-circuits (MIT), simplificados
 * por `trazada outlines` en assets/circuit-outlines.json (viewBox 64×64, norte arriba). Sin dato, null: nunca el
 * trazado de otra configuración.
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

/** Path SVG del trazado de un evento (`slug` = la localidad, como en las rutas de datos), o null. */
export function outlineFor(season: number, round: number, slug: string): string | null {
  const key = `${season}-${round}`
  if (Object.hasOwn(outlines.exceptions, key)) {
    const id = outlines.exceptions[key]
    return id ? (outlines.outlines[id] ?? null) : null
  }
  const id = Object.hasOwn(outlines.byLocation, slug) ? outlines.byLocation[slug] : undefined
  return id ? (outlines.outlines[id] ?? null) : null
}
