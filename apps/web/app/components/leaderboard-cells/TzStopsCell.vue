<script setup lang="ts">
/**
 * Entradas en el pit lane en la clasificación (diseño «Análisis», ítem 15): cuántas veces ha entrado el coche hasta el
 * instante del reloj, de los marcadores de boxes del timeline (`markers.pits`, entrada del pit lane según el
 * cronometraje). No distingue una parada de un paso sin parar (un drive-through) ni, en libres, de una vuelta al
 * garaje: el título lo dice. Un coche sin vueltas en la tabla no tiene «0»: «—», sin dato.
 */
import type { LeaderboardCellProps } from '~/slots/leaderboard-cells'
import { getRuntime, usePlaybackStore } from '~/stores/playback'

const props = defineProps<LeaderboardCellProps>()
const { t } = useI18n()
const playback = usePlaybackStore()
const entries = runtimePitEntries(getRuntime()!)

const count = computed(() => {
  const list = entries.get(props.row.car)
  return list ? countUpTo(list, playback.timeMs) : null
})
const title = computed(() => (count.value === null ? t('layout.cells.pits.none') : t('layout.cells.pits.title', { n: count.value })))
</script>

<script lang="ts">
/** Hueco `leaderboard-cells` (D29): la última columna extra, solo en el diseño «Análisis». */
export const order = 40
export const width = '22px'
export const presets = ['analysis']
export const label = 'layout.cells.pits.head'
</script>

<template>
  <span class="tz-lbcell" :class="{ 'is-none': count === null }" :title="title" data-testid="lb-pits" :data-count="count ?? ''">
    <span aria-hidden="true">{{ count ?? '—' }}</span>
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
