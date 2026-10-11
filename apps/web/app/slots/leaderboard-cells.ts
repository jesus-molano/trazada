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
 *   export const label = 'layout.cells.best.head' // opcional: clave i18n del rótulo de la columna (diseño Análisis)
 *   </script>
 * Props: `row` (`LeaderboardRow`) y `preset` (`LayoutPreset`). Una celda sin dato pinta «—» con su `title`, nunca un
 * valor inventado.
 */
import type { LeaderboardRow } from '~/engine/leaderboard/leaderboard'
import { LAYOUT_PRESETS, type LayoutPreset } from '~/engine/layout/presets'
import { collectSlot, type SlotEntry, type SlotModule } from './collect'

/** Diseños del replay (ítem 15): «Espectador» es el de siempre (ver engine/layout/presets.ts). */
export { LAYOUT_PRESETS, type LayoutPreset }

export interface LeaderboardCellProps {
  row: LeaderboardRow
  preset: LayoutPreset
}

export interface LeaderboardCell extends SlotEntry {
  /** Pista de la rejilla (CSS), p. ej. `48px`. */
  readonly width: string
  readonly presets: readonly LayoutPreset[]
  /** Clave i18n del rótulo de la columna, o null (sin rótulo). */
  readonly label: string | null
}

export function leaderboardCells(entries: readonly SlotEntry[]): readonly LeaderboardCell[] {
  return entries.map((e) => {
    const { width, presets = LAYOUT_PRESETS, label = null } = e.module as { width?: unknown; presets?: unknown; label?: unknown }
    if (typeof width !== 'string' || !width.trim()) {
      throw new Error(`leaderboard-cells/${e.name}.vue: falta «export const width = '<ancho CSS>'»`)
    }
    if (!Array.isArray(presets) || !presets.every((p) => (LAYOUT_PRESETS as readonly unknown[]).includes(p))) {
      throw new Error(`leaderboard-cells/${e.name}.vue: «presets» solo admite ${LAYOUT_PRESETS.join(', ')}`)
    }
    if (label !== null && (typeof label !== 'string' || !label.trim())) {
      throw new Error(`leaderboard-cells/${e.name}.vue: «label» es una clave i18n (texto)`)
    }
    return { ...e, width, presets: presets as LayoutPreset[], label }
  })
}

/** Celdas que salen en un diseño, en orden. */
export function cellsFor(cells: readonly LeaderboardCell[], preset: LayoutPreset): readonly LeaderboardCell[] {
  return cells.filter((c) => c.presets.includes(preset))
}

/**
 * Lo que las columnas extra ensanchan la clasificación (px): sus anchos más un hueco de la rejilla por cada una (lo
 * mismo que `--lb-cells-w` en TzLeaderboard). Un ancho que no está en px no se puede sumar aquí y cuenta 0 (la
 * clasificación lo pinta igual; solo el reparto de anchos de los paneles no lo ve).
 */
export function cellsExtraPx(cells: readonly LeaderboardCell[], gapPx: number): number {
  return cells.reduce((sum, c) => {
    const m = /^\s*(\d+(?:\.\d+)?)px\s*$/.exec(c.width)
    return sum + (m ? Number(m[1]) : 0) + gapPx
  }, 0)
}

export const LEADERBOARD_CELLS = leaderboardCells(
  collectSlot(import.meta.glob<SlotModule>('../components/leaderboard-cells/*.vue', { eager: true })),
)
