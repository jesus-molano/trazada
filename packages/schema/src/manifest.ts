import { canRead, parseSemver } from './semver'

export type SessionType = 'fp1' | 'fp2' | 'fp3' | 'sq' | 'sprint' | 'q' | 'race'
export type SessionStatus = 'ok' | 'partial' | 'no-position'
export type Compression = 'gzip' | 'zstd' | 'none'

export interface FileRef {
  path: string
  bytes: number
  sha256: string
  layout: string
  compression: Compression
}

export interface DriverInfo {
  number: string
  tla: string
  first: string
  last: string
  team: string
  color: string
  finish?: { kind: 'classified' | 'retired' | 'unknown'; position?: number | null; lapsDown?: number | null } | null
}

/**
 * Códigos de `quality.notes` (el mismo `enum` que `manifest.schema.json`, lo comprueba un test). La UI
 * los traduce con sus `params`; el `text` de la nota es el texto en español del pipeline, para el log.
 */
export const QUALITY_NOTE_CODES = [
  'dev-source',
  'merged-telemetry',
  'track-status-from-race-control',
  'dev-corners',
  'dev-circuit',
  'position-coverage-low',
  'centerline-not-closed',
  'length-vs-official',
  'no-corners',
  'finish-line-fallback',
  'lights-out-unknown',
  'e2e-extract',
  'e2e-variant',
  'circuit-fit-unchecked',
  'circuit-variant-used',
  'circuit-layout-changed',
  'circuit-rebuilt',
  'circuit-outdated-kept',
  'position-glitches',
  'pitlane-missing',
  'radio-partial',
  'radio-skipped',
] as const
export type QualityNoteCode = (typeof QUALITY_NOTE_CODES)[number]

export interface QualityNote {
  code: QualityNoteCode
  /** Texto en español del pipeline (log); no es texto de interfaz. */
  text: string
  params?: Record<string, number | string>
}

export interface Manifest {
  schema: 'trazada.session'
  schemaVersion: string
  minReader: string
  generatedAt: string
  pipeline: { version: string; source: string; fastf1?: string; apiCoreVersion?: number }
  session: {
    season: number
    round: number
    slug: string
    event: string
    type: SessionType
    name: string
    circuit: string
    t0Utc: string
    gmtOffset: string
    playback: { startMs: number; endMs: number; lightsOutMs?: number | null }
    totalLaps?: number | null
    status: SessionStatus
  }
  drivers: DriverInfo[]
  channels: {
    drs: 'present' | 'absent'
    overtakeWindows?: 'raceControl' | 'none'
    elevation: 'real' | 'flat'
    timingStream?: 'present' | 'absent'
    marshalSectors?: 'present' | 'absent'
    /**
     * Desde 1.1.0: meteorología en `events.weather` (`present`) o la fuente no la trae (`absent`). Sin el campo, la
     * sesión se generó con un pipeline anterior: no se sabe si había meteorología (volver a descargarla).
     */
    weather?: 'present' | 'absent'
    /**
     * Desde 1.2.0: radio de los equipos en `events.radio`: todos los clips (`present`), alguno falló o se llegó al tope
     * (`partial`, con su nota) o ninguno (`absent`). Sin el campo, la sesión se generó antes: hay que volver a descargarla.
     */
    radio?: 'present' | 'absent' | 'partial'
  }
  quality: {
    coverage: Record<string, { pos: number; car: number }>
    centerlineClosureM?: number
    elevationRangeM?: number
    estimated: string[]
    /** Avisos de calidad: objetos con código (pipeline actual) o texto libre (manifests anteriores). */
    notes?: (string | QualityNote)[]
  }
  files: Record<'motion' | 'car' | 'timing' | 'events' | 'circuit', FileRef>
  attribution: string[]
}

export class ManifestError extends Error {
  override name = 'ManifestError'
  constructor(
    message: string,
    readonly code: 'invalid' | 'unsupported-version',
  ) {
    super(message)
  }
}

/**
 * Validación ligera en el cliente (la validación completa con JSON Schema la hace el pipeline).
 * Lanza `unsupported-version` si este lector no puede leer los datos.
 */
export function assertManifest(value: unknown, readerVersion: string): asserts value is Manifest {
  const m = value as Partial<Manifest> | null
  if (!m || typeof m !== 'object' || m.schema !== 'trazada.session') {
    throw new ManifestError('no es un manifest de sesión de Trazada', 'invalid')
  }
  try {
    parseSemver(m.schemaVersion ?? '')
    parseSemver(m.minReader ?? '')
  } catch {
    throw new ManifestError('versiones del manifest inválidas', 'invalid')
  }
  if (!canRead(readerVersion, m.minReader!)) {
    throw new ManifestError(
      `datos ${m.schemaVersion} (lector mínimo ${m.minReader}); este lector es ${readerVersion}`,
      'unsupported-version',
    )
  }
  const s = m.session
  if (!s || typeof s.season !== 'number' || !s.playback || !Array.isArray(m.drivers) || !m.files) {
    throw new ManifestError('manifest incompleto', 'invalid')
  }
  for (const key of ['motion', 'car', 'timing', 'events', 'circuit'] as const) {
    if (!m.files[key]?.path) throw new ManifestError(`manifest sin fichero ${key}`, 'invalid')
  }
}
