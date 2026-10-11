/**
 * Huecos de la página del replay (D29). Solo se montan con el runtime enganchado (`playback.attached`), una vez por
 * sesión (cambian de clave con la sesión), así que pueden usar `getRuntime()!` en su `setup`. Sin props.
 *
 * - `components/replay-header/*.vue`: botones y chips de la cabecera (Análisis, realización automática, ayuda,
 *   meteorología, diseño…), entre el estado de pista y las herramientas de la escena. La cabecera va en una fila y el
 *   título tiene prioridad (D44): un texto largo que pase a su forma corta por debajo de un ancho lleva además
 *   `data-fit-hide="N"` (y su forma corta, `data-fit-show="N"`) para acortarse antes que el título (pages/replay.vue).
 * - `components/replay-overlays/*.vue`: lo que va por encima del escenario (hojas, tarjetas, avisos, paleta). Se
 *   posicionan solos; Esc, con `registerEscape` (replay/keys.ts) y su prioridad de `ESC_PRIORITY`.
 *
 * Contrato de cada fichero: `<script lang="ts">export const order = 10</script>`.
 */
import { collectSlot, type SlotModule } from './collect'

export const REPLAY_HEADER = collectSlot(import.meta.glob<SlotModule>('../components/replay-header/*.vue', { eager: true }))

export const REPLAY_OVERLAYS = collectSlot(
  import.meta.glob<SlotModule>('../components/replay-overlays/*.vue', { eager: true }),
)
