<script setup lang="ts">
/**
 * Tarjeta de la vista previa del timeline (ítem 16): qué pasaba en el instante bajo el puntero, el dedo o el cabezal
 * (con el foco del teclado). Vuelta y reloj, el primero («Líder» en carrera y sprint; «Mejor vuelta» en el resto, nunca
 * deducido de la posición en pista), el estado de pista (chips compartidos con la cabecera, con «Estimado» si es
 * deducido) y los marcadores cercanos. Presentacional: lo calcula el motor (`engine/timeline/preview.ts`). Se coloca
 * sobre el instante sin salirse de la pista por los lados; solo cambia su opacidad al aparecer.
 */
import type { PreviewAt, PreviewMarker } from '~/engine/timeline/preview'
import { formatClock, formatLapTime } from '~/engine/format/time'
import { getRuntime } from '~/stores/playback'

const props = defineProps<{
  at: PreviewAt
  /** Posición del instante en la pista del timeline (px desde su borde izquierdo) y ancho de la pista (px). */
  x: number
  width: number
  /** Se ve; si no, se desvanece con lo último que mostró (y queda fuera del árbol de accesibilidad). */
  visible: boolean
}>()

/** Marcadores que se listan como mucho (el resto, «+N más»). */
const MAX_MARKERS = 3

const { t, locale } = useI18n()
const rt = getRuntime()!
const drivers = new Map(rt.drivers.map((d) => [d.number, d]))
const placeable = rt.circuit.marshalSectors.length > 0

const time = computed(() => formatClock(props.at.clockMs))
const when = computed(() => {
  const { lap, totalLaps } = props.at
  if (lap === null) return time.value
  return totalLaps ? t('preview.lap', { lap, total: totalLaps, time: time.value }) : t('preview.lapNoTotal', { lap, time: time.value })
})
const roleLabel = computed(() => (props.at.role === 'leader' ? t('preview.leader') : t('preview.bestLap')))
const basisLabel = computed(() => {
  const basis = props.at.leader.basis
  if (basis === 'tower') return t('preview.basisTower')
  return basis === 'line' ? t('preview.basisLine') : t('preview.basisBestLap')
})
const leader = computed(() => {
  const car = props.at.leader.car
  if (car === null) return null
  const d = drivers.get(car)
  return { name: d?.tla ?? `#${car}`, color: d?.color ?? 'var(--tz-team-unknown)' }
})
const lapTime = computed(() => (props.at.leader.lapMs === null ? '' : formatLapTime(props.at.leader.lapMs, locale.value)))

const shown = computed(() => props.at.markers.slice(0, MAX_MARKERS))
const hidden = computed(() => Math.max(0, props.at.markers.length - MAX_MARKERS))
const origin = computed(() => props.at.t - props.at.clockMs)

function markerWhat(m: PreviewMarker): string {
  if (m.kind === 'pit') return t('preview.pit', { tla: drivers.get(m.car)?.tla ?? m.car })
  if (m.kind === 'window') return t('preview.windowStart', { what: t(`timeline.window.${m.window}`) })
  if (m.sector !== null && m.flag === 'sector_yellow') return t('trackStatus.sector.yellow', { n: m.sector })
  if (m.sector !== null && m.flag === 'sector_double_yellow') return t('trackStatus.sector.doubleYellow', { n: m.sector })
  return t(`timeline.flag.${m.flag}`)
}
const markerText = (m: PreviewMarker) => t('preview.markerAt', { what: markerWhat(m), time: formatClock(m.t - origin.value) })
const markerClass = (m: PreviewMarker) => (m.kind === 'flag' ? `is-${m.flag}` : m.kind === 'window' ? `is-${m.window}` : 'is-pit')

// Recolocación: centrada sobre el instante y dentro de la pista. Se escribe en el DOM tras pintar (mide su ancho).
const card = ref<HTMLElement | null>(null)
function place() {
  const el = card.value
  if (!el) return
  const w = el.offsetWidth
  const left = Math.min(Math.max(props.x - w / 2, 0), Math.max(0, props.width - w))
  el.style.transform = `translateX(${left.toFixed(1)}px)`
}
onMounted(place)
watch(() => [props.x, props.width, props.at] as const, place, { flush: 'post' })
</script>

<template>
  <div
    ref="card"
    class="tz-preview"
    :class="{ 'is-visible': visible }"
    role="tooltip"
    data-testid="timeline-preview"
    :data-visible="visible"
    :data-t="Math.round(at.t)"
    :data-role="at.role"
    :data-basis="at.leader.basis"
    :data-leader="at.leader.car ?? ''"
  >
    <p class="tz-preview__when tz-tabular" data-testid="preview-when">{{ when }}</p>
    <p class="tz-preview__leader" data-testid="preview-leader">
      <span class="tz-preview__label">{{ roleLabel }}</span>
      <template v-if="leader">
        <span class="tz-preview__team" :style="{ background: leader.color }" aria-hidden="true" />
        <span class="tz-preview__name" data-testid="preview-leader-name">{{ leader.name }}</span>
        <span v-if="lapTime" class="tz-preview__time tz-tabular" data-testid="preview-leader-time">{{ lapTime }}</span>
      </template>
      <span v-else class="tz-preview__nodata" data-testid="preview-leader-nodata">{{ t('preview.noData') }}</span>
      <span class="tz-preview__basis">· {{ basisLabel }}</span>
    </p>
    <TzTrackStatusChips
      class="tz-preview__track"
      :state="at.track"
      :inferred="at.trackInferred"
      :placeable="placeable"
      testid="preview"
      :empty-label="t('preview.clear')"
    />
    <ul v-if="shown.length" class="tz-preview__marks" data-testid="preview-markers">
      <li v-for="m in shown" :key="`${m.kind}-${m.t}-${markerWhat(m)}`" :class="markerClass(m)" data-testid="preview-marker" :data-kind="m.kind">
        {{ markerText(m) }}
      </li>
      <li v-if="hidden" class="tz-preview__more">{{ t('preview.more', { n: hidden }) }}</li>
    </ul>
  </div>
</template>

<style scoped>
.tz-preview {
  position: absolute;
  left: 0;
  bottom: calc(100% + var(--tz-space-2));
  z-index: var(--tz-z-header);
  display: grid;
  gap: var(--tz-space-1);
  width: max-content;
  max-width: min(320px, 100%);
  padding: var(--tz-space-2) var(--tz-space-3);
  border: 1px solid var(--tz-border-strong);
  border-radius: var(--tz-radius-md);
  background: var(--tz-surface-2);
  box-shadow: var(--tz-shadow-panel);
  font-size: var(--tz-text-xs);
  pointer-events: none;
}

/*
 * Solo cambia la opacidad (los tokens de movimiento ya son 0 con movimiento reducido). `visibility` se interpola como
 * discreta: se ve en cuanto empieza a aparecer y, al ocultarse, deja de verse (y sale del árbol de accesibilidad)
 * cuando acaba de desvanecerse.
 */
.tz-preview {
  opacity: 0;
  visibility: hidden;
  transition:
    opacity var(--tz-dur-fast) var(--tz-ease-standard),
    visibility var(--tz-dur-fast) var(--tz-ease-standard);
}

.tz-preview.is-visible {
  opacity: 1;
  visibility: visible;
}

.tz-preview p {
  margin: 0;
}

.tz-preview__when {
  font-family: var(--tz-font-mono);
  font-weight: var(--tz-weight-semibold);
  color: var(--tz-text);
}

.tz-preview__leader {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--tz-space-1) var(--tz-space-2);
}

.tz-preview__label {
  color: var(--tz-text-muted);
}

.tz-preview__team {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.tz-preview__name {
  font-weight: var(--tz-weight-semibold);
}

.tz-preview__time {
  font-family: var(--tz-font-mono);
}

.tz-preview__nodata,
.tz-preview__basis {
  color: var(--tz-text-muted);
}

.tz-preview__marks {
  display: grid;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
  color: var(--tz-text-muted);
}

.tz-preview__marks li {
  position: relative;
  padding-left: var(--tz-space-3);
}

.tz-preview__marks li::before {
  position: absolute;
  left: 0;
  top: 0.45em;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--tz-text-faint);
  content: '';
}

.tz-preview__marks li.is-sector_yellow::before {
  background: var(--tz-flag-yellow);
}

.tz-preview__marks li.is-sector_double_yellow::before {
  background: var(--tz-flag-double-yellow);
}

.tz-preview__marks li.is-red_flag::before,
.tz-preview__marks li.is-red::before {
  background: var(--tz-flag-red);
}

.tz-preview__marks li.is-chequered_flag::before {
  background: var(--tz-flag-chequered);
}

.tz-preview__marks li.is-sc::before,
.tz-preview__marks li.is-vsc::before,
.tz-preview__marks li.is-vsc-ending::before {
  background: var(--tz-sc);
}

.tz-preview__marks li.is-pit::before {
  background: var(--tz-pit);
}

.tz-preview__marks li.tz-preview__more::before {
  display: none;
}
</style>
