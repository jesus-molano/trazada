/**
 * Hueco `components/replay-dock/*.vue` (D29): botones del dock de reproducción (saltos, resumen…), en la fila de los
 * controles, entre las velocidades y el reloj. Sin props (runtime con `getRuntime()!`: el dock solo existe con él).
 *
 * Contrato de cada fichero: `<script lang="ts">export const order = 10</script>`.
 */
import { collectSlot, type SlotModule } from './collect'

export const REPLAY_DOCK = collectSlot(import.meta.glob<SlotModule>('../components/replay-dock/*.vue', { eager: true }))
