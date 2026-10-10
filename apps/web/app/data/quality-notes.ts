/**
 * Avisos de calidad del manifest (`quality.notes`). El pipeline los escribe como texto libre en español; aquí
 * se reconocen los que escribe hoy para mostrarlos traducidos (`sessionNotes.note.<código>`). Uno que no se
 * reconozca (datos de un pipeline más nuevo) no se esconde: se muestra con su texto original.
 *
 * `anchor` es un trozo literal del texto tal y como está en el código del pipeline: un test comprueba que
 * sigue ahí, para que un cambio de redacción en el pipeline no deje de reconocerse sin que nadie se entere.
 */

export type QualityNote =
  | { code: QualityNoteCode; params: Record<string, number | string> }
  | { code: null; text: string }

interface KnownNote {
  code: string
  pattern: RegExp
  anchor: string
  /** Ejemplo real (tal y como sale del pipeline) para los tests. */
  example: string
  params?: (m: RegExpMatchArray) => Record<string, number | string>
}

const num = (s: string | undefined): number => Number.parseFloat(s ?? '')

export const KNOWN_NOTES = [
  {
    code: 'devSource',
    pattern: /^Datos de desarrollo \(fuente secundaria TracingInsights\)/,
    anchor: 'Datos de desarrollo (fuente secundaria TracingInsights)',
    example: 'Datos de desarrollo (fuente secundaria TracingInsights): no publicar.',
  },
  {
    code: 'devReconstructed',
    pattern: /^Muestras de posición y telemetría reconstruidas/,
    anchor: 'Muestras de posición y telemetría reconstruidas',
    example: 'Muestras de posición y telemetría reconstruidas desde telemetría fusionada por vuelta.',
  },
  {
    code: 'devTrackStatus',
    pattern: /^Estado de pista aproximado desde race control/,
    anchor: 'Estado de pista aproximado desde race control',
    example: 'Estado de pista aproximado desde race control; sin torre de tiempos.',
  },
  {
    code: 'devCorners',
    pattern: /^Curvas y rotación de MultiViewer leídas de una copia de TracingInsights/,
    anchor: 'Curvas y rotación de MultiViewer leídas de una copia de TracingInsights',
    example: 'Curvas y rotación de MultiViewer leídas de una copia de TracingInsights (desarrollo).',
  },
  {
    code: 'circuitDev',
    pattern: /^El circuito (\S+) usa fuentes de desarrollo/,
    anchor: 'usa fuentes de desarrollo: la sesión queda marcada como dev',
    example:
      'El circuito suzuka-dev usa fuentes de desarrollo: la sesión queda marcada como dev (no publicable). Reconstrúyelo sin ellas con --rebuild-circuit.',
    params: (m) => ({ circuit: m[1] ?? '' }),
  },
  {
    code: 'lowCoverage',
    pattern: /^cobertura de posición < 99 %/,
    anchor: 'cobertura de posición < 99 % en algún piloto',
    example: 'cobertura de posición < 99 % en algún piloto',
  },
  {
    code: 'closure',
    pattern: /^cierre de la línea central (\d+(?:\.\d+)?) m > 2 m/,
    anchor: 'cierre de la línea central ',
    example: 'cierre de la línea central 2.35 m > 2 m',
    params: (m) => ({ m: num(m[1]) }),
  },
  {
    code: 'length',
    pattern: /^longitud (\d+(?:\.\d+)?) m vs oficial (\d+(?:\.\d+)?) m/,
    anchor: ' m vs oficial ',
    example: 'longitud 7104 m vs oficial 7004 m (> 3 %)',
    params: (m) => ({ m: num(m[1]), official: num(m[2]) }),
  },
  {
    code: 'noCorners',
    pattern: /^circuito sin curvas ni rotación oficial/,
    anchor: 'circuito sin curvas ni rotación oficial',
    example: 'circuito sin curvas ni rotación oficial (MultiViewer no estaba accesible al construirlo)',
  },
  {
    code: 'e2eExtract',
    pattern: /^Extracto recortado para tests e2e/,
    anchor: 'Extracto recortado para tests e2e',
    example: 'Extracto recortado para tests e2e.',
  },
] as const satisfies readonly KnownNote[]

export type QualityNoteCode = (typeof KNOWN_NOTES)[number]['code']

/** Reconoce un aviso del pipeline; si no lo conoce, lo devuelve tal cual (nunca se descarta). */
export function classifyNote(text: string): QualityNote {
  const trimmed = text.trim()
  for (const known of KNOWN_NOTES as readonly KnownNote[]) {
    const m = trimmed.match(known.pattern)
    if (m) return { code: known.code as QualityNoteCode, params: known.params?.(m) ?? {} }
  }
  return { code: null, text: trimmed }
}

/** Avisos del manifest, sin vacíos ni repetidos, en su orden. */
export function qualityNotes(notes: readonly string[] | undefined): QualityNote[] {
  const seen = new Set<string>()
  const out: QualityNote[] = []
  for (const raw of notes ?? []) {
    const text = typeof raw === 'string' ? raw.trim() : ''
    if (!text || seen.has(text)) continue
    seen.add(text)
    out.push(classifyNote(text))
  }
  return out
}
