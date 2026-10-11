/**
 * «Ver la guía» desde la paleta (ítem 18): abre la guía de primer uso entera, desde el primer paso («guía», «ayuda»,
 * «tutorial», «primeros pasos», «help», «guide»…, con «ver», «abrir» o «show» delante o sin nada). Con la paleta vacía
 * sale al final, en «Ayuda»: en táctil es la forma de volver a abrirla (la cabecera no tiene botón «?» ni hay tecla).
 * Ya abierta, deshabilitado y lo dice.
 */
import { allTokens, findPhrase, penalize, phrases, unexplained, without } from '../match'
import { type CommandDef, t } from '../types'

/** La guía de primer uso (la registra `replay-overlays/TzTips.vue`). */
export interface TipsService {
  /** ¿Está abierta? */
  readonly open: boolean
  /** La abre entera, desde el primer paso. */
  start(): void
}

declare module '../types' {
  interface CommandServices {
    /** Guía de primer uso (ítem 18). Opcional: solo existe con la guía montada. */
    tips?: TipsService
  }
}

const GUIDE = phrases(
  'guia',
  'guia de primer uso',
  'primer uso',
  'primeros pasos',
  'ayuda',
  'tutorial',
  'como funciona',
  'como se usa',
  'guide',
  'help',
  'tour',
  'tips',
  'getting started',
  'how it works',
  'onboarding',
)
/** Verbos que pueden ir delante («ver la guía», «show guide»); solos no bastan. */
const VERBS = phrases('ver', 'mostrar', 'muestra', 'abrir', 'abre', 'ensenar', 'ensename', 'show', 'open', 'see', 'view')

/** Con la paleta vacía, al final de todo (por encima del mínimo para salir). */
export const TIPS_FEATURED_SCORE = 0.32

const guide: CommandDef = {
  id: 'help.tips',
  needs: ['tips'],
  suggest(q, ctx) {
    const tips = ctx.services.tips!
    let score: number
    if (q.empty) {
      if (tips.open) return []
      score = TIPS_FEATURED_SCORE
    } else {
      const m = findPhrase(q.tokens, GUIDE)
      if (!m) return []
      let rest = without(allTokens(q.tokens), m.used)
      const verb = findPhrase(q.tokens, VERBS, rest)
      if (verb) rest = without(rest, verb.used)
      score = penalize(verb ? (2 * m.score + verb.score) / 3 : m.score, unexplained(q.tokens, rest))
    }
    const base = { key: 'help.tips', group: 'help', score, title: t('tips.cmd.title') } as const
    if (tips.open) return [{ ...base, disabled: t('tips.cmd.already') }]
    return [{ ...base, detail: t('tips.cmd.detail'), run: () => tips.start() }]
  },
}

export const commands: readonly CommandDef[] = [guide]
