import { defineStore } from 'pinia'

export interface SceneEstimatedLabel {
  field: string
  params?: Record<string, string | number>
}

/**
 * Etiquetas «Estimado» de lo que pintan sobre el mapa las capas de otras funciones (D29): sus herramientas viven en
 * menús plegados («Capas»), pero lo estimado que se dibuja tiene que llevar su etiqueta a la vista mientras se ve.
 * Cada dueño (una herramienta o capa) declara aquí su campo mientras lo pinta y TzSceneTools lo muestra en su fila
 * de etiquetas, junto a las de altura y separación. Un campo que declaran dos dueños sale una vez.
 */
export const useSceneEstimatedStore = defineStore('sceneEstimated', () => {
  const byOwner = ref<Record<string, SceneEstimatedLabel>>({})

  /** El dueño `owner` pinta (o deja de pintar, con null) lo estimado de `label.field`. */
  function set(owner: string, label: SceneEstimatedLabel | null): void {
    const { [owner]: _previous, ...rest } = byOwner.value
    byOwner.value = label ? { ...rest, [owner]: label } : rest
  }

  /** Etiquetas a la vista, una por campo, en el orden en que se declararon. */
  const labels = computed<SceneEstimatedLabel[]>(() => {
    const seen = new Set<string>()
    return Object.values(byOwner.value).filter((l) => !seen.has(l.field) && seen.add(l.field))
  })

  return { labels, set }
})
