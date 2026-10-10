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

export interface SessionEvents {
  schema: 'trazada.events'
  schemaVersion: string
  raceControl: RaceControlEvent[]
  sectorFlags: SectorFlag[]
  windows: SessionWindow[]
}
