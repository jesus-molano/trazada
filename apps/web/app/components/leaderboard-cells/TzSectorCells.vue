<script setup lang="ts">
/**
 * Colores de sector en la clasificación (ítem 4, D34): los tres sectores de la última vuelta completada del coche en
 * el instante del reloj, calculados por Trazada con los tiempos oficiales (`useSectorTimes`), no las banderas del
 * feed. Morado = mejor de la sesión al completarlo, verde = mejor personal, amarillo = sin mejora, gris = sin dato;
 * una vuelta ya anulada, sin color de mejora.
 *
 * El color nunca va solo: cada marca tiene además su forma (alto según el estado, hueca sin dato o anulada), y la
 * celda lleva el título con tiempos, estados y el aviso de cómo se calculan, y el mismo texto para lectores de
 * pantalla. Se actualiza con el estado grueso del reloj (`playback.timeMs`), nunca por frame.
 */
import type { LeaderboardCellProps } from '~/slots/leaderboard-cells'
import { usePlaybackStore } from '~/stores/playback'

const props = defineProps<LeaderboardCellProps>()
const playback = usePlaybackStore()
const sectors = useSectorTimes()
const text = useSectorText()

const lap = computed(() => sectors.lastLap(props.row.car, playback.timeMs))
/** Estado de cada marca (S1, S2, S3); sin vuelta completada, las tres «sin dato». */
const marks = computed(() => {
  const x = lap.value
  return [0, 1, 2].map((i) => (x ? sectorMark(x.sectors[i]!, x.deleted) : 'none'))
})
const label = computed(() => text.lap(lap.value))
const title = computed(() => `${label.value}\n${text.basis()}`)
</script>

<script lang="ts">
/** Hueco `leaderboard-cells` (D29): la primera columna extra, en todos los diseños. */
export const order = 10
/** Tres marcas de 6 px con 2 px entre ellas. */
export const width = '22px'
</script>

<template>
  <span class="tz-sectors" :title="title" :data-lap="lap?.lap" :data-deleted="lap?.deleted ?? false" data-testid="lb-sectors">
    <span
      v-for="(state, i) in marks"
      :key="i"
      class="tz-sectors__mark"
      :data-sector="i + 1"
      :data-state="state"
      aria-hidden="true"
    />
    <span class="tz-visually-hidden">{{ label }}</span>
  </span>
</template>

<style scoped>
.tz-sectors {
  display: inline-flex;
  align-items: flex-end;
  gap: 2px;
  height: 14px;
}

/* Alto según el estado (más alto, mejor) y hueca sin dato o anulada: la forma acompaña al color. */
.tz-sectors__mark {
  width: 6px;
  height: 14px;
  border-radius: 1px;
}

.tz-sectors__mark[data-state='best'] {
  background: var(--tz-timing-best);
}

.tz-sectors__mark[data-state='personal'] {
  height: 10px;
  background: var(--tz-timing-personal);
}

.tz-sectors__mark[data-state='normal'] {
  height: 6px;
  background: var(--tz-timing-normal);
}

.tz-sectors__mark[data-state='none'] {
  border: 1px solid var(--tz-timing-none);
}

.tz-sectors__mark[data-state='deleted'] {
  border: 1px dashed var(--tz-text-faint);
}
</style>
