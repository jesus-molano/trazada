<script setup lang="ts">
/**
 * Mejor vuelta en la clasificación (diseño «Análisis», ítem 15): la mejor vuelta válida del coche hasta el instante del
 * reloj, la que ya calcula la clasificación (`bestLapMs`: tiempo oficial, sin las vueltas anuladas a esa hora; en
 * clasificación, la de la tanda en curso). La vuelta 1 de una carrera no trae tiempo oficial, así que nunca es «mejor
 * vuelta». Sin vuelta válida, «—» con su título; nunca un valor inventado.
 */
import { formatLapTime } from '~/engine/format/time'
import type { LeaderboardCellProps } from '~/slots/leaderboard-cells'
import { getRuntime } from '~/stores/playback'

const props = defineProps<LeaderboardCellProps>()
const { t, locale } = useI18n()
/** En clasificación (Q y SQ), la mejor vuelta es la de la tanda en curso. */
const quali = getRuntime()?.leaderboard.lapTable?.quali ?? false

const time = computed(() => (props.row.bestLapMs === null ? null : formatLapTime(props.row.bestLapMs, locale.value)))
const title = computed(() => {
  if (time.value === null) return t('layout.cells.best.none')
  return quali ? t('layout.cells.best.titleQuali', { time: time.value }) : t('layout.cells.best.title', { time: time.value })
})
</script>

<script lang="ts">
/** Hueco `leaderboard-cells` (D29): detrás de los sectores, solo en el diseño «Análisis». «1:31.234» en la monoespaciada. */
export const order = 20
export const width = '54px'
export const presets = ['analysis']
export const label = 'layout.cells.best.head'
</script>

<template>
  <span class="tz-lbcell" :class="{ 'is-none': time === null }" :title="title" data-testid="lb-best" :data-ms="row.bestLapMs ?? ''">
    <span aria-hidden="true">{{ time ?? '—' }}</span>
    <span class="tz-visually-hidden">{{ title }}</span>
  </span>
</template>

<style scoped>
.tz-lbcell {
  font-family: var(--tz-font-mono);
  font-size: var(--tz-text-2xs);
  text-align: end;
  white-space: nowrap;
}

.tz-lbcell.is-none {
  color: var(--tz-text-faint);
}
</style>
