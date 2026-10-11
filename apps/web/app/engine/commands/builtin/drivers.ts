/**
 * Comandos de pilotos (ítem 14): seleccionar y seguir a un piloto por sigla, dorsal, apellido o nombre («seguir VER»,
 * «sigue a verstappen», «follow 1», «ver»), la vista general y quitar la selección. Un piloto que no está en la sesión
 * sale deshabilitado («ningún piloto «xyz» en esta sesión»): nunca se elige a otro por aproximación sin decirlo.
 */
import { carsInOrder, driverParams, tlaOf } from '../context'
import { allTokens, completion, type DriverRef, findDrivers, findPhrase, penalize, phrases, unexplained, without } from '../match'
import type { Query } from '../parse'
import { type CommandContext, type CommandDef, type Suggestion, t } from '../types'

const FOLLOW = phrases('seguir', 'sigue', 'seguimiento', 'follow', 'chase', 'onboard')
const SELECT = phrases('seleccionar', 'selecciona', 'elegir', 'elige', 'select', 'pick', 'choose')
const OVERVIEW = phrases(
  'vista general',
  'general',
  'dejar de seguir',
  'deja de seguir',
  'overview',
  'stop following',
  'unfollow',
)
const CLEAR = phrases('deseleccionar', 'quitar seleccion', 'quita la seleccion', 'ninguno', 'deselect', 'clear selection', 'unselect')

/** Pilotos que se listan tras «seguir» o «seleccionar» sin nombre (el resto, escribiendo). */
const LIST_MAX = 8

type Action = 'follow' | 'select'

function driverSuggestion(ctx: CommandContext, action: Action, car: string, score: number, complete?: string): Suggestion {
  const params = driverParams(ctx, car)
  const base = {
    key: `drivers.${action}.${car}`,
    group: 'drivers',
    score,
    car,
    complete,
    title: action === 'follow' ? t('palette.cmd.follow.title', params) : t('palette.cmd.select.title', params),
  } as const
  const pb = () => ctx.services.playback!
  if (action === 'follow') {
    if (ctx.state.following && ctx.state.selectedCar === car) return { ...base, disabled: t('palette.cmd.follow.already') }
    return {
      ...base,
      detail: t('palette.cmd.follow.detail', params),
      run: () => {
        pb().select(car)
        pb().follow(true)
      },
    }
  }
  if (ctx.state.selectedCar === car) return { ...base, disabled: t('palette.cmd.select.already') }
  return { ...base, detail: t('palette.cmd.select.detail', params), run: () => pb().select(car) }
}

/** Un nombre escrito que no es ningún piloto de la sesión. */
function unknownDriver(action: Action, text: string, score: number): Suggestion {
  return {
    key: `drivers.${action}.unknown`,
    group: 'drivers',
    score,
    title: action === 'follow' ? t('palette.cmd.follow.titleUnknown', { q: text }) : t('palette.cmd.select.titleUnknown', { q: text }),
    disabled: t('palette.cmd.driverUnknown', { q: text }),
  }
}

/** Sugerencias de una referencia a un piloto (uno o varios candidatos si es ambigua). */
function fromRef(q: Query, ctx: CommandContext, action: Action, ref: DriverRef, weight: (s: number) => number): Suggestion[] {
  const last = q.tokens.length - 1
  return ref.candidates.map((c) =>
    driverSuggestion(ctx, action, c.car, weight(c.score), completion(q.text, tlaOf(ctx, c.car), ref.used.includes(last))),
  )
}

/** «seguir …» / «seleccionar …» (con su palabra) o un piloto a secas. */
function driverCommand(id: string, action: Action, words: ReturnType<typeof phrases>, bareWeight: number): CommandDef {
  return {
    id,
    needs: ['playback'],
    suggest(q, ctx) {
      if (q.empty) {
        // Destacado: seguir al seleccionado (si no se le sigue ya) o, sin selección, al primero de la clasificación.
        if (action !== 'follow') return []
        const sel = ctx.state.selectedCar
        if (sel !== null) return ctx.state.following ? [] : [driverSuggestion(ctx, action, sel, 0.85)]
        const first = carsInOrder(ctx)[0]
        return first === undefined ? [] : [driverSuggestion(ctx, action, first, 0.7)]
      }
      const free = allTokens(q.tokens)
      const m = findPhrase(q.tokens, words)
      if (!m) {
        // Un piloto a secas («ver», «30», «carlos sainz»): seleccionarlo o seguirlo.
        const [ref] = findDrivers(q.tokens, ctx.session.drivers, free, 1)
        if (!ref || unexplained(q.tokens, without(free, ref.used)) > 0) return []
        return fromRef(q, ctx, action, ref, (s) => s * bareWeight)
      }
      const rest = without(free, m.used)
      const refs = findDrivers(q.tokens, ctx.session.drivers, rest, 1)
      if (refs.length) {
        const ref = refs[0]!
        const left = unexplained(q.tokens, without(rest, ref.used))
        return fromRef(q, ctx, action, ref, (s) => penalize((m.score + s) / 2, left))
      }
      if (unexplained(q.tokens, rest) > 0) {
        const text = [...rest].map((i) => q.tokens[i]!.text).join(' ')
        return [unknownDriver(action, text, m.score * 0.8)]
      }
      // Solo la palabra: el seleccionado primero y después los pilotos en el orden de la clasificación.
      const out: Suggestion[] = []
      const sel = ctx.state.selectedCar
      if (sel !== null) out.push(driverSuggestion(ctx, action, sel, m.score * 0.95, completion(q.text, tlaOf(ctx, sel), false)))
      carsInOrder(ctx)
        .filter((c) => c !== sel)
        .slice(0, LIST_MAX)
        .forEach((car, i) => out.push(driverSuggestion(ctx, action, car, m.score * 0.8 - i * 0.01, completion(q.text, tlaOf(ctx, car), false))))
      return out
    },
  }
}

const follow = driverCommand('drivers.follow', 'follow', FOLLOW, 0.86)
const select = driverCommand('drivers.select', 'select', SELECT, 0.9)

const overview: CommandDef = {
  id: 'drivers.overview',
  needs: ['playback'],
  suggest(q, ctx) {
    let score: number | null = null
    if (q.empty) score = ctx.state.following ? 0.86 : null
    else {
      const m = findPhrase(q.tokens, OVERVIEW)
      if (m) score = penalize(m.score, unexplained(q.tokens, without(allTokens(q.tokens), m.used)))
    }
    if (score === null) return []
    const base = { key: 'drivers.overview', group: 'drivers', score, title: t('palette.cmd.overview.title') } as const
    if (!ctx.state.following) return [{ ...base, disabled: t('palette.cmd.overview.already') }]
    return [{ ...base, detail: t('palette.cmd.overview.detail'), run: () => ctx.services.playback!.follow(false) }]
  },
}

const clear: CommandDef = {
  id: 'drivers.clear',
  needs: ['playback'],
  suggest(q, ctx) {
    if (q.empty) return []
    const m = findPhrase(q.tokens, CLEAR)
    if (!m) return []
    const score = penalize(m.score, unexplained(q.tokens, without(allTokens(q.tokens), m.used)))
    const base = { key: 'drivers.clear', group: 'drivers', score, title: t('palette.cmd.clear.title') } as const
    const sel = ctx.state.selectedCar
    if (sel === null) return [{ ...base, disabled: t('palette.cmd.clear.none') }]
    return [{ ...base, detail: t('palette.cmd.clear.detail', driverParams(ctx, sel)), run: () => ctx.services.playback!.select(null) }]
  },
}

export const commands: readonly CommandDef[] = [select, follow, overview, clear]
