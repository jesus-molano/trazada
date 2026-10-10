/**
 * Hueco `components/analysis-tabs/*.vue` (D29): pestañas de la hoja de análisis (ítem 3: race trace, ritmo y
 * neumáticos; ítem 5: momentos). La hoja (`replay-overlays/TzAnalysis.vue`) pinta una pestaña por fichero, en orden,
 * y solo monta la activa. Sin props: cada pestaña lee el estado de la hoja con `useAnalysis()` (corte de «Sin
 * spoilers», coches visibles…) y el runtime con `getRuntime()!`.
 *
 * Contrato de cada fichero, en su `<script lang="ts">`:
 *   export const order = 10
 *   export const tab = 'raceTrace'                                    // id estable (único)
 *   export const label = (t: (key: string) => string) => t('analysis.tabs.raceTrace')   // texto (i18n)
 *   export const raceOnly = true                                       // opcional: solo tiene datos en carrera y sprint
 * Con `raceOnly`, la pestaña sigue en su sitio en libres y clasificación (con su estado vacío explicado), pero la
 * hoja no la abre por defecto.
 */
import { collectSlot, type SlotEntry, type SlotModule } from './collect'

/** La `t` de vue-i18n que recibe `label`. */
export type TabT = (key: string) => string

export interface AnalysisTab {
  readonly entry: SlotEntry
  readonly tab: string
  readonly label: (t: TabT) => string
  readonly raceOnly: boolean
}

/** Valida el contrato de las pestañas (id único y texto) y las devuelve en orden. */
export function analysisTabs(entries: readonly SlotEntry[]): readonly AnalysisTab[] {
  const seen = new Set<string>()
  return Object.freeze(
    entries.map((entry): AnalysisTab => {
      const { tab, label, raceOnly } = entry.module
      if (typeof tab !== 'string' || !/^[a-zA-Z][\w-]*$/.test(tab)) {
        throw new Error(`analysis-tabs/${entry.name}.vue: falta «export const tab = '<id>'»`)
      }
      if (seen.has(tab)) throw new Error(`analysis-tabs/${entry.name}.vue: la pestaña «${tab}» está repetida`)
      seen.add(tab)
      if (typeof label !== 'function') {
        throw new Error(`analysis-tabs/${entry.name}.vue: falta «export const label = (t) => t('…')»`)
      }
      if (raceOnly !== undefined && typeof raceOnly !== 'boolean') {
        throw new Error(`analysis-tabs/${entry.name}.vue: «raceOnly» debe ser true o false`)
      }
      return { entry, tab, label: label as (t: TabT) => string, raceOnly: raceOnly === true }
    }),
  )
}

/** Pestaña que se abre por defecto: la primera con datos en este tipo de sesión (o la primera, si ninguna). */
export function defaultTab(tabs: readonly AnalysisTab[], race: boolean): string {
  return (tabs.find((t) => race || !t.raceOnly) ?? tabs[0])?.tab ?? ''
}

export const ANALYSIS_TABS = analysisTabs(
  collectSlot(import.meta.glob<SlotModule>('../components/analysis-tabs/*.vue', { eager: true })),
)
