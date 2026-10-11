<script setup lang="ts">
/**
 * Estado de la pista en el instante del reloj, en texto: neutralización vigente, banderas por sector y ventana de
 * overtake/DRS (chips de `TzTrackStatusChips`, compartidos con la vista previa del timeline). Se actualiza solo
 * cuando cambia el estado (no en cada frame). En la cabecera, «Estimado» se pulsa para ver por qué y se acorta por
 * debajo de 1920 px (la cabecera cabe en una fila; ver pages/replay.vue).
 *
 * Microinteracciones (21b, D42): con reproducción a ≤ ×4, un chip que entra lo hace con un fundido y una escala corta, y
 * el de coche de seguridad o bandera roja lanza un pulso de su anillo dos veces (nunca en bucle); tras un seek, en
 * pausa o con reduced motion, al instante. El texto del chip no cambia nunca por la animación.
 */
import { LIST_MOTION_MAX_RATE, useReducedMotion } from '~/design/motion'
import type { TrackStateSnapshot } from '~/engine/trackstate/TrackState'
import { getRuntime, usePlaybackStore } from '~/stores/playback'

const { t } = useI18n()
const playback = usePlaybackStore()
const reduced = useReducedMotion()
/** Los chips que entran se animan solo con reproducción a ≤ ×4 (como las listas, D42). */
const live = computed(() => playback.playing && playback.rate <= LIST_MOTION_MAX_RATE && !reduced.value)
const rt = getRuntime()!
const state = shallowRef<TrackStateSnapshot>(rt.trackState.snapshot)
const placeable = rt.circuit.marshalSectors.length > 0
/** Sin estado de pista oficial (se deduce de race control): se marca como Estimado. */
const inferred = rt.session.manifest.quality.estimated.includes('trackStatus')

let seen = -1
let off: (() => void) | null = null
onMounted(() => {
  off = rt.onFrame(() => {
    if (rt.trackState.version === seen) return
    seen = rt.trackState.version
    state.value = rt.trackState.snapshot
  })
})
onBeforeUnmount(() => off?.())
</script>

<template>
  <TzTrackStatusChips
    :state="state"
    :inferred="inferred"
    :placeable="placeable"
    interactive
    compact-estimated
    role="status"
    :class="{ 'is-live': live }"
    :aria-label="t('trackStatus.label')"
    data-testid="track-status"
  />
</template>

<style scoped>
/*
 * Un chip nuevo: fundido y escala de .96 a 1. Una animación de CSS solo corre al insertarse el elemento, y su duración
 * es 0 (la inicial) salvo con reproducción a ≤ ×4 (`is-live`; con reduced motion, el token vale 0): así un chip que
 * entra tras un seek o en pausa sale al instante, y al darle a reproducir los que ya estaban no se repiten.
 */
.tz-ts :deep(.tz-ts__chip) {
  animation-name: tz-chip-in;
  animation-timing-function: var(--tz-ease-enter);
}

.tz-ts.is-live :deep(.tz-ts__chip) {
  animation-duration: var(--tz-dur-base);
}

@keyframes tz-chip-in {
  from {
    opacity: 0;
    transform: scale(0.96);
  }
}

/* Coche de seguridad y bandera roja: el anillo del chip pulsa dos veces al entrar (nunca en bucle); invisible después. */
.tz-ts :deep(.tz-ts__chip.is-sc),
.tz-ts :deep(.tz-ts__chip.is-red) {
  position: relative;
}

.tz-ts :deep(.tz-ts__chip.is-sc)::after,
.tz-ts :deep(.tz-ts__chip.is-red)::after {
  content: '';
  position: absolute;
  inset: -3px;
  border: 2px solid var(--tz-sc);
  border-radius: var(--tz-radius-md);
  opacity: 0;
  pointer-events: none;
  animation-name: tz-pulse;
  animation-timing-function: var(--tz-ease-exit);
  animation-iteration-count: 2;
}

.tz-ts :deep(.tz-ts__chip.is-red)::after {
  border-color: var(--tz-flag-red);
}

.tz-ts.is-live :deep(.tz-ts__chip.is-sc)::after,
.tz-ts.is-live :deep(.tz-ts__chip.is-red)::after {
  animation-duration: var(--tz-dur-slow);
}
</style>
