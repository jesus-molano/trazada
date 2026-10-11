export interface RaceControlParsed {
  kind: string
  cars: string[]
  turn: number | null
  lap: number | null
  outcome?: string | null
  detail?: string | null
  s?: number | null
  marshalSector?: number | null
}

export interface RaceControlEvent {
  t: number
  lap: number | null
  category: string
  flag: string | null
  scope: string | null
  sector: number | null
  car: string | null
  /** Texto original del mensaje, sin modificar. */
  text: string
  parsed: RaceControlParsed
}

export interface SectorFlag {
  sector: number
  flag: 'YELLOW' | 'DOUBLE YELLOW' | 'RED'
  fromMs: number
  toMs: number | null
}

export type WindowKind = 'sc' | 'vsc' | 'vsc-ending' | 'red' | 'yellow' | 'overtake' | 'drs'

export interface SessionWindow {
  kind: WindowKind
  fromMs: number
  toMs: number | null
}

/**
 * Meteorología (desde 1.1.0, opcional): el stream WeatherData del live timing, una muestra por minuto de la
 * estación del circuito, en columnas del mismo largo. `null` = sin dato (clave ausente o ilegible en el feed), nunca
 * el 0 con el que rellena FastF1. Sin interpolar: cada valor vale desde su instante hasta la muestra siguiente.
 */
/**
 * Un clip de la radio de los equipos (desde 1.2.0). `t` es la hora de publicación en el feed (normalizada como dirección
 * de carrera): el mensaje pudo decirse unos segundos antes. `file`, relativo al manifest (`radio/<sha256[:16]>.mp3`).
 */
export interface RadioClip {
  t: number
  car: string
  file: string
  bytes: number
}

export interface SessionWeather {
  /** Instante de cada muestra (ms de sesión), creciente. */
  t: number[]
  /** Temperatura del aire (°C). */
  airC: (number | null)[]
  /** Temperatura de la pista (°C). */
  trackC: (number | null)[]
  /** Humedad relativa (%). */
  humidity: (number | null)[]
  /** Presión (hPa = mbar). */
  pressureHpa: (number | null)[]
  /** Lluvia sí/no (Rainfall): nunca intensidad ni mm. */
  rain: (boolean | null)[]
  /** Velocidad del viento (m/s). */
  windMs: (number | null)[]
  /** Dirección del viento (grados desde el norte, 0–359, como la da el feed). */
  windDeg: (number | null)[]
}

export interface SessionEvents {
  schema: 'trazada.events'
  schemaVersion: string
  raceControl: RaceControlEvent[]
  sectorFlags: SectorFlag[]
  windows: SessionWindow[]
  /** Desde 1.1.0; sin él, la sesión no trae meteorología (ver `manifest.channels.weather`). */
  weather?: SessionWeather
  /** Desde 1.2.0; sin él, la sesión no trae radio (ver `manifest.channels.radio`). */
  radio?: RadioClip[]
}
