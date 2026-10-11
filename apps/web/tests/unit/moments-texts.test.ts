/**
 * Momentos (ítem 5, D35): las cifras de los textos que explican qué es un adelantamiento, un duelo y un salto (también
 * los de los comandos de la paleta, ítem 14b) son las del motor. Si cambian allí, este test avisa (un texto que afirma
 * otra regla sería un dato falso).
 */
import { describe, expect, it } from 'vitest'
import { DUEL_MAX_GAP_MS, DUEL_MIN_LAPS } from '../../app/engine/moments/duels'
import { JUMP_LEAD_MS } from '../../app/engine/moments/jumps'
import { OVERTAKE_MAX_GAP_MS } from '../../app/engine/moments/overtakes'
import { loadMessages } from '../../i18n/messages'

type Tree = { [k: string]: string | Tree }
const moments = (lang: string) => (loadMessages(lang) as Tree).moments as Tree
const text = (tree: Tree, path: string) => path.split('.').reduce<Tree | string>((acc, k) => (acc as Tree)[k]!, tree) as string

describe('textos de los momentos: cifras del motor', () => {
  it.each(['es', 'en'])('%s', (lang) => {
    const m = moments(lang)
    expect(text(m, 'basis')).toContain(`${OVERTAKE_MAX_GAP_MS / 1000} s`)
    expect(text(m, 'duels.basis')).toContain(`${DUEL_MAX_GAP_MS / 1000} s`)
    expect(text(m, 'duels.basis')).toContain(`${DUEL_MIN_LAPS} `)
    expect(text(m, 'duels.title')).toContain(`${DUEL_MAX_GAP_MS / 1000} s`)
    expect(text(m, 'pick')).toContain(`${JUMP_LEAD_MS / 1000} s`)
    expect(text(m, 'jump.filterHint')).toContain(`${JUMP_LEAD_MS / 1000} s`)
    // Comandos de la paleta (ítem 14b).
    for (const key of ['cmd.duel.none', 'cmd.duel.noneCar', 'cmd.duel.nonePair']) {
      expect(text(m, key)).toContain(`${DUEL_MAX_GAP_MS / 1000} s`)
      expect(text(m, key)).toContain(`${DUEL_MIN_LAPS} `)
    }
    for (const key of ['cmd.duel.detail', 'cmd.duel.detailNoCompare']) expect(text(m, key)).toContain(`${DUEL_MAX_GAP_MS / 1000} s`)
  })
})
