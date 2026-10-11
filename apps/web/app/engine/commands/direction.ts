/**
 * Paleta de comandos (ítem 14): «siguiente» y «anterior», compartidos por los comandos que saltan hacia delante o hacia
 * atrás (marcadores y vueltas en `builtin/jumps.ts`, momentos en `builtin/moments.ts`). Fuera de `builtin/`, porque
 * ahí cada fichero es un módulo de comandos. TS puro.
 */
import { findPhrase, type PhraseMatch, phrases } from './match'
import type { Query } from './parse'

export const NEXT = phrases('siguiente', 'proximo', 'proxima', 'despues', 'next')
export const PREV = phrases('anterior', 'previo', 'previa', 'antes', 'ultimo', 'ultima', 'previous', 'prev', 'last')

export type Dir = 'next' | 'prev'

/** Dirección escrita entre los tokens libres (si la hay) y lo que consumió. */
export function findDir(q: Query, free: ReadonlySet<number>): { dir: Dir; m: PhraseMatch } | null {
  const n = findPhrase(q.tokens, NEXT, free)
  const p = findPhrase(q.tokens, PREV, free)
  if (n && (!p || n.score >= p.score)) return { dir: 'next', m: n }
  return p ? { dir: 'prev', m: p } : null
}
