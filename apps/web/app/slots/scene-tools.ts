/**
 * Hueco `components/scene-tools/*.vue` (D29): controles de la escena (estelas, calor, DRS, realización automática…).
 * TzSceneTools los agrupa en «Capas» y «Cámara», cada grupo con su etiqueta, y solo pinta los grupos que tienen algo.
 *
 * Contrato de cada fichero: `<script lang="ts">export const order = 10; export const group = 'layers'</script>`
 * (`group`: 'layers' | 'camera'). Sin props: lee y escribe sus stores. Lo que pinte sin ser dato real, con su
 * `<TzEstimated>`.
 */
import { collectSlot, type SlotEntry, type SlotModule } from './collect'

export const SCENE_TOOL_GROUPS = ['layers', 'camera'] as const
export type SceneToolGroup = (typeof SCENE_TOOL_GROUPS)[number]

export interface SceneToolGroupEntries {
  readonly group: SceneToolGroup
  readonly tools: readonly SlotEntry[]
}

/** Herramientas por grupo, en el orden fijo de los grupos; solo los grupos con alguna herramienta. */
export function groupSceneTools(tools: readonly SlotEntry[]): readonly SceneToolGroupEntries[] {
  for (const tool of tools) {
    if (!(SCENE_TOOL_GROUPS as readonly unknown[]).includes(tool.module.group)) {
      throw new Error(`scene-tools/${tool.name}.vue: «export const group» debe ser ${SCENE_TOOL_GROUPS.join(' o ')}`)
    }
  }
  return SCENE_TOOL_GROUPS.map((group) => ({ group, tools: tools.filter((t) => t.module.group === group) })).filter(
    (g) => g.tools.length > 0,
  )
}

export const SCENE_TOOLS = groupSceneTools(
  collectSlot(import.meta.glob<SlotModule>('../components/scene-tools/*.vue', { eager: true })),
)
