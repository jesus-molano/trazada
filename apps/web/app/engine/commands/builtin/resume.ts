/**
 * Reanudar (ítem 14, con el ítem 13): «volver a donde lo dejé» lleva al instante que se retomó al abrir la sesión y
 * «desde el principio», al instante por defecto (el inicio o, en carrera, poco antes de la salida), como el botón del
 * aviso. Solo mueven el reloj: no borran lo guardado (el reanudar lo sigue guardando mientras se ve).
 */
import { clockAt, NEAR_MS } from '../context'
import { allTokens, findPhrase, penalize, phrases, unexplained, without } from '../match'
import { type CommandDef, t } from '../types'

const BACK = phrases(
  'volver a donde lo deje',
  'donde lo deje',
  'donde lo dejaste',
  'continuar donde lo deje',
  'retomar',
  'back to where i left off',
  'where i left off',
  'continue watching',
  'resume',
)
const RESTART = phrases(
  'empezar desde el principio',
  'desde el principio',
  'empezar de nuevo',
  'volver a empezar',
  'principio',
  'inicio',
  'reiniciar',
  'start over',
  'from the start',
  'from the beginning',
  'beginning',
  'restart',
)

const back: CommandDef = {
  id: 'resume.back',
  needs: ['playback', 'resume'],
  suggest(q, ctx) {
    const resumed = ctx.services.resume!.resumedMs
    let score: number | null = null
    if (q.empty) score = resumed !== null && Math.abs(ctx.state.timeMs - resumed) > NEAR_MS ? 0.5 : null
    else {
      const m = findPhrase(q.tokens, BACK)
      if (m) score = penalize(m.score, unexplained(q.tokens, without(allTokens(q.tokens), m.used)))
    }
    if (score === null) return []
    const base = { key: 'resume.back', group: 'goto', score, title: t('palette.cmd.resume.back') } as const
    if (resumed === null) return [{ ...base, disabled: t('palette.cmd.resume.nothing') }]
    return [
      {
        ...base,
        detail: t('palette.cmd.resume.backDetail', { clock: clockAt(ctx, resumed) }),
        seekTo: resumed,
        run: () => ctx.services.playback!.seek(resumed),
      },
    ]
  },
}

const restart: CommandDef = {
  id: 'resume.restart',
  needs: ['playback'],
  suggest(q, ctx) {
    if (q.empty) return []
    const m = findPhrase(q.tokens, RESTART)
    if (!m) return []
    const score = penalize(m.score, unexplained(q.tokens, without(allTokens(q.tokens), m.used)))
    const target = ctx.session.defaultMs
    const base = { key: 'resume.restart', group: 'goto', score, title: t('palette.cmd.resume.restart') } as const
    if (Math.abs(ctx.state.timeMs - target) <= NEAR_MS) return [{ ...base, disabled: t('palette.cmd.resume.atStart') }]
    const clock = clockAt(ctx, target)
    // En carrera, el instante por defecto es poco antes de la salida (el reloj visible, negativo).
    const detail = target < ctx.session.originMs
      ? t('palette.cmd.resume.restartRace', { clock })
      : t('palette.cmd.resume.restartDetail', { clock })
    return [{ ...base, detail, seekTo: target, run: () => ctx.services.playback!.seek(target) }]
  },
}

export const commands: readonly CommandDef[] = [back, restart]
