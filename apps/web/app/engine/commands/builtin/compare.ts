/**
 * Comparar dos pilotos desde la paleta (ítem 14, con la comparación del ítem 1): «comparar NOR y PIA», «NOR vs PIA»,
 * «comparar con PIA» (con el seleccionado) y cerrar la comparación. Selecciona a A y abre «Comparar» con B en el panel
 * del coche; la diferencia en vivo lleva allí su «Estimado» (D31). Sin dos pilotos distintos, deshabilitado y con lo
 * que falta.
 */
import { carsInOrder, driverParams, tlaOf } from '../context'
import { allTokens, completion, findDrivers, findPhrase, penalize, phrases, unexplained, without } from '../match'
import type { Query } from '../parse'
import { type CommandContext, type CommandDef, type Suggestion, t } from '../types'

const COMPARE = phrases('comparar', 'compara', 'compare', 'vs', 'versus', 'contra', 'frente')
const CLOSE = phrases(
  'cerrar comparacion',
  'cerrar la comparacion',
  'dejar de comparar',
  'deja de comparar',
  'close comparison',
  'stop comparing',
)

/** Rivales que se listan tras «comparar» sin nombre (el resto, escribiendo). */
const LIST_MAX = 6
/** Combinaciones como mucho con referencias ambiguas. */
const PAIRS_MAX = 4

function pairSuggestion(ctx: CommandContext, a: string, b: string, score: number, complete?: string): Suggestion {
  const pa = driverParams(ctx, a)
  const pb = driverParams(ctx, b)
  const base = {
    key: `compare.${a}.${b}`,
    group: 'compare',
    score,
    car: b,
    complete,
    title: t('palette.cmd.compare.title', { a: pa.driver, b: pb.driver }),
  } as const
  if (a === b) return { ...base, disabled: t('palette.cmd.compare.same') }
  if (ctx.services.compare!.comparing === b && ctx.state.selectedCar === a) {
    return { ...base, disabled: t('palette.cmd.compare.already') }
  }
  return {
    ...base,
    detail: t('palette.cmd.compare.detail', { a: pa.name, b: pb.name }),
    run: () => ctx.services.compare!.compare(a, b),
  }
}

const pair: CommandDef = {
  id: 'compare.pair',
  needs: ['playback', 'compare'],
  suggest(q: Query, ctx) {
    if (q.empty) return []
    const free = allTokens(q.tokens)
    const m = findPhrase(q.tokens, COMPARE)
    if (!m) return []
    const rest = without(free, m.used)
    const refs = findDrivers(q.tokens, ctx.session.drivers, rest, 2)
    const left = unexplained(q.tokens, without(rest, ...refs.map((r) => r.used)))
    const last = q.tokens.length - 1
    const sel = ctx.state.selectedCar
    if (refs.length === 2) {
      const ra = refs[0]!
      const rb = refs[1]!
      const out: Suggestion[] = []
      for (const a of ra.candidates) {
        for (const b of rb.candidates) {
          if (out.length >= PAIRS_MAX) break
          const score = penalize((m.score + a.score + b.score) / 3, left)
          out.push(pairSuggestion(ctx, a.car, b.car, score, completion(q.text, tlaOf(ctx, b.car), rb.used.includes(last))))
        }
      }
      return out
    }
    if (refs.length === 1) {
      const rb = refs[0]!
      return rb.candidates.map((b) => {
        const score = penalize((m.score + b.score) / 2, left)
        const complete = completion(q.text, tlaOf(ctx, b.car), rb.used.includes(last))
        if (sel !== null) return pairSuggestion(ctx, sel, b.car, score, complete)
        return {
          key: `compare.with.${b.car}`,
          group: 'compare',
          score,
          car: b.car,
          complete,
          title: t('palette.cmd.compare.withTitle', { b: tlaOf(ctx, b.car) }),
          disabled: t('palette.cmd.compare.needsA'),
        } satisfies Suggestion
      })
    }
    if (left > 0) {
      const text = [...rest].map((i) => q.tokens[i]!.text).join(' ')
      return [
        {
          key: 'compare.unknown',
          group: 'compare',
          score: m.score * 0.8,
          title: t('palette.cmd.compare.titleUnknown', { q: text }),
          disabled: t('palette.cmd.driverUnknown', { q: text }),
        },
      ]
    }
    // Solo «comparar»: con el seleccionado, los rivales en el orden de la clasificación; sin él, cómo se escribe.
    if (sel === null) {
      return [
        {
          key: 'compare.hint',
          group: 'compare',
          score: m.score * 0.8,
          title: t('palette.cmd.compare.hintTitle'),
          disabled: t('palette.cmd.compare.needsTwo'),
          complete: `${q.text} `,
        },
      ]
    }
    return carsInOrder(ctx)
      .filter((c) => c !== sel)
      .slice(0, LIST_MAX)
      .map((b, i) => pairSuggestion(ctx, sel, b, m.score * 0.8 - i * 0.01, completion(q.text, tlaOf(ctx, b), false)))
  },
}

const close: CommandDef = {
  id: 'compare.close',
  needs: ['compare'],
  suggest(q, ctx) {
    const comparing = ctx.services.compare!.comparing
    let score: number | null = null
    if (q.empty) score = comparing !== null ? 0.7 : null
    else {
      const m = findPhrase(q.tokens, CLOSE)
      if (m) score = penalize(m.score, unexplained(q.tokens, without(allTokens(q.tokens), m.used)))
    }
    if (score === null) return []
    const base = { key: 'compare.close', group: 'compare', score, title: t('palette.cmd.compare.close') } as const
    if (comparing === null) return [{ ...base, disabled: t('palette.cmd.compare.notOpen') }]
    return [{ ...base, detail: t('palette.cmd.compare.closeDetail'), run: () => ctx.services.compare!.close() }]
  },
}

export const commands: readonly CommandDef[] = [pair, close]
