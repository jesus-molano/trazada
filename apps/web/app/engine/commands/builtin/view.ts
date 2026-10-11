/**
 * «Centrar» desde la paleta (D53): vuelve a la vista general por defecto del circuito («centrar», «centrar el mapa»,
 * «recentrar», «center», «recenter», «reset view»…; «vista general» es el comando de dejar de seguir a un coche). Desde
 * el seguimiento o la realización, también vuelve a la vista general. Con la vista ya en su sitio, deshabilitado y lo
 * dice.
 *
 * El servicio `view` lo registra la escena (components/TzScene.vue), donde están la cámara y sus controles.
 */
import { allTokens, findPhrase, penalize, phrases, unexplained, without } from '../match'
import { type CommandDef, t } from '../types'

/** Vista del mapa (stores/view.ts y la escena). */
export interface ViewService {
  /** La vista no es la general por defecto (movida a mano, siguiendo a un coche o con la realización). */
  readonly moved: boolean
  recenter(): void
}

declare module '../types' {
  interface CommandServices {
    /** Solo con la escena montada (con WebGL). */
    view?: ViewService
  }
}

const CENTER = phrases(
  'centrar',
  'centrar mapa',
  'centrar el mapa',
  'centrar vista',
  'centrar la vista',
  'recentrar',
  'encuadre',
  'center',
  'centre',
  'center map',
  'centre map',
  'center view',
  'recenter',
  'recentre',
  'reset view',
  'reset camera',
)

const center: CommandDef = {
  id: 'camera.center',
  needs: ['view'],
  suggest(q, ctx) {
    if (q.empty) return []
    const m = findPhrase(q.tokens, CENTER)
    if (!m) return []
    const view = ctx.services.view!
    const score = penalize(m.score, unexplained(q.tokens, without(allTokens(q.tokens), m.used)))
    const base = { key: 'camera.center', group: 'camera', score, title: t('view.cmd.title') } as const
    if (!view.moved) return [{ ...base, disabled: t('view.cmd.already') }]
    return [{ ...base, detail: t('view.cmd.detail'), run: () => view.recenter() }]
  },
}

export const commands: readonly CommandDef[] = [center]
