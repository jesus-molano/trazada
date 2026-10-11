<script setup lang="ts">
/**
 * Estado de la pista en el instante del reloj, en texto: neutralización vigente, banderas por sector y ventana de
 * overtake/DRS (chips de `TzTrackStatusChips`, compartidos con la vista previa del timeline). Se actualiza solo
 * cuando cambia el estado (no en cada frame). En la cabecera, «Estimado» se pulsa para ver por qué y se acorta por
 * debajo de 1600 px (la cabecera cabe en una fila; ver pages/replay.vue).
 */
import type { TrackStateSnapshot } from '~/engine/trackstate/TrackState'
import { getRuntime } from '~/stores/playback'

const { t } = useI18n()
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
    :aria-label="t('trackStatus.label')"
    data-testid="track-status"
  />
</template>
