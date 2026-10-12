/**
 * Diseño del replay desde la paleta (ítem 15, con la paleta del ítem 14): «paneles detallados», «compactos», y los
 * nombres de antes de D50 («diseño análisis», «modo espectador», «spectator layout»), «cambiar de diseño» (al otro) y «restablecer anchos» (los del diseño actual, a su valor por
 * defecto). Solo cambian cómo se reparten los paneles, nunca un dato. Lo que ya está así sale deshabilitado con el
 * motivo; en tablet vertical no hay anchos que restablecer (los paneles van en la franja de abajo) y se dice.
 *
 * El servicio `layout` lo registra el cambio de diseño de la cabecera (replay-header/TzLayoutSwitch.vue), donde está
 * su estado; sin él, estos comandos no se ofrecen.
 */
import { LAYOUT_PRESETS, type LayoutPreset } from '../../layout/presets'
import { allTokens, findPhrase, type Phrase, penalize, phrases, unexplained, without } from '../match'
import type { Query } from '../parse'
import { type CommandContext, type CommandDef, type Suggestion, t, type Text } from '../types'

/** Diseño del replay (stores/layout.ts). */
export interface LayoutService {
  readonly preset: LayoutPreset
  /** Algún ancho del diseño actual lo puso el usuario con un asa. */
  readonly customized: boolean
  /** Hay anchos que cambiar (fuera de la tablet en vertical). */
  readonly resizable: boolean
  setPreset(preset: LayoutPreset): void
  resetWidths(): void
}

declare module '../types' {
  interface CommandServices {
    layout: LayoutService
  }
}

const PRESET_WORDS: Readonly<Record<LayoutPreset, readonly Phrase[]>> = {
  spectator: phrases(
    'paneles compactos',
    'compactos',
    'compacto',
    'compact panels',
    'compact',
    'diseño espectador',
    'modo espectador',
    'vista espectador',
    'espectador',
    'spectator layout',
    'spectator mode',
    'spectator',
  ),
  analysis: phrases(
    'paneles detallados',
    'detallados',
    'detallado',
    'detailed panels',
    'detailed',
    'diseño analisis', 'modo analisis', 'vista analisis', 'analisis', 'analysis layout', 'analysis mode', 'analysis'),
}
/** Sin decir cuál: al otro diseño. */
const TOGGLE = phrases('cambiar diseño', 'cambiar de diseño', 'otro diseño', 'diseño', 'switch layout', 'change layout', 'toggle layout', 'layout')
const RESET = phrases(
  'restablecer diseño',
  'restablecer anchos',
  'restablecer paneles',
  'anchos por defecto',
  'reset layout',
  'reset widths',
  'reset panels',
  'default widths',
)

const TITLE: Readonly<Record<LayoutPreset, Text>> = {
  spectator: t('layout.cmd.spectator.title'),
  analysis: t('layout.cmd.analysis.title'),
}
const DETAIL: Readonly<Record<LayoutPreset, Text>> = {
  spectator: t('layout.cmd.spectator.detail'),
  analysis: t('layout.cmd.analysis.detail'),
}
const RESET_DETAIL: Readonly<Record<LayoutPreset, Text>> = {
  spectator: t('layout.cmd.reset.detail.spectator'),
  analysis: t('layout.cmd.reset.detail.analysis'),
}

/** Puntuación de una frase con lo que sobra de la consulta penalizado; null si no encaja. */
function phraseScore(q: Query, list: readonly Phrase[]): number | null {
  const m = findPhrase(q.tokens, list)
  if (!m) return null
  return penalize(m.score, unexplained(q.tokens, without(allTokens(q.tokens), m.used)))
}

function presetSuggestion(ctx: CommandContext, preset: LayoutPreset, score: number): Suggestion {
  const layout = ctx.services.layout!
  const base = { key: `layout.preset.${preset}`, group: 'layout', score, title: TITLE[preset] } as const
  if (layout.preset === preset) return { ...base, disabled: t('layout.cmd.already') }
  return { ...base, detail: DETAIL[preset], run: () => layout.setPreset(preset) }
}

const preset: CommandDef = {
  id: 'layout.preset',
  needs: ['layout'],
  suggest(q, ctx) {
    if (q.empty) return []
    const out: Suggestion[] = []
    for (const p of LAYOUT_PRESETS) {
      const score = phraseScore(q, PRESET_WORDS[p])
      if (score !== null) out.push(presetSuggestion(ctx, p, score))
    }
    // «Cambiar de diseño» sin decir cuál: el otro, algo por debajo de uno nombrado.
    const toggle = phraseScore(q, TOGGLE)
    if (toggle !== null) {
      const other = LAYOUT_PRESETS.find((p) => p !== ctx.services.layout!.preset)!
      out.push(presetSuggestion(ctx, other, toggle * 0.95))
    }
    return out
  },
}

const reset: CommandDef = {
  id: 'layout.reset',
  needs: ['layout'],
  suggest(q, ctx) {
    if (q.empty) return []
    const score = phraseScore(q, RESET)
    if (score === null) return []
    const layout = ctx.services.layout!
    const base = { key: 'layout.reset', group: 'layout', score, title: t('layout.cmd.reset.title') } as const
    if (!layout.resizable) return [{ ...base, disabled: t('layout.cmd.reset.portrait') }]
    if (!layout.customized) return [{ ...base, disabled: t('layout.cmd.reset.none') }]
    return [{ ...base, detail: RESET_DETAIL[layout.preset], run: () => layout.resetWidths() }]
  },
}

export const commands: readonly CommandDef[] = [preset, reset]
