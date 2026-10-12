/**
 * Hueco `components/scene-layers/*.vue` (D29): capas de la escena 3D. TzScene las monta dentro de TresCanvas, en el
 * grupo de la pista (el que escala la altura), después de pista, banderas y coches, en orden de `renderOrder`.
 *
 * Contrato de cada fichero:
 * - `<script lang="ts">export const renderOrder = 4</script>`: el mismo que pone a sus mallas. Orden de pintado:
 *   cielo −10 · cinta 0 · calor 0,5 · DRS 0,7 · banderas 1 · meta 3 · estelas 4 · coches 10/11 · fantasma 12.
 * - Props: `model`, `flat` y `yScale` (`SceneLayerProps`). Lo demás, del runtime (`getRuntime()`, `rt.ext`).
 * - Prepara sus mallas con `useSceneFrame` (composables/useSceneFrame.ts), nunca con `useLoop` de TresJS: así solo
 *   calcula y sube a la GPU justo antes de cada render, nada en pausa ni con la escena tapada (lo comprueba
 *   `app/composables/useSceneFrame.test.ts`). Lo que cambie lo que pinta pide el frame (`rt.requestFrame()`).
 * - Objetos y arrays de la plantilla, estables (constantes o `computed`), nunca literales: TresCanvas vuelve a evaluar
 *   su slot y un literal nuevo provoca renders en pausa.
 * - Publica su coste con `registerSceneStat(nombre, () => ({ drawCalls, triangles, … }))` (replay/debug.ts):
 *   así cuenta en `sceneStats.layers` y en el tope de draw calls de los e2e.
 */
import type { CircuitModel } from '~/engine/track/circuit'
import { collectSlot, type SlotModule } from './collect'

export interface SceneLayerProps {
  model: CircuitModel
  flat: boolean
  yScale: number
}

export const SCENE_LAYERS = collectSlot(
  import.meta.glob<SlotModule>('../components/scene-layers/*.vue', { eager: true }),
  'renderOrder',
)
