/**
 * Registro de atajos de teclado y de Esc del replay (D29): cada función registra aquí sus teclas al montarse (y las
 * da de baja al desmontarse) sin tocar `useReplayShortcuts`, que consulta el registro. TS puro, sin Vue ni DOM más
 * allá del `KeyboardEvent` que recibe.
 */
import { RATES } from '../engine/clock/SessionClock'

/**
 * Prioridades fijas de Esc: cierra primero lo que está más «encima». Con varias cosas abiertas, cada Esc cierra una,
 * de mayor a menor prioridad.
 */
export const ESC_PRIORITY = {
  /** Tarjeta de fin de sesión (ítem 12). */
  summary: 100,
  /**
   * Paleta de comandos (ítem 14): por encima de todo lo que puede quedar debajo de ella. No se abre sobre otro diálogo
   * modal (la tarjeta de fin de sesión), así que nunca coincide con él.
   */
  palette: 95,
  /** Pistas de primer uso (ítem 18). */
  tips: 90,
  /** Hoja de análisis (ítem 3). */
  analysis: 80,
  /** Realización automática (ítem 9). */
  tv: 70,
  /** Comparación de dos pilotos (ítem 1). */
  compare: 60,
  /** Cámara de seguimiento. */
  follow: 50,
  /** Coche seleccionado. */
  selection: 40,
} as const

export interface EscapeHandler {
  /** ¿Hay algo que cerrar ahora? */
  active(): boolean
  /** Lo cierra. */
  run(): void
}

interface EscapeEntry {
  readonly priority: number
  readonly handler: EscapeHandler
  readonly seq: number
}

let seq = 0
const escapes: EscapeEntry[] = []

/** Registra un cierre con Esc. A igual prioridad, gana el último registrado. Devuelve la baja. */
export function registerEscape(priority: number, handler: EscapeHandler): () => void {
  const entry: EscapeEntry = { priority, handler, seq: seq++ }
  escapes.push(entry)
  escapes.sort((a, b) => b.priority - a.priority || b.seq - a.seq)
  return () => {
    const i = escapes.indexOf(entry)
    if (i >= 0) escapes.splice(i, 1)
  }
}

/** Esc: cierra solo lo más prioritario que esté activo. ¿Había algo? */
export function handleEscape(): boolean {
  for (const { handler } of escapes) {
    if (handler.active()) {
      handler.run()
      return true
    }
  }
  return false
}

/** Modificadores. `mod` es Ctrl o ⌘ (Ctrl+K en Windows y Linux, ⌘K en Mac); no se combina con `ctrl` ni `meta`. */
export type Mod = 'mod' | 'ctrl' | 'meta' | 'alt' | 'shift'

export interface ShortcutSpec {
  /** `KeyboardEvent.key`; una letra vale en mayúscula o minúscula. */
  key: string
  /** Modificadores exactos (sin ninguno, por defecto). */
  mods?: readonly Mod[]
}

export interface ShortcutOptions {
  /** También con el foco en un campo de texto o un control que usa el teclado (p. ej. Ctrl+K). */
  inEditable?: boolean
  /** Solo cuando devuelve true (si no, la tecla sigue su camino). */
  when?: () => boolean
}

interface ShortcutEntry {
  readonly key: string
  readonly mods: ReadonlySet<Mod>
  readonly run: (event: KeyboardEvent) => void
  readonly options: ShortcutOptions
}

/** Teclas sin modificadores que ya usan el replay (espacio, flechas, Esc, 1–5 para la velocidad) o el navegador (Tab, Enter). */
export const RESERVED_KEYS: ReadonlySet<string> = new Set([
  ' ',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Escape',
  'Tab',
  'Enter',
  ...RATES.map((_, i) => String(i + 1)),
])

const shortcuts: ShortcutEntry[] = []

const isLetter = (key: string) => key.length === 1 && key.toLowerCase() !== key.toUpperCase()
const sameKey = (a: string, b: string) => (a.length === 1 && b.length === 1 ? a.toLowerCase() === b.toLowerCase() : a === b)

/**
 * Registra un atajo. Las teclas que ya usa el replay sin modificadores (`RESERVED_KEYS`) no se pueden registrar
 * sin Ctrl/⌘/Alt: es un error de programación y salta al montar. Si dos funciones registran la misma combinación,
 * atiende la última. Devuelve la baja.
 */
export function registerShortcut(
  spec: ShortcutSpec,
  run: (event: KeyboardEvent) => void,
  options: ShortcutOptions = {},
): () => void {
  const mods = new Set(spec.mods ?? [])
  if (mods.has('mod') && (mods.has('ctrl') || mods.has('meta'))) {
    throw new Error(`atajo ${spec.key}: «mod» ya es Ctrl o ⌘; no se combina con «ctrl» ni «meta»`)
  }
  const plain = !mods.has('mod') && !mods.has('ctrl') && !mods.has('meta') && !mods.has('alt')
  if (plain && [...RESERVED_KEYS].some((k) => sameKey(k, spec.key))) {
    throw new Error(`atajo «${spec.key}»: la tecla ya la usa el replay; usa otra o un modificador`)
  }
  const entry: ShortcutEntry = { key: spec.key, mods, run, options }
  shortcuts.push(entry)
  return () => {
    const i = shortcuts.indexOf(entry)
    if (i >= 0) shortcuts.splice(i, 1)
  }
}

function matches(entry: ShortcutEntry, event: KeyboardEvent): boolean {
  if (!sameKey(entry.key, event.key)) return false
  const { mods } = entry
  if (mods.has('mod')) {
    if (!event.ctrlKey && !event.metaKey) return false
  } else if (event.ctrlKey !== mods.has('ctrl') || event.metaKey !== mods.has('meta')) {
    return false
  }
  if (event.altKey !== mods.has('alt')) return false
  // Mayúsculas: exactas con las letras («k» ≠ «Shift+K»); con símbolos como «?», el Shift lo pide la distribución
  // del teclado, así que solo cuenta si el atajo lo exige.
  if (mods.has('shift')) return event.shiftKey
  return !(isLetter(entry.key) && event.shiftKey)
}

/**
 * Atajo registrado para este evento (el último que encaje y esté activo), o null. `editable`: el foco está en un
 * control que usa el teclado por sí mismo (solo valen los atajos con `inEditable`).
 */
export function findShortcut(event: KeyboardEvent, editable: boolean): ((event: KeyboardEvent) => void) | null {
  for (let i = shortcuts.length - 1; i >= 0; i--) {
    const entry = shortcuts[i]!
    if (!matches(entry, event)) continue
    if (editable && !entry.options.inEditable) continue
    if (entry.options.when && !entry.options.when()) continue
    return entry.run
  }
  return null
}

/** Ejecuta el atajo registrado para el evento, si lo hay, y cancela la acción por defecto. ¿Lo había? */
export function runShortcut(event: KeyboardEvent, editable: boolean): boolean {
  const run = findShortcut(event, editable)
  if (!run) return false
  event.preventDefault()
  run(event)
  return true
}
