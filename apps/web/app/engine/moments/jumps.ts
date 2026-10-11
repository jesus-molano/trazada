/**
 * Momentos de interés y saltos entre ellos (ítem 5, D35): adelantamientos, inicio de duelos, neutralizaciones (SC, VSC
 * y bandera roja) y mensajes de dirección de carrera destacados, en una lista ordenada por tiempo. «Siguiente» y
 * «anterior» buscan desde el instante del reloj. TS puro, sin Vue ni three.
 *
 * - Cada salto aterriza `JUMP_LEAD_MS` antes del momento (para ver la acción), dentro de la reproducción. Lo que cae
 *   fuera de la reproducción no es un momento al que saltar.
 * - Adelantamiento: su instante aproximado (GPS); sin él, el inicio de esa vuelta del que adelanta.
 * - Duelo: el paso por meta del de delante en su primera vuelta a menos de 1 s.
 * - Dirección de carrera: solo los mensajes de `RC_MOMENT_KINDS`; los de una misma clase a menos de `RC_MERGE_MS` del
 *   anterior se juntan en uno (p. ej. varias dobles amarillas a la vez en sectores distintos).
 * - «Anterior» deja un margen (`JUMP_BACK_GRACE_MS`): justo después de saltar a un momento, va al de antes, no al mismo.
 */
import type { RaceControlEvent } from '@trazada/schema'
import type { Duel } from './duels'
import type { Overtake } from './overtakes'

export const MOMENT_KINDS = ['overtake', 'duel', 'neutralisation', 'raceControl'] as const
export type MomentKind = (typeof MOMENT_KINDS)[number]

/** Neutralizaciones que son momento: su inicio. */
export const NEUTRALISATION_KINDS = ['sc', 'vsc', 'red'] as const
export type NeutralisationKind = (typeof NEUTRALISATION_KINDS)[number]

/**
 * Mensajes de dirección de carrera que son momento: hitos de la sesión (luz verde, bandera a cuadros), dobles amarillas,
 * coches detenidos o trompos, incidentes, sanciones y banderas negras. Las neutralizaciones salen de sus ventanas, no
 * de aquí.
 */
export const RC_MOMENT_KINDS: ReadonlySet<string> = new Set([
  'green_light',
  'chequered_flag',
  'sector_double_yellow',
  'car_stopped',
  'spun',
  'incident',
  'penalty',
  'black_flag',
  'black_and_white_flag',
  'black_and_orange_flag',
])

/** Antelación de cada salto (ms). */
export const JUMP_LEAD_MS = 5000
/** Margen de «anterior» (ms). */
export const JUMP_BACK_GRACE_MS = 1500
/** Mensajes de la misma clase más juntos que esto, un solo momento (ms). */
export const RC_MERGE_MS = 30_000

export interface Moment {
  kind: MomentKind
  /** Instante del momento (ms de sesión). */
  t: number
  /** Adónde salta: `t − JUMP_LEAD_MS`, dentro de la reproducción. */
  seekMs: number
  /** Índice en su lista de origen (`overtakes`, `duels`, `neutralisations` o `raceControl` de la entrada). */
  index: number
}

export interface MomentsInput {
  overtakes: readonly Overtake[]
  duels: readonly Duel[]
  neutralisations: readonly { kind: string; fromMs: number }[]
  raceControl: readonly RaceControlEvent[]
  /** Intervalo de reproducción. */
  startMs: number
  endMs: number
}

/** Adónde salta un momento en t: `JUMP_LEAD_MS` antes, dentro de la reproducción. */
export function seekTarget(t: number, startMs: number, endMs: number): number {
  return Math.min(endMs, Math.max(startMs, t - JUMP_LEAD_MS))
}

/** Instante de un adelantamiento para saltar y marcarlo: el del GPS o, sin él, el inicio de la vuelta. */
export function overtakeTime(o: Overtake): number {
  return o.atMs ?? o.fromMs
}

export function buildMoments(input: MomentsInput): Moment[] {
  const { startMs, endMs } = input
  const out: Moment[] = []
  const add = (kind: MomentKind, t: number, index: number) => {
    if (!(t >= startMs && t <= endMs)) return
    out.push({ kind, t, seekMs: seekTarget(t, startMs, endMs), index })
  }
  input.overtakes.forEach((o, i) => add('overtake', overtakeTime(o), i))
  input.duels.forEach((d, i) => add('duel', d.startMs, i))
  input.neutralisations.forEach((w, i) => {
    if ((NEUTRALISATION_KINDS as readonly string[]).includes(w.kind)) add('neutralisation', w.fromMs, i)
  })
  const lastOfKind = new Map<string, number>()
  input.raceControl.forEach((e, i) => {
    const kind = e.parsed.kind
    if (!RC_MOMENT_KINDS.has(kind)) return
    const last = lastOfKind.get(kind)
    if (last !== undefined && e.t >= last && e.t - last < RC_MERGE_MS) return
    lastOfKind.set(kind, e.t)
    add('raceControl', e.t, i)
  })
  const rank = (k: MomentKind) => MOMENT_KINDS.indexOf(k)
  return out.sort((a, b) => a.t - b.t || rank(a.kind) - rank(b.kind) || a.index - b.index)
}

const allowed = (m: Moment, kinds?: ReadonlySet<MomentKind>) => !kinds || kinds.has(m.kind)

/** Siguiente momento (de esas clases, todas sin `kinds`) al que saltar desde `nowMs`, o null. */
export function nextMoment(moments: readonly Moment[], nowMs: number, kinds?: ReadonlySet<MomentKind>): Moment | null {
  let best: Moment | null = null
  for (const m of moments) {
    if (!allowed(m, kinds) || !(m.seekMs > nowMs)) continue
    if (!best || m.seekMs < best.seekMs) best = m
  }
  return best
}

/** Momento anterior (de esas clases) al que saltar desde `nowMs`, o null; con el margen de `JUMP_BACK_GRACE_MS`. */
export function prevMoment(moments: readonly Moment[], nowMs: number, kinds?: ReadonlySet<MomentKind>): Moment | null {
  let best: Moment | null = null
  for (const m of moments) {
    if (!allowed(m, kinds) || !(m.seekMs < nowMs - JUMP_BACK_GRACE_MS)) continue
    if (!best || m.seekMs >= best.seekMs) best = m
  }
  return best
}
