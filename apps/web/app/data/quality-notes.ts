/**
 * Avisos de calidad del manifest (`quality.notes`). El pipeline los escribe con un código estable y sus
 * parámetros (`{code, text, params}`, ver docs/DATA_FORMAT.md): aquí se traducen por código
 * (`sessionNotes.note.<código>`, y `<código>.<reason>` en los que llevan motivo). El `text` es español para el
 * log: solo se muestra, marcado como texto original, si el código no se conoce (datos de un pipeline más
 * nuevo), nunca se esconde un aviso.
 *
 * Los manifests anteriores guardan texto libre: esos se reconocen por patrón (`LEGACY_NOTES`, congelados: el
 * pipeline ya no escribe esos textos).
 */
import { QUALITY_NOTE_CODES, type QualityNote as ManifestNote, type QualityNoteCode } from '@trazada/schema'

export type { QualityNoteCode }

export type ShownNote =
  | { code: QualityNoteCode; key: string; params: Record<string, number | string> }
  | { code: null; text: string }

/** Códigos con variantes de texto según `params.reason`. */
const BY_REASON: Partial<Record<QualityNoteCode, readonly string[]>> = {
  'circuit-rebuilt': ['outdated', 'gains-corners', 'gains-pit'],
  'circuit-outdated-kept': ['no-corners', 'build-failed', 'would-lose'],
  'pitlane-missing': ['no-stops', 'none-valid', 'dropped'],
}

/** Parámetros tal y como se muestran (la cobertura, en %). */
const SHOW: Partial<Record<QualityNoteCode, (p: Record<string, number | string>) => Record<string, number | string>>> = {
  'position-coverage-low': (p) => ({ ...p, minPos: Math.round(Number(p.minPos) * 1000) / 10 }),
}

const isCode = (c: unknown): c is QualityNoteCode => (QUALITY_NOTE_CODES as readonly unknown[]).includes(c)

/** Clave i18n (bajo `sessionNotes.note`) de un aviso con código. */
export function noteKey(code: QualityNoteCode, params: Record<string, number | string>): string {
  const reasons = BY_REASON[code]
  if (!reasons) return code
  const reason = String(params.reason ?? '')
  return reasons.includes(reason) ? `${code}.${reason}` : `${code}.other`
}

function coded(code: QualityNoteCode, raw: Record<string, number | string> | undefined): ShownNote {
  const params = SHOW[code]?.(raw ?? {}) ?? { ...(raw ?? {}) }
  return { code, key: noteKey(code, params), params }
}

interface LegacyNote {
  code: QualityNoteCode
  pattern: RegExp
  /** Ejemplo real (tal y como lo escribía el pipeline) para los tests. */
  example: string
  params?: (m: RegExpMatchArray) => Record<string, number | string>
}

const num = (s: string | undefined): number => Number.parseFloat(s ?? '')

/** Avisos en texto libre de manifests anteriores a los códigos. */
export const LEGACY_NOTES = [
  {
    code: 'dev-source',
    pattern: /^Datos de desarrollo \(fuente secundaria TracingInsights\)/,
    example: 'Datos de desarrollo (fuente secundaria TracingInsights): no publicar.',
  },
  {
    code: 'merged-telemetry',
    pattern: /^Muestras de posición y telemetría reconstruidas/,
    example: 'Muestras de posición y telemetría reconstruidas desde telemetría fusionada por vuelta.',
  },
  {
    code: 'track-status-from-race-control',
    pattern: /^Estado de pista aproximado desde race control/,
    example: 'Estado de pista aproximado desde race control; sin torre de tiempos.',
  },
  {
    code: 'dev-corners',
    pattern: /^Curvas y rotación de MultiViewer leídas de una copia de TracingInsights/,
    example: 'Curvas y rotación de MultiViewer leídas de una copia de TracingInsights (desarrollo).',
  },
  {
    code: 'dev-circuit',
    pattern: /^El circuito (\S+) usa fuentes de desarrollo/,
    example:
      'El circuito suzuka-dev usa fuentes de desarrollo: la sesión queda marcada como dev (no publicable). Reconstrúyelo sin ellas con --rebuild-circuit.',
    params: (m) => ({ circuit: m[1] ?? '' }),
  },
  {
    code: 'centerline-not-closed',
    pattern: /^cierre de la línea central (\d+(?:\.\d+)?) m > 2 m/,
    example: 'cierre de la línea central 2.35 m > 2 m',
    params: (m) => ({ closureM: num(m[1]) }),
  },
  {
    code: 'length-vs-official',
    pattern: /^longitud (\d+(?:\.\d+)?) m vs oficial (\d+(?:\.\d+)?) m \(> 3 %\)/,
    example: 'longitud 7104 m vs oficial 7004 m (> 3 %)',
    params: (m) => ({ lengthM: num(m[1]), officialM: num(m[2]) }),
  },
  {
    code: 'no-corners',
    pattern: /^circuito sin curvas ni rotación oficial/,
    example: 'circuito sin curvas ni rotación oficial (MultiViewer no estaba accesible al construirlo)',
  },
] as const satisfies readonly LegacyNote[]

/** Reconoce un aviso en texto libre; si no lo conoce, lo devuelve tal cual (nunca se descarta). */
export function classifyLegacy(text: string): ShownNote {
  const trimmed = text.trim()
  for (const known of LEGACY_NOTES as readonly LegacyNote[]) {
    const m = trimmed.match(known.pattern)
    if (m) return coded(known.code, known.params?.(m))
  }
  return { code: null, text: trimmed }
}

/** Avisos del manifest (con código o en texto libre), sin vacíos ni repetidos, en su orden. */
export function qualityNotes(notes: readonly (string | ManifestNote)[] | undefined): ShownNote[] {
  const seen = new Set<string>()
  const out: ShownNote[] = []
  for (const raw of notes ?? []) {
    let shown: ShownNote | null = null
    if (typeof raw === 'string') {
      if (raw.trim()) shown = classifyLegacy(raw)
    } else if (raw && typeof raw === 'object') {
      if (isCode(raw.code)) shown = coded(raw.code, raw.params as Record<string, number | string> | undefined)
      else if (typeof raw.text === 'string' && raw.text.trim()) shown = { code: null, text: raw.text.trim() }
    }
    if (!shown) continue
    const id = shown.code === null ? `t:${shown.text}` : `c:${shown.key}:${JSON.stringify(shown.params)}`
    if (seen.has(id)) continue
    seen.add(id)
    out.push(shown)
  }
  return out
}
