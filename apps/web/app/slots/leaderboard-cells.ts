/**
 * Hueco `components/leaderboard-cells/*.vue` (D29): columnas extra de la clasificación (sectores, mejor y última
 * vuelta, paradas…), detrás del neumático, dentro del botón de cada fila (nada interactivo dentro: sería un botón
 * dentro de otro).
 *
 * Contrato de cada fichero:
 *   <script lang="ts">
 *   export const order = 10
 *   export const width = '48px'                 // pista de la rejilla de la fila (CSS)
 *   export const presets = ['analysis']         // opcional: diseños en los que sale (por defecto, en todos)
 *   </script>
 * Props: `row` (`LeaderboardRow`) y `preset` (`LayoutPreset`). Una celda sin dato pinta «—» con su `title`, nunca un
 * valor inventado.
 */
import type { LeaderboardRow } from '~/engine/leaderboard/leaderboard'
import { collectSlot, type SlotEntry, type SlotModule } from './collect'

/** Diseños del replay (ítem 15): «Espectador» es el actual. */
export const LAYOUT_PRESETS = ['spectator', 'analysis'] as const
export type LayoutPreset = (typeof LAYOUT_PRESETS)[number]

export interface LeaderboardCellProps {
  row: LeaderboardRow
  preset: LayoutPreset
}

export interface LeaderboardCell extends SlotEntry {
  /** Pista de la rejilla (CSS), p. ej. `48px`. */
  readonly width: string
  readonly presets: readonly LayoutPreset[]
}

export function leaderboardCells(entries: readonly SlotEntry[]): readonly LeaderboardCell[] {
  return entries.map((e) => {
    const { width, presets = LAYOUT_PRESETS } = e.module as { width?: unknown; presets?: unknown }
    if (typeof width !== 'string' || !width.trim()) {
      throw new Error(`leaderboard-cells/${e.name}.vue: falta «export const width = '<ancho CSS>'»`)
    }
    if (!Array.isArray(presets) || !presets.every((p) => (LAYOUT_PRESETS as readonly unknown[]).includes(p))) {
      throw new Error(`leaderboard-cells/${e.name}.vue: «presets» solo admite ${LAYOUT_PRESETS.join(', ')}`)
    }
    return { ...e, width, presets: presets as LayoutPreset[] }
  })
}

/** Celdas que salen en un diseño, en orden. */
export function cellsFor(cells: readonly LeaderboardCell[], preset: LayoutPreset): readonly LeaderboardCell[] {
  return cells.filter((c) => c.presets.includes(preset))
}

export const LEADERBOARD_CELLS = leaderboardCells(
  collectSlot(import.meta.glob<SlotModule>('../components/leaderboard-cells/*.vue', { eager: true })),
)
