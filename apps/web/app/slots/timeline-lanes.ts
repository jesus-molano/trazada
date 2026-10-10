/**
 * Hueco `components/timeline-lanes/*.vue` (D29): carriles extra del timeline (meteorología, adelantamientos…),
 * apilados bajo las marcas, dentro de la pista del timeline: un clic o un arrastre sobre ellos mueve el reloj como
 * en el resto del timeline. Cada carril pone su alto y sitúa lo suyo con `left: %` del intervalo de reproducción
 * (`getRuntime()!.clock`: `startMs`, `duration`). La pista es un `role="slider"`, cuyo contenido no ven los lectores de
 * pantalla: lo que un carril diga, que vaya también en un `title` o fuera del timeline.
 *
 * Contrato de cada fichero: `<script lang="ts">export const order = 10</script>`. Sin props.
 */
import { collectSlot, type SlotModule } from './collect'

export const TIMELINE_LANES = collectSlot(
  import.meta.glob<SlotModule>('../components/timeline-lanes/*.vue', { eager: true }),
)
