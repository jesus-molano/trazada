/**
 * Paleta de comandos (ítem 14, D43): de lo escrito a una consulta con tokens. Reglas fijas, sin IA ni dependencias.
 * Acepta español e inglés a la vez, sin tildes ni mayúsculas: «Sigue a Pérez», «sigue a perez» y «SIGUE A PEREZ» son
 * lo mismo. TS puro (sin Vue ni DOM).
 *
 * Cada token sabe lo que parece: una palabra, un número («30», «#30»), una hora del reloj de la sesión («1:02:30»,
 * «2:30», «−0:30»), una velocidad («x4», «4x», «×4»), una vuelta («v30», «l30», «lap30»), un salto relativo («+30»,
 * «-10s», «+2m», «+1:30») o un relleno («a», «de», «the»…) que no cuenta. Los comandos (`builtin/*.ts`) deciden qué
 * hacer con ellos.
 */

export type TokenKind = 'word' | 'number' | 'time' | 'rate' | 'lap' | 'relative'

export interface Token {
  /** Normalizado (`normalize`). */
  readonly text: string
  readonly kind: TokenKind
  /**
   * number: el número; time: ms del reloj visible (con signo); rate: la velocidad; lap: la vuelta; relative: ms con
   * signo. null en las palabras.
   */
  readonly value: number | null
  /** La última palabra, aún a medio escribir (sin espacio detrás): vale como prefijo. */
  readonly open: boolean
}

export interface Query {
  readonly raw: string
  /** Normalizado entero, rellenos incluidos. */
  readonly text: string
  /** Sin rellenos, salvo uno a medio escribir al final (puede ser el principio de otra palabra: «al» → «Albon»). */
  readonly tokens: readonly Token[]
  /** No queda nada que buscar (vacía o solo rellenos): la paleta enseña las sugerencias destacadas. */
  readonly empty: boolean
}

/**
 * Palabras que no cambian el sentido y se quitan para comparar («sigue a VER», «vuelta 7 de VER», «go to lap 30»).
 * Los verbos de ir («ir», «ve», «go», «salta»…) también: todo lo que hace la paleta es ir a algún sitio.
 */
export const FILLERS: ReadonlySet<string> = new Set([
  // español
  'a', 'al', 'de', 'del', 'la', 'el', 'las', 'los', 'lo', 'le', 'en', 'y', 'e', 'con', 'por', 'un', 'una',
  'ir', 've', 'vete', 'salta', 'saltar', 'llevame', 'quiero',
  // inglés
  'the', 'to', 'of', 'and', 'with', 'on', 'at', 'for', 'go', 'goto', 'jump', 'please',
])

/**
 * Normaliza para comparar: sin tildes ni diéresis (NFD), minúsculas, «×» → «x», guiones y signo menos → «-», y sin
 * más signos que los que forman horas, saltos y números («:», «+», «-», «.»). Espacios simples.
 */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[×✕✖]/g, 'x')
    .replace(/[−–—]/g, '-')
    .replace(/[^\p{L}\p{N}:+\-.\s]+/gu, ' ')
    .replace(/\.(?!\d)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const CLOCK = /^(-)?(\d{1,2}):(\d{2})(?::(\d{2}))?$/
const RATE = /^(?:x(\d{1,2})|(\d{1,2})x)$/
const LAP = /^(?:v|l|lap|vuelta)(\d{1,3})$/
const RELATIVE = /^([+-])(\d{1,4})(s|seg|m|min)?$/
const RELATIVE_CLOCK = /^\+(\d{1,2}):(\d{2})$/
const NUMBER = /^\d{1,6}$/

/** «1:02:30» → 3 750 000; «2:30» → 150 000 (m:ss, como el reloj del dock por debajo de 1 h); null si no es una hora. */
export function parseClock(text: string): number | null {
  const m = CLOCK.exec(text)
  if (!m) return null
  const [, minus, a, b, c] = m
  const secondsOk = (s: string) => Number(s) < 60
  let ms: number
  if (c !== undefined) {
    if (!secondsOk(b!) || !secondsOk(c)) return null
    ms = (Number(a) * 3600 + Number(b) * 60 + Number(c)) * 1000
  } else {
    if (!secondsOk(b!)) return null
    ms = (Number(a) * 60 + Number(b)) * 1000
  }
  return minus ? -ms : ms
}

/** Un token normalizado: qué parece y su valor. */
export function classify(text: string, open: boolean): Token {
  const token = (kind: TokenKind, value: number | null): Token => ({ text, kind, value, open })
  const clock = parseClock(text)
  if (clock !== null) return token('time', clock)
  const rel = RELATIVE_CLOCK.exec(text)
  if (rel) return Number(rel[2]) < 60 ? token('relative', (Number(rel[1]) * 60 + Number(rel[2])) * 1000) : token('word', null)
  const r = RELATIVE.exec(text)
  if (r) {
    const unit = r[3] === 'm' || r[3] === 'min' ? 60_000 : 1000
    return token('relative', (r[1] === '-' ? -1 : 1) * Number(r[2]) * unit)
  }
  const rate = RATE.exec(text)
  if (rate) return token('rate', Number(rate[1] ?? rate[2]))
  const lap = LAP.exec(text)
  if (lap) return token('lap', Number(lap[1]))
  if (NUMBER.test(text)) return token('number', Number(text))
  return token('word', null)
}

/** Palabras de una frase conocida (alias), normalizadas y sin rellenos. */
export function phraseWords(phrase: string): string[] {
  return normalize(phrase)
    .split(' ')
    .filter((w) => w && !FILLERS.has(w))
}

/** De lo escrito a la consulta. */
export function parseQuery(raw: string): Query {
  const text = normalize(raw)
  const words = text ? text.split(' ') : []
  // Sin espacio detrás, la última palabra está a medio escribir.
  const openLast = raw.length > 0 && !/\s$/.test(raw)
  const tokens: Token[] = []
  words.forEach((w, i) => {
    const open = openLast && i === words.length - 1
    if (FILLERS.has(w) && !open) return
    tokens.push(classify(w, open))
  })
  return { raw, text, tokens, empty: tokens.length === 0 }
}

/** ¿Es un relleno? (para quien recorre los tokens y quiere saltarse uno a medio escribir). */
export const isFiller = (token: Token): boolean => FILLERS.has(token.text)
