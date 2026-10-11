import type { SessionStatus, SessionType } from './manifest'

export interface CatalogSession {
  session: SessionType
  name: string
  status: SessionStatus
  /** Ruta del manifest relativa a /v1/ */
  path: string
  bytes?: number
  dev?: boolean
}

export interface CatalogEvent {
  round: number
  slug: string
  event: string
  country: string
  dateStart?: string
  sessions: CatalogSession[]
}

export interface Catalog {
  schema: 'trazada.catalog'
  schemaVersion: string
  generatedAt: string
  seasons: { season: number; events: CatalogEvent[] }[]
}

export function isCatalog(value: unknown): value is Catalog {
  const c = value as Partial<Catalog> | null
  return !!c && c.schema === 'trazada.catalog' && Array.isArray(c.seasons)
}
