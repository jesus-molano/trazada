import type { DecodedTrzb, Manifest, SessionEvents } from '@trazada/schema'
import type { DrsZones } from '../engine/drs/zones'

export type LoadErrorCode =
  | 'not-found' // la sesión no existe (404 del manifest o identificador inválido)
  | 'network' // fallo de red o HTTP distinto de 404
  | 'unsupported-version' // los datos exigen un lector más nuevo
  | 'invalid-manifest'
  | 'no-position' // sesión sin datos de posición: no reproducible
  | 'corrupt' // sha256 o gzip inválidos
  | 'decode' // TRZB o JSON inválidos

export type LoadStage = 'manifest' | 'download' | 'decode'

export interface LoadTimings {
  manifestMs: number
  downloadMs: number
  verifyMs: number
  decompressMs: number
  decodeMs: number
  tangentsMs: number
  /** Zonas de DRS deducidas de la telemetría (D38). */
  drsZonesMs: number
  totalMs: number
  bytes: number
}

/** Sesión lista para el motor. Todos los arrays son typed arrays transferidos desde el Web Worker. */
export interface LoadedSession {
  id: string
  manifest: Manifest
  motion: DecodedTrzb
  car: DecodedTrzb
  timing: DecodedTrzb
  circuit: DecodedTrzb
  events: SessionEvents
  /** Tangentes ds/dt (m/ms) de la Hermite, alineadas con las filas de motion.pos (Web Worker). */
  tangents: Float64Array
  /**
   * Zonas de DRS deducidas de la telemetría (D38, «Estimado»), calculadas en el Web Worker. Sin zonas (2026, sin
   * canal o sin aperturas suficientes), `status` dice por qué y `spans` va vacío.
   */
  drsZones: DrsZones
  timings: LoadTimings
}

export type WorkerRequest = {
  type: 'load'
  manifestUrl: string
  id: string
  readerVersion: string
}

export type WorkerResponse =
  | { type: 'progress'; stage: LoadStage; loaded: number; total: number }
  | { type: 'manifest'; manifest: Manifest }
  | { type: 'ready'; session: LoadedSession }
  | { type: 'error'; code: LoadErrorCode; message: string }

export class LoadError extends Error {
  override name = 'LoadError'
  constructor(
    readonly code: LoadErrorCode,
    message: string,
  ) {
    super(message)
  }
}
