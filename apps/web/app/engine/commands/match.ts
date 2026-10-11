/**
 * Paleta de comandos (ítem 14, D43): coincidencia difusa por reglas propias (sin fuse.js ni IA). Una palabra escrita
 * encaja con una conocida si es igual, si es su principio (la que se está escribiendo, o una abreviatura de 3 letras
 * o más) o si tiene una errata (una letra de más, de menos, cambiada o dos letras traspuestas; dos en palabras
 * largas). Todo sobre texto ya normalizado (`parse.ts`: sin tildes ni mayúsculas). TS puro.
 */
import type { DriverInfo } from '@trazada/schema'
import { isFiller, normalize, phraseWords, type Token } from './parse'

/** Por debajo de esto, una palabra no encaja. */
export const MIN_WORD_SCORE = 0.5

/** Distancia de edición con trasposiciones (Damerau-Levenshtein restringida), cortada en `max` + 1. */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  const rows = a.length + 1
  const cols = b.length + 1
  const d: number[][] = Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)))
  for (let i = 1; i < rows; i++) {
    let best = Infinity
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1)
      d[i]![j] = v
      best = Math.min(best, v)
    }
    if (best > max) return max + 1
  }
  return d[a.length]![b.length]!
}

/**
 * ¿Cuánto encaja la palabra escrita con la conocida? 1 igual; 0,55–0,95 si es su principio y está a medio escribir
 * (`open`: cuanto más completa, más); 0,5–0,8 si es una abreviatura de 3 letras o más ya cerrada; 0,7 con una errata
 * (palabras de 4 letras o más) y 0,6 con dos (7 o más). 0 si no encaja.
 */
export function matchWord(typed: string, known: string, open: boolean): number {
  if (!typed || !known) return 0
  if (typed === known) return 1
  if (known.startsWith(typed)) {
    const ratio = typed.length / known.length
    if (open) return 0.55 + 0.4 * ratio
    if (typed.length >= 3) return 0.5 + 0.3 * ratio
  }
  if (typed.length >= 4) {
    const max = typed.length >= 7 ? 2 : 1
    const d = editDistance(typed, known, max)
    if (d <= max) return d === 1 ? 0.7 : 0.6
    // Errata en lo que se está escribiendo: contra el principio de la palabra conocida.
    if (open && known.length > typed.length) {
      const dp = editDistance(typed, known.slice(0, typed.length), 1)
      if (dp <= 1) return 0.6
    }
  }
  return 0
}

/** Un alias: su texto normalizado en palabras, sin rellenos. */
export type Phrase = readonly string[]

/** Alias de un comando (español e inglés a la vez), ya en palabras. */
export function phrases(...list: readonly string[]): readonly Phrase[] {
  return list.map(phraseWords).filter((p) => p.length > 0)
}

export interface PhraseMatch {
  readonly score: number
  /** Índices (en `tokens`) de lo que consumió la frase. */
  readonly used: readonly number[]
}

/**
 * La mejor aparición de alguno de los alias entre los tokens libres (`free`, por defecto todos): palabra a palabra y
 * seguidas. Si la consulta se acaba a mitad de una frase de varias palabras («coche de seg», «vista»), cuenta, con
 * menos puntuación. null si ninguno encaja.
 */
export function findPhrase(tokens: readonly Token[], list: readonly Phrase[], free?: ReadonlySet<number>): PhraseMatch | null {
  let best: PhraseMatch | null = null
  const usable = (i: number) => (!free || free.has(i)) && tokens[i]!.kind === 'word' && !isFiller(tokens[i]!)
  for (const phrase of list) {
    for (let start = 0; start < tokens.length; start++) {
      if (!usable(start)) continue
      let total = 0
      const used: number[] = []
      let k = 0
      for (; k < phrase.length; k++) {
        const i = start + k
        if (i >= tokens.length || !usable(i)) break
        const tk = tokens[i]!
        const s = matchWord(tk.text, phrase[k]!, tk.open)
        if (s < MIN_WORD_SCORE) break
        total += s
        used.push(i)
      }
      if (k === 0) continue
      let score = total / k
      if (k < phrase.length) {
        // Frase incompleta: solo si la consulta se acaba ahí (se está escribiendo).
        if (start + k !== tokens.length) continue
        score *= 0.6 + 0.4 * (k / phrase.length)
      }
      if (!best || score > best.score || (score === best.score && used.length > best.used.length)) best = { score, used }
    }
  }
  return best
}

/** Lo que se sabe de un piloto para encontrarlo (del manifest), normalizado. */
interface DriverKeys {
  readonly car: string
  readonly tla: string
  readonly first: readonly string[]
  readonly last: readonly string[]
}

const keysCache = new WeakMap<readonly DriverInfo[], readonly DriverKeys[]>()

function driverKeys(drivers: readonly DriverInfo[]): readonly DriverKeys[] {
  let keys = keysCache.get(drivers)
  if (!keys) {
    keys = drivers.map((d) => ({
      car: d.number,
      tla: normalize(d.tla),
      first: phraseWords(d.first),
      last: phraseWords(d.last),
    }))
    keysCache.set(drivers, keys)
  }
  return keys
}

export interface DriverCandidate {
  readonly car: string
  readonly score: number
}

export interface DriverRef {
  /** Candidatos del más al menos probable (varios si es ambiguo: «sa» → Sainz y Sargeant). */
  readonly candidates: readonly DriverCandidate[]
  /** Índices (en `tokens`) que forman la referencia. */
  readonly used: readonly number[]
  /** El texto escrito (para decir «ningún piloto «xyz»»). */
  readonly text: string
}

/** Margen con el mejor para seguir siendo candidato (ambigüedad). */
const AMBIGUITY = 0.12

function scoreToken(tk: Token, k: DriverKeys): number {
  if (tk.kind === 'number') return String(tk.value) === k.car ? 1 : 0
  if (tk.kind !== 'word') return 0
  const text = tk.text
  if (text === k.tla) return 1
  let best = 0
  // Siglas: igual (arriba) o su principio mientras se escribe.
  if (tk.open && k.tla.startsWith(text)) best = 0.6 + 0.3 * (text.length / k.tla.length)
  for (const w of k.last) best = Math.max(best, matchWord(text, w, tk.open) * 0.97)
  for (const w of k.first) best = Math.max(best, matchWord(text, w, tk.open) * 0.88)
  return best
}

/** Candidatos de una referencia de uno o dos tokens (nombre y apellido seguidos). */
function candidatesAt(tokens: readonly Token[], i: number, keys: readonly DriverKeys[], two: boolean): DriverCandidate[] {
  const out: DriverCandidate[] = []
  for (const k of keys) {
    let s: number
    if (two) {
      const a = tokens[i]!
      const b = tokens[i + 1]!
      if (a.kind !== 'word' || b.kind !== 'word') return []
      const f = Math.max(0, ...k.first.map((w) => matchWord(a.text, w, a.open)))
      const l = Math.max(0, ...k.last.map((w) => matchWord(b.text, w, b.open)))
      s = f >= MIN_WORD_SCORE && l >= MIN_WORD_SCORE ? Math.min(1, (f + l) / 2 + 0.05) : 0
    } else {
      s = scoreToken(tokens[i]!, k)
    }
    if (s >= MIN_WORD_SCORE) out.push({ car: k.car, score: s })
  }
  out.sort((a, b) => b.score - a.score)
  const top = out[0]?.score ?? 0
  return out.filter((c) => c.score >= top - AMBIGUITY)
}

/**
 * Referencias a pilotos entre los tokens libres, de izquierda a derecha y como mucho `max`: por sigla, dorsal,
 * apellido, nombre o nombre y apellido seguidos, con erratas y prefijos. Un número solo es un dorsal si hay un coche
 * con él.
 */
export function findDrivers(
  tokens: readonly Token[],
  drivers: readonly DriverInfo[],
  free: ReadonlySet<number>,
  max = 2,
): DriverRef[] {
  const keys = driverKeys(drivers)
  const refs: DriverRef[] = []
  for (let i = 0; i < tokens.length && refs.length < max; i++) {
    if (!free.has(i)) continue
    const tk = tokens[i]!
    if (tk.kind !== 'word' && tk.kind !== 'number') continue
    if (isFiller(tk) && !tk.open) continue
    // Nombre y apellido seguidos («carlos sainz») antes que cada uno por su lado.
    if (free.has(i + 1) && i + 1 < tokens.length) {
      const pair = candidatesAt(tokens, i, keys, true)
      const single = candidatesAt(tokens, i, keys, false)
      if (pair.length && (pair[0]!.score >= (single[0]?.score ?? 0) || pair[0]!.car === single[0]?.car)) {
        refs.push({ candidates: pair, used: [i, i + 1], text: `${tk.text} ${tokens[i + 1]!.text}` })
        i++
        continue
      }
    }
    const single = candidatesAt(tokens, i, keys, false)
    if (single.length) refs.push({ candidates: single, used: [i], text: tk.text })
  }
  return refs
}

/** Conjunto con los índices de todos los tokens. */
export const allTokens = (tokens: readonly Token[]): Set<number> => new Set(tokens.map((_, i) => i))

/** Los índices libres sin los usados. */
export function without(free: ReadonlySet<number>, ...used: readonly (readonly number[])[]): Set<number> {
  const out = new Set(free)
  for (const list of used) for (const i of list) out.delete(i)
  return out
}

/**
 * Lo que queda sin explicar entre los libres: cuenta para bajar la puntuación (un relleno a medio escribir no cuenta:
 * puede ser el principio de algo que aún no se ha escrito).
 */
export function unexplained(tokens: readonly Token[], free: ReadonlySet<number>): number {
  let n = 0
  for (const i of free) if (!(tokens[i]!.open && isFiller(tokens[i]!))) n++
  return n
}

/** Puntuación final: cada token sin explicar la reduce a la mitad. */
export const penalize = (score: number, leftovers: number): number => score * 0.5 ** leftovers

/**
 * Lo que Tab pone en la consulta: lo escrito (normalizado) con la última palabra cambiada por `word` si esa palabra
 * era parte de la referencia (`replacesLast`), o con `word` añadida al final; con un espacio detrás para seguir.
 */
export function completion(text: string, word: string, replacesLast: boolean): string {
  const words = text ? text.split(' ') : []
  if (replacesLast && words.length) words[words.length - 1] = word
  else words.push(word)
  return `${words.join(' ')} `
}
