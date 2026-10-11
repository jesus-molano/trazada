<script setup lang="ts">
/**
 * Última vuelta en la clasificación (diseño «Análisis», ítem 15): el tiempo oficial (`laps.lapMs`) de la última vuelta
 * completada del coche en el instante del reloj, con la misma regla que «Última vuelta» del panel del coche
 * (`LapTimes`). Sin tiempo oficial (−1) o sin vuelta completada, «—» con su título; anulada por dirección de carrera,
 * tachada y dicho en el título.
 *
 * La vuelta 1 de una carrera no trae tiempo oficial: solo con la opción «Estimar la vuelta 1» (la del panel del coche,
 * `settings.estimateLap1`) sale su estimación (de la salida al paso por meta), en el color de «Estimado», con el texto
 * «Estimado» en su título y para lectores de pantalla, y la clasificación pone su etiqueta `<TzEstimated field="lap1">`
 * mientras alguna fila la enseñe (dentro del botón de la fila no cabe un control).
 */
import { formatLapTime } from '~/engine/format/time'
import type { LapInfo } from '~/engine/timing/laps'
import type { LeaderboardCellProps } from '~/slots/leaderboard-cells'
import { getRuntime, usePlaybackStore } from '~/stores/playback'
import { useSettingsStore } from '~/stores/settings'

const props = defineProps<LeaderboardCellProps>()
const { t, locale } = useI18n()
const playback = usePlaybackStore()
const settings = useSettingsStore()
const laps = runtimeLapTimes(getRuntime()!)

/**
 * La última vuelta en el instante del reloj. `LapTimes.at` da un objeto nuevo en cada tick grueso (10 Hz): si la vuelta
 * que se enseña no cambió, se devuelve el anterior y el tiempo formateado y el título no se recalculan (cambian una vez
 * por vuelta). La vuelta en curso (`lap`) no se usa aquí.
 */
const info = computed<LapInfo>((prev) => {
  const next = laps.at(props.row.car, playback.timeMs, settings.estimateLap1)
  const same =
    prev !== undefined &&
    prev.lastLap === next.lastLap &&
    prev.lastLapMs === next.lastLapMs &&
    prev.estimated === next.estimated &&
    prev.deleted === next.deleted
  return same ? prev : next
})
const time = computed(() => (info.value.lastLapMs === null ? null : formatLapTime(info.value.lastLapMs, locale.value)))
const title = computed(() => {
  const { lastLap, estimated, deleted } = info.value
  if (lastLap === null) return t('layout.cells.last.none')
  if (time.value === null) return t('layout.cells.last.noTime', { lap: lastLap })
  if (estimated) return t('layout.cells.last.estimated', { time: time.value })
  return deleted ? t('layout.cells.last.deleted', { lap: lastLap, time: time.value }) : t('layout.cells.last.title', { lap: lastLap, time: time.value })
})

useCellEstimated(
  'lap1',
  () => props.row.car,
  () => info.value.estimated,
)
</script>

<script lang="ts">
/** Hueco `leaderboard-cells` (D29): detrás de la mejor vuelta, solo en el diseño «Análisis». */
export const order = 30
export const width = '54px'
export const presets = ['analysis']
export const label = 'layout.cells.last.head'
</script>

<template>
  <span
    class="tz-lbcell"
    :class="{ 'is-none': time === null, 'is-deleted': info.deleted && !info.estimated, 'is-estimated': info.estimated }"
    :title="title"
    data-testid="lb-last"
    :data-lap="info.lastLap ?? ''"
    :data-estimated="info.estimated || undefined"
  >
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

.tz-lbcell.is-deleted {
  color: var(--tz-text-muted);
  text-decoration: line-through;
}

/* Estimación (vuelta 1): el color de «Estimado» y su subrayado discontinuo; la etiqueta va en el pie de la clasificación. */
.tz-lbcell.is-estimated {
  color: var(--tz-estimated);
  text-decoration: underline dashed 1px;
  text-underline-offset: 0.2em;
}
</style>
