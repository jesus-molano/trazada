/**
 * Comandos de reproducción (ítem 14): reproducir y pausar, la velocidad («x4», «4x», «velocidad 8»), ir a una hora del
 * reloj de la sesión («1:02:30», «minuto 45») y saltar adelante o atrás («+30», «-10s», «adelante 2 min»). La hora es
 * la del reloj del dock (desde la salida en carrera; desde el inicio de la sesión en el resto). Fuera de la sesión,
 * deshabilitado con el intervalo que sí hay.
 */
import { RATES, type Rate } from '../../clock/SessionClock'
import { formatClock } from '../../format/time'
import { clockAt, inSession } from '../context'
import { allTokens, findPhrase, penalize, phrases, unexplained, without } from '../match'
import type { Query, Token } from '../parse'
import { type CommandContext, type CommandDef, type Suggestion, t } from '../types'

const PLAY = phrases('reproducir', 'reproduce', 'arrancar', 'play', 'start playback')
const PAUSE = phrases('pausa', 'pausar', 'parar', 'para', 'detener', 'pause', 'stop')
const RATE_WORDS = phrases('velocidad', 'speed', 'rate')
const TIME_WORDS = phrases('hora', 'tiempo', 'reloj', 'time', 'clock')
const MINUTE = phrases('minuto', 'min', 'minute')
const FORWARD = phrases('adelante', 'avanzar', 'avanza', 'adelantar', 'forward', 'ahead', 'skip')
const BACK = phrases('atras', 'retroceder', 'retrocede', 'rebobinar', 'back', 'backward', 'rewind')
const SECONDS = phrases('s', 'seg', 'segs', 'segundo', 'segundos', 'sec', 'secs', 'second', 'seconds')
const MINUTES = phrases('m', 'min', 'mins', 'minuto', 'minutos', 'minute', 'minutes')

/** Pasos de las flechas (← →, y con Mayús) para «adelante» o «atrás» sin cantidad. */
const DEFAULT_STEPS_MS = [5_000, 30_000] as const

const rateText = (r: number) => `×${r}`
const ratesList = RATES.map(rateText).join(', ')

/** Una sola palabra clave y nada más sin explicar: su puntuación. */
function keywordOnly(q: Query, list: ReturnType<typeof phrases>): number | null {
  const m = findPhrase(q.tokens, list)
  if (!m) return null
  return penalize(m.score, unexplained(q.tokens, without(allTokens(q.tokens), m.used)))
}

const play: CommandDef = {
  id: 'playback.play',
  needs: ['playback'],
  suggest(q, ctx) {
    const score = q.empty ? (ctx.state.playing ? null : 0.9) : keywordOnly(q, PLAY)
    if (score === null) return []
    const base = { key: 'playback.play', group: 'playback', score, title: t('palette.cmd.play.title') } as const
    if (ctx.state.playing) return [{ ...base, disabled: t('palette.cmd.play.already') }]
    return [
      {
        ...base,
        detail: t('palette.cmd.play.detail', { rate: rateText(ctx.state.rate) }),
        run: () => ctx.services.playback!.play(),
      },
    ]
  },
}

const pause: CommandDef = {
  id: 'playback.pause',
  needs: ['playback'],
  suggest(q, ctx) {
    const score = q.empty ? (ctx.state.playing ? 0.9 : null) : keywordOnly(q, PAUSE)
    if (score === null) return []
    const base = { key: 'playback.pause', group: 'playback', score, title: t('palette.cmd.pause.title') } as const
    if (!ctx.state.playing) return [{ ...base, disabled: t('palette.cmd.pause.already') }]
    return [{ ...base, detail: t('palette.cmd.pause.detail'), run: () => ctx.services.playback!.pause() }]
  },
}

function rateSuggestion(ctx: CommandContext, rate: number, score: number): Suggestion {
  const base = {
    key: `playback.rate.${rate}`,
    group: 'playback',
    score,
    title: t('palette.cmd.rate.title', { rate: rateText(rate) }),
  } as const
  if (!(RATES as readonly number[]).includes(rate)) return { ...base, disabled: t('palette.cmd.rate.invalid', { rates: ratesList }) }
  if (rate === ctx.state.rate) return { ...base, disabled: t('palette.cmd.rate.already', { rate: rateText(rate) }) }
  return { ...base, detail: t('palette.cmd.rate.detail', { rate: rateText(rate) }), run: () => ctx.services.playback!.setRate(rate as Rate) }
}

const rate: CommandDef = {
  id: 'playback.rate',
  needs: ['playback'],
  suggest(q, ctx) {
    if (q.empty) return []
    const free = allTokens(q.tokens)
    const word = findPhrase(q.tokens, RATE_WORDS)
    const rest = word ? without(free, word.used) : free
    // «x4», «4x»; o, tras «velocidad», un número.
    const at = [...rest].find((i) => q.tokens[i]!.kind === 'rate' || (word && q.tokens[i]!.kind === 'number'))
    if (at === undefined) {
      if (!word || unexplained(q.tokens, rest) > 0) return []
      // «velocidad» sola: todas.
      return RATES.map((r, i) => rateSuggestion(ctx, r, word.score * 0.9 - i * 0.01))
    }
    const value = q.tokens[at]!.value!
    const left = unexplained(q.tokens, without(rest, [at]))
    const score = penalize(word ? (word.score + 1) / 2 : 0.95, left)
    return [rateSuggestion(ctx, value, score)]
  },
}

/** «1:02:30», «hora 1:02:30», «minuto 45»: el reloj visible pedido (ms) y lo que consumió; null si no es eso. */
function clockTarget(q: Query): { clockMs: number; score: number } | null {
  const free = allTokens(q.tokens)
  const word = findPhrase(q.tokens, TIME_WORDS)
  const rest = word ? without(free, word.used) : free
  const at = [...rest].find((i) => q.tokens[i]!.kind === 'time')
  if (at !== undefined) {
    const left = unexplained(q.tokens, without(rest, [at]))
    return { clockMs: q.tokens[at]!.value!, score: penalize(word ? (word.score + 1) / 2 : 0.96, left) }
  }
  const minute = findPhrase(q.tokens, MINUTE)
  if (!minute) return null
  const after = without(free, minute.used)
  const n = [...after].find((i) => q.tokens[i]!.kind === 'number')
  if (n === undefined) return null
  const left = unexplained(q.tokens, without(after, [n]))
  return { clockMs: q.tokens[n]!.value! * 60_000, score: penalize((minute.score + 1) / 2, left) }
}

const time: CommandDef = {
  id: 'playback.time',
  needs: ['playback'],
  suggest(q, ctx) {
    if (q.empty) return []
    const target = clockTarget(q)
    if (!target) return []
    const clock = formatClock(target.clockMs)
    const tAt = ctx.session.originMs + target.clockMs
    const base = { key: `goto.time.${target.clockMs}`, group: 'goto', score: target.score, title: t('palette.cmd.time.title', { clock }) } as const
    if (!inSession(ctx, tAt)) {
      return [
        {
          ...base,
          disabled: t('palette.cmd.time.outside', { from: clockAt(ctx, ctx.session.startMs), to: clockAt(ctx, ctx.session.endMs) }),
        },
      ]
    }
    return [{ ...base, detail: t('palette.cmd.time.detail', { clock }), seekTo: tAt, run: () => ctx.services.playback!.seek(tAt) }]
  },
}

/** «30 s», «2 min», «1:30». */
function amountText(ms: number): string {
  const s = Math.round(Math.abs(ms) / 1000)
  if (s < 60) return `${s} s`
  return s % 60 === 0 ? `${s / 60} min` : formatClock(s * 1000)
}

function relativeSuggestion(ctx: CommandContext, deltaMs: number, score: number): Suggestion {
  const forward = deltaMs > 0
  const amount = amountText(deltaMs)
  const now = ctx.state.timeMs
  const target = Math.min(ctx.session.endMs, Math.max(ctx.session.startMs, now + deltaMs))
  const base = {
    key: `goto.relative.${deltaMs}`,
    group: 'goto',
    score,
    title: forward ? t('palette.cmd.relative.forward', { amount }) : t('palette.cmd.relative.back', { amount }),
  } as const
  if (target === now || deltaMs === 0) {
    return { ...base, disabled: forward ? t('palette.cmd.relative.atEnd') : t('palette.cmd.relative.atStart') }
  }
  return {
    ...base,
    detail: t('palette.cmd.relative.detail', { clock: clockAt(ctx, target) }),
    seekTo: target,
    run: () => ctx.services.playback!.seek(target),
  }
}

const unitOf = (tk: Token | undefined): number | null => {
  if (!tk || tk.kind !== 'word') return null
  if (findPhrase([tk], MINUTES)?.score === 1) return 60_000
  if (findPhrase([tk], SECONDS)?.score === 1) return 1000
  return null
}

const relative: CommandDef = {
  id: 'playback.relative',
  needs: ['playback'],
  suggest(q, ctx) {
    if (q.empty) return []
    const free = allTokens(q.tokens)
    // «+30», «-10s», «+2m», «+1:30» (con «s» o «min» detrás, si va separado).
    const at = q.tokens.findIndex((tk) => tk.kind === 'relative')
    if (at >= 0) {
      let delta = q.tokens[at]!.value!
      const used = [at]
      const unit = unitOf(q.tokens[at + 1])
      if (unit !== null && /^[+-]\d+$/.test(q.tokens[at]!.text)) {
        delta = Math.sign(delta) * (Math.abs(delta) / 1000) * unit
        used.push(at + 1)
      }
      return [relativeSuggestion(ctx, delta, penalize(0.95, unexplained(q.tokens, without(free, used))))]
    }
    // «adelante 30», «atrás 2 min», «avanzar»: sin cantidad, los pasos de las flechas.
    const fwd = findPhrase(q.tokens, FORWARD)
    const back = findPhrase(q.tokens, BACK)
    const dir = fwd && (!back || fwd.score >= back.score) ? { m: fwd, sign: 1 } : back ? { m: back, sign: -1 } : null
    if (!dir) return []
    const rest = without(free, dir.m.used)
    const n = [...rest].find((i) => q.tokens[i]!.kind === 'number')
    if (n === undefined) {
      if (unexplained(q.tokens, rest) > 0) return []
      return DEFAULT_STEPS_MS.map((step, i) => relativeSuggestion(ctx, dir.sign * step, dir.m.score * 0.9 - i * 0.01))
    }
    const unit = unitOf(q.tokens[n + 1]) ?? 1000
    const used = unitOf(q.tokens[n + 1]) === null ? [n] : [n, n + 1]
    const delta = dir.sign * q.tokens[n]!.value! * unit
    return [relativeSuggestion(ctx, delta, penalize((dir.m.score + 1) / 2, unexplained(q.tokens, without(rest, used))))]
  },
}

export const commands: readonly CommandDef[] = [play, pause, rate, time, relative]
