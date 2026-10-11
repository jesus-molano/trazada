<script setup lang="ts">
/**
 * Carril de la radio de los equipos en el timeline (D51; hueco `timeline-lanes`): una marca fina por clip publicado
 * hasta el instante del reloj (nunca uno del futuro), apilado bajo los que haya. Va dentro del slider del timeline,
 * que no leen los lectores de pantalla: el resumen va en el `title`. Solo cambia cuando entra un clip (estado grueso).
 */
import { clipsUpTo, radioClips, radioStatus } from '~/engine/radio/radio'
import { getRuntime, usePlaybackStore } from '~/stores/playback'

const { t } = useI18n()
const rt = getRuntime()!
const clock = rt.clock
const playback = usePlaybackStore()
const status = radioStatus(rt.session.manifest)
const clips = radioClips(rt.session.events)
const times = clips.map((c) => c.t)
const shown = (status === 'present' || status === 'partial') && clips.length > 0
const pct = (ms: number) => `${(((ms - clock.startMs) / clock.duration) * 100).toFixed(4)}%`
const marks = clips.map((c) => ({ left: pct(c.t) }))
const count = computed(() => clipsUpTo(times, playback.timeMs))
</script>

<script lang="ts">
/** Hueco `timeline-lanes` (D29): debajo de la meteorología. */
export const order = 30
</script>

<template>
  <div
    v-if="shown"
    class="tz-rlane"
    :title="t('radio.lane', { n: count }, count)"
    aria-hidden="true"
    data-testid="radio-lane"
    :data-count="count"
  >
    <span v-for="(m, i) in marks.slice(0, count)" :key="i" class="tz-rlane__mark" :style="m" data-marker="radio" />
  </div>
</template>

<style scoped>
/* Como la meteorología: 3 px que no suman alto al timeline (al pie de la fila de marcas). */
.tz-rlane {
  position: relative;
  height: 3px;
  margin-top: -3px;
  overflow: hidden;
}

.tz-rlane__mark {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  margin-left: -1px;
  background: var(--tz-radio);
}
</style>
