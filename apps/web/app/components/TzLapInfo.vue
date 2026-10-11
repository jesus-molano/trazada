<script setup lang="ts">
/**
 * Vuelta en curso y última vuelta del coche seleccionado (tabla de vueltas, dato real). En carrera, la
 * vuelta 1 no trae tiempo oficial: el usuario puede pedir su estimación, que se marca como Estimado.
 *
 * Debajo, los sectores de su última vuelta completada con sus colores (ítem 4, D34; los mismos que en la
 * clasificación): tiempo oficial, color y forma de la marca, estado en el título y para lectores de pantalla, y una
 * pista que explica cómo los calcula Trazada. Nunca una «mejor vuelta posible» (sería una estimación).
 *
 * Jerarquía (D44): la vuelta en curso y la última vuelta, en cifras medianas (`.tz-num`, sin animar su valor).
 */
import { formatLapTime } from '~/engine/format/time'
import { LapTimes } from '~/engine/timing/laps'
import type { SectorCell } from '~/engine/timing/sectors'
import { getRuntime, usePlaybackStore } from '~/stores/playback'
import { useSettingsStore } from '~/stores/settings'

const props = defineProps<{ car: string }>()
const { t, locale } = useI18n()
const playback = usePlaybackStore()
const settings = useSettingsStore()
const rt = getRuntime()!
const s = rt.session.manifest.session
const laps = new LapTimes(rt.session.timing, s.type, s.playback.lightsOutMs ?? null, rt.session.events.raceControl)
const sectorTimes = useSectorTimes()
const sectorText = useSectorText()

const info = computed(() => laps.at(props.car, playback.timeMs, settings.estimateLap1))
const lastText = computed(() => (info.value.lastLapMs === null ? '—' : formatLapTime(info.value.lastLapMs, locale.value)))
/** La opción de estimar solo tiene sentido justo cuando la última vuelta es la 1 de una carrera. */
const offerLap1 = computed(() => laps.canEstimateLap1 && info.value.lastLap === 1)
/** Sectores de la última vuelta completada (paso por meta real), con su número de vuelta. */
const sectors = computed(() => sectorTimes.lastLap(props.car, playback.timeMs))
const NO_SECTOR: SectorCell = { ms: null, status: 'none' }
/** Sin vuelta completada, los tres «sin dato» (la fila no cambia de forma). */
const sectorCells = computed(() => sectors.value?.sectors ?? [NO_SECTOR, NO_SECTOR, NO_SECTOR])
const sectorsDeleted = computed(() => sectors.value?.deleted ?? false)
/**
 * Va justo debajo de «Última vuelta (N)», que es su vuelta; solo si no lo es (un registro residual sin paso por meta
 * real cuenta como última vuelta pero no como vuelta completada), el número de su vuelta.
 */
const sectorsLapTag = computed(() => (sectors.value && sectors.value.lap !== info.value.lastLap ? sectors.value.lap : null))
const sectorsTitle = computed(() => `${sectorText.lap(sectors.value)}\n${sectorText.basis()}`)
</script>

<template>
  <dl class="tz-lap" data-testid="lap-info">
    <div class="tz-lap__cell">
      <dt>{{ t('telemetry.lap') }}</dt>
      <dd><span class="tz-num tz-num--md" data-testid="lap-current">{{ info.lap ?? '—' }}</span></dd>
    </div>
    <div class="tz-lap__cell tz-lap__cell--wide">
      <dt>
        {{ t('telemetry.lastLap') }}<template v-if="info.lastLap"> ({{ info.lastLap }})</template>
      </dt>
      <dd>
        <span class="tz-num tz-num--md" :class="{ 'is-deleted': info.deleted }" data-testid="lap-last">{{ lastText }}</span>
        <span
          v-if="info.deleted"
          class="tz-lap__deleted"
          :title="t('telemetry.lapDeletedHint')"
          data-testid="lap-last-deleted"
        >{{ t('telemetry.lapDeleted') }}</span>
        <button
          v-if="offerLap1"
          type="button"
          class="tz-lap__toggle"
          :aria-pressed="settings.estimateLap1"
          :title="t('telemetry.estimateLap1Hint')"
          data-testid="toggle-lap1"
          @click="settings.setEstimateLap1(!settings.estimateLap1)"
        >
          {{ t('telemetry.estimateLap1') }}
        </button>
        <TzEstimated v-if="info.estimated" field="lap1" />
      </dd>
    </div>
    <!-- Sectores en una sola línea bajo la última vuelta (el panel de telemetría no pierde alto para sus gráficas). -->
    <div class="tz-lap__cell tz-lap__sectors" data-testid="lap-sectors" :data-lap="sectors?.lap">
      <dt class="tz-visually-hidden">
        {{ t('sectors.title') }}<template v-if="sectors"> ({{ sectors.lap }})</template>
      </dt>
      <dd :title="sectorsTitle">
        <span v-if="sectorsLapTag !== null" class="tz-lap__sname" aria-hidden="true">{{ t('sectors.lapTag', { lap: sectorsLapTag }) }}</span>
        <span
          v-for="(c, i) in sectorCells"
          :key="i"
          class="tz-lap__sector"
          :data-state="sectorMark(c, sectorsDeleted)"
          :data-sector="i + 1"
          data-testid="lap-sector"
        >
          <span class="tz-lap__mark" aria-hidden="true" />
          <span class="tz-lap__sname" aria-hidden="true">{{ t('sectors.short', { n: i + 1 }) }}</span>
          <span class="tz-tabular" :class="{ 'is-deleted': sectorsDeleted && c.ms !== null }" aria-hidden="true">{{
            sectorText.time(c.ms)
          }}</span>
          <span class="tz-visually-hidden">{{ sectorText.cell(i, c, sectorsDeleted) }}</span>
        </span>
        <!-- Si es la misma vuelta que «Última vuelta», su insignia ya está ahí: aquí, solo los tiempos tachados. -->
        <span
          v-if="sectorsDeleted && sectorsLapTag !== null"
          class="tz-lap__deleted"
          :title="t('telemetry.lapDeletedHint')"
          data-testid="lap-sectors-deleted"
        >{{ t('telemetry.lapDeleted') }}</span>
        <span v-if="!sectors" class="tz-visually-hidden" data-testid="lap-sectors-none">{{ sectorText.lap(null) }}</span>
        <TzHint class="tz-lap__hint" :label="t('sectors.hintLabel')" :text="t('sectors.hint')" testid="sectors-hint" align="end" />
      </dd>
    </div>
  </dl>
</template>

<style scoped>
.tz-lap {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--tz-space-3);
  margin: 0 0 var(--tz-space-2);
}

.tz-lap__cell dt {
  font-size: var(--tz-text-2xs);
  color: var(--tz-text-muted);
}

.tz-lap__cell dd {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--tz-space-2);
  margin: 2px 0 0;
  font-family: var(--tz-font-mono);
  font-size: var(--tz-text-sm);
}

/*
 * Sectores: una línea entera bajo la vuelta en curso y la última vuelta, pegada a ellas (sin todo el hueco de la
 * rejilla) y con la pista al final. Si no cabe (tiempos de más de un minuto, panel estrecho), pasa a dos líneas.
 */
.tz-lap__sectors {
  grid-column: 1 / -1;
  margin-top: calc(-1 * var(--tz-space-2));
}

.tz-lap__sectors dd {
  margin: 0;
}

/*
 * La pista no alarga la línea (su zona táctil sigue entera): el panel de telemetría no pierde alto. Su texto, con la
 * letra de la interfaz, no con la de las cifras de la línea.
 */
.tz-lap__hint {
  margin-block: -6px;
  margin-inline-start: auto;
  font-family: var(--tz-font-sans);
}

.tz-lap__sector {
  display: inline-flex;
  align-items: center;
  gap: var(--tz-space-1);
  white-space: nowrap;
}

.tz-lap__sname {
  font-family: var(--tz-font-sans);
  font-size: var(--tz-text-2xs);
  color: var(--tz-text-muted);
}

/* La marca de cada sector, como en la clasificación: color, alto según el estado y hueca sin dato o anulada. */
.tz-lap__mark {
  align-self: flex-end;
  width: 6px;
  height: 14px;
  margin-bottom: 2px;
  border-radius: 1px;
}

[data-state='best'] > .tz-lap__mark {
  background: var(--tz-timing-best);
}

[data-state='personal'] > .tz-lap__mark {
  height: 10px;
  background: var(--tz-timing-personal);
}

[data-state='normal'] > .tz-lap__mark {
  height: 6px;
  background: var(--tz-timing-normal);
}

[data-state='none'] > .tz-lap__mark {
  border: 1px solid var(--tz-timing-none);
}

[data-state='deleted'] > .tz-lap__mark {
  border: 1px dashed var(--tz-text-faint);
}

/* Tiempo anulado por dirección de carrera: tachado y con su insignia (no se oculta: es un dato real). */
.is-deleted {
  color: var(--tz-text-muted);
  text-decoration: line-through;
}

.tz-lap__deleted {
  padding: 0 var(--tz-space-1);
  border: 1px solid var(--tz-danger);
  border-radius: var(--tz-radius-sm);
  color: var(--tz-danger);
  font-family: var(--tz-font-sans);
  font-size: var(--tz-text-2xs);
}

.tz-lap__toggle {
  position: relative;
  padding: 0 var(--tz-space-2);
  border: 1px solid var(--tz-border-strong);
  border-radius: var(--tz-radius-sm);
  background: transparent;
  font-family: var(--tz-font-sans);
  font-size: var(--tz-text-2xs);
  cursor: pointer;
}

/* Zona táctil de --tz-hit-min con puntero grueso, sin mover el layout. */
.tz-lap__toggle::after {
  content: '';
  position: absolute;
  inset: min(0px, calc((100% - var(--tz-hit-min)) / 2)) 0;
}

/* Activado: placa maciza de pintura (D47). */
.tz-lap__toggle[aria-pressed='true'] {
  border-color: var(--tz-accent);
  background: var(--tz-accent);
  color: var(--tz-accent-on);
}
</style>
