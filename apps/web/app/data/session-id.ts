import type { SessionType } from '@trazada/schema'

/** Identificador de sesión en la URL: `2026/10-spa-francorchamps/fp1` (= ruta bajo /v1/sessions/). */
export interface SessionId {
  season: number
  round: number
  slug: string
  type: SessionType
}

const SESSION_TYPES: readonly SessionType[] = ['fp1', 'fp2', 'fp3', 'sq', 'sprint', 'q', 'race']
const PATTERN = /^(\d{4})\/(\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)\/([a-z0-9]+)$/

/** Valida y descompone un identificador; null si no es válido (nunca se usa para construir rutas sin validar). */
export function parseSessionId(value: unknown): SessionId | null {
  if (typeof value !== 'string') return null
  const m = PATTERN.exec(value)
  if (!m) return null
  const type = m[4] as SessionType
  if (!SESSION_TYPES.includes(type)) return null
  return { season: Number(m[1]), round: Number(m[2]), slug: m[3]!, type }
}

export function formatSessionId(id: SessionId): string {
  return `${id.season}/${String(id.round).padStart(2, '0')}-${id.slug}/${id.type}`
}

/** `sessions/2026/10-spa-francorchamps/fp1/manifest.json` → `2026/10-spa-francorchamps/fp1`. */
export function sessionIdFromManifestPath(path: string): string | null {
  const m = /^sessions\/(.+)\/manifest\.json$/.exec(path)
  return m && parseSessionId(m[1]) ? m[1]! : null
}

export function manifestPath(id: string): string {
  return `sessions/${id}/manifest.json`
}
