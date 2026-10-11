<script setup lang="ts">
/**
 * Mapa de calor (ítem 2, D32): «No / Velocidad / Minisectores» en el grupo «Capas» de las herramientas de escena, con
 * la vuelta que se pinta («Última / Mejor»), su leyenda y la explicación «ⓘ». Apagado por defecto; el modo se recuerda
 * por navegador (`stores/heat.ts`).
 *
 * - Velocidad: la escala de la vuelta en km/h, «muestreo ~4 Hz» y que sin color es «sin dato». Es dato real, sin
 *   etiqueta «Estimado», salvo cuando el manifest declara la telemetría reconstruida (`quality.estimated` con
 *   `telemetry`, fuentes dev): entonces lleva la etiqueta `telemetry` junto a la leyenda y en la fila de la escena, y
 *   la explicación lo dice.
 * - Minisectores: cuántos gana cada uno de los dos pilotos de la comparación (colores A y B de la comparación, con su
 *   sigla: no solo color), cuántos son «igual» (< 50 ms) y cuántos «sin dato», con la etiqueta «Estimado»
 *   (`minisectors`). Mientras se pintan, la etiqueta sale también en la fila de etiquetas de la escena
 *   (`stores/sceneEstimated.ts`), siempre a la vista: este menú va plegado.
 *
 * Lo que falta se dice: sin comparación, cómo hacerla; sin vuelta válida completa, de quién; sin posiciones, «sin dato».
 */
import { formatLapTime } from '~/engine/format/time'
import { HEAT_GAP_MS, HEAT_MINISECTORS, HEAT_TIE_MS, type HeatLapInfo, type HeatLapPick } from '~/engine/track/heat'
import { type HeatMode, useHeatStore } from '~/stores/heat'
import { getRuntime, usePlaybackStore } from '~/stores/playback'
import { useSceneEstimatedStore } from '~/stores/sceneEstimated'

const { t, locale } = useI18n()
const heat = useHeatStore()
const playback = usePlaybackStore()
const sceneEstimated = useSceneEstimatedStore()

// Pilotos de la sesión (fijos mientras vive la escena, que se monta de nuevo con cada sesión).
const drivers = getRuntime()?.drivers ?? []
/** ¿Declara el manifest la telemetría reconstruida? Entonces la velocidad que se pinta es una estimación. */
const telemetryEstimated = getRuntime()?.session.manifest.quality.estimated.includes('telemetry') ?? false
const driverName = (car: string | null) => (car === null ? '' : (drivers.find((d) => d.number === car)?.tla ?? car))

onMounted(() => heat.hydrate())

const modes = computed<{ mode: HeatMode; label: string }[]>(() => [
  { mode: 'off', label: t('heat.modes.off') },
  { mode: 'speed', label: t('heat.modes.speed') },
  { mode: 'minisectors', label: t('heat.modes.minisectors') },
])
const picks = computed<{ pick: HeatLapPick; label: string }[]>(() => [
  { pick: 'last', label: t('heat.picks.last') },
  { pick: 'best', label: t('heat.picks.best') },
])

const view = computed(() => heat.view)
const painting = computed(() => view.value?.status === 'ok')
const speedOn = computed(() => painting.value && view.value?.mode === 'speed')
const minisectorsOn = computed(() => painting.value && view.value?.mode === 'minisectors')
/** La vuelta solo se elige con un coche: sin él, la velocidad es la vuelta más rápida de la sesión. */
const showPick = computed(() => view.value !== null && (view.value.mode === 'minisectors' || playback.selectedCar !== null))

// Un dueño, una etiqueta: los dos modos nunca se pintan a la vez.
watch(
  [minisectorsOn, speedOn],
  ([ms, sp]) =>
    sceneEstimated.set('heat', ms ? { field: 'minisectors' } : sp && telemetryEstimated ? { field: 'telemetry' } : null),
  { immediate: true },
)
onBeforeUnmount(() => sceneEstimated.set('heat', null))

const lapText = (info: HeatLapInfo) =>
  t('heat.lap', { driver: driverName(info.car), lap: info.lap, time: formatLapTime(info.lapMs, locale.value) })

const range = computed(() => {
  const v = view.value
  return v ? { min: Math.floor(v.minKmh), max: Math.ceil(v.maxKmh) } : { min: 0, max: 0 }
})

/** Qué vueltas se pintan (con su sigla, número y tiempo oficial). */
const laps = computed(() => {
  const v = view.value
  if (!v || !v.a) return ''
  if (v.mode === 'speed') return v.sessionBest ? t('heat.sessionBest', { lap: lapText(v.a) }) : lapText(v.a)
  return v.b ? t('heat.pairLaps', { a: lapText(v.a), b: lapText(v.b) }) : ''
})

const note = computed(() => {
  const v = view.value
  if (!v || v.status === 'ok') return ''
  if (v.status === 'noPair') return t('heat.notePair')
  if (v.status === 'noLap') {
    if (v.sessionBest) return t('heat.noLapSession')
    return t('heat.noLap', { driver: driverName(v.missing === 'b' ? v.carB : v.carA) })
  }
  if (v.mode === 'minisectors' && v.a && v.b) return t('heat.noDataPair', { a: lapText(v.a), b: lapText(v.b) })
  return t('heat.noData', { driver: driverName(v.carA), lap: v.a?.lap ?? '' })
})

const hint = computed(() =>
  [
    t('heat.hint'),
    telemetryEstimated
      ? t('heat.hintSpeedEstimated', { gap: HEAT_GAP_MS / 1000 })
      : t('heat.hintSpeed', { gap: HEAT_GAP_MS / 1000 }),
    t('heat.hintMinisectors', { n: HEAT_MINISECTORS, tie: HEAT_TIE_MS }),
  ].join(' '),
)
</script>

<script lang="ts">
export const order = 15
export const group = 'layers'
</script>

<template>
  <span class="tz-heat" data-testid="heat-tool" :data-mode="heat.mode" :data-status="view?.status ?? 'off'">
    <span id="tz-heat-label" class="tz-heat__label">{{ t('heat.label') }}</span>
    <span class="tz-segmented" role="group" aria-labelledby="tz-heat-label">
      <button
        v-for="m in modes"
        :key="m.mode"
        type="button"
        :aria-pressed="heat.mode === m.mode"
        :data-testid="`heat-${m.mode}`"
        @click="heat.setMode(m.mode)"
      >
        {{ m.label }}
      </button>
    </span>
    <span v-if="showPick" class="tz-segmented" role="group" :aria-label="t('heat.pickLabel')">
      <button
        v-for="p in picks"
        :key="p.pick"
        type="button"
        :aria-pressed="heat.effectivePick === p.pick"
        :data-testid="`heat-pick-${p.pick}`"
        @click="heat.setPick(p.pick)"
      >
        {{ p.label }}
      </button>
    </span>
    <span
      v-if="speedOn"
      class="tz-chip tz-heat__legend"
      role="group"
      :aria-label="t('heat.legendLabel')"
      data-testid="heat-legend"
    >
      <span class="tz-heat__ramp" aria-hidden="true" />
      <span class="tz-num" data-testid="heat-range">{{ t('heat.speedRange', range) }}</span>
      <span>{{ t('heat.sampling') }}</span>
      <span class="tz-heat__swatch is-none" aria-hidden="true" />
      <span>{{ t('heat.noColor') }}</span>
    </span>
    <span
      v-if="minisectorsOn && view?.counts"
      class="tz-chip tz-heat__legend"
      role="group"
      :aria-label="t('heat.legendLabel')"
      data-testid="heat-legend"
    >
      <span class="tz-heat__swatch is-a" aria-hidden="true" />
      <span class="tz-num" data-testid="heat-count-a">{{ t('heat.winner', { driver: driverName(view.carA), n: view.counts.a }) }}</span>
      <span class="tz-heat__swatch is-b" aria-hidden="true" />
      <span class="tz-num" data-testid="heat-count-b">{{ t('heat.winner', { driver: driverName(view.carB), n: view.counts.b }) }}</span>
      <span class="tz-heat__swatch is-tie" aria-hidden="true" />
      <span class="tz-num" data-testid="heat-count-tie">{{ t('heat.tie', { ms: HEAT_TIE_MS, n: view.counts.tie }) }}</span>
      <span class="tz-heat__swatch is-none" aria-hidden="true" />
      <span class="tz-num" data-testid="heat-count-none">{{ t('heat.none', { n: view.counts.none }) }}</span>
    </span>
    <span v-if="painting && laps" class="tz-heat__note" data-testid="heat-laps">{{ laps }}</span>
    <TzEstimated v-if="minisectorsOn" field="minisectors" />
    <TzEstimated v-if="speedOn && telemetryEstimated" field="telemetry" />
    <span v-if="note" class="tz-heat__note" data-testid="heat-note">{{ note }}</span>
    <TzHint :label="t('heat.hintLabel')" :text="hint" testid="heat-hint" align="end" />
  </span>
</template>

<style scoped>
.tz-heat {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--tz-space-1);
  min-width: 0;
  max-width: 100%;
}

.tz-heat__label {
  font-size: var(--tz-text-xs);
  color: var(--tz-text-muted);
}

/* La leyenda, en su propia línea bajo los selectores (el menú tiene un ancho máximo). */
.tz-heat__legend {
  flex: 1 1 100%;
  flex-wrap: wrap;
}

/* Varias líneas antes que un menú muy ancho. */
.tz-heat__note {
  max-width: 34ch;
  font-size: var(--tz-text-xs);
  color: var(--tz-text-muted);
}

.tz-heat__ramp {
  width: var(--tz-space-8);
  height: var(--tz-space-2);
  border-radius: var(--tz-radius-pill);
  background: linear-gradient(
    to right,
    var(--tz-heat-0),
    var(--tz-heat-1),
    var(--tz-heat-2),
    var(--tz-heat-3),
    var(--tz-heat-4)
  );
}

.tz-heat__swatch {
  width: var(--tz-space-2);
  height: var(--tz-space-2);
  border-radius: var(--tz-radius-pill);
}

.tz-heat__swatch.is-a {
  background: var(--tz-compare-a);
}

.tz-heat__swatch.is-b {
  background: var(--tz-compare-b);
}

.tz-heat__swatch.is-tie {
  background: var(--tz-heat-tie);
}

/* Sin color: se ve la pista de debajo. */
.tz-heat__swatch.is-none {
  border: 1px dashed var(--tz-track-edge);
  background: var(--tz-track-high);
}
</style>
