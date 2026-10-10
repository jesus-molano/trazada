<script setup lang="ts">
/**
 * Timeline de la sesión. El cabezal se mueve escribiendo `transform` en cada frame (sin reactividad);
 * los marcadores son estáticos. Arrastrable con ratón y táctil (Pointer Events + captura).
 */
import { SEEK_STEP_LARGE_MS, SEEK_STEP_MS } from '~/composables/useReplayShortcuts'
import { formatClock } from '~/engine/format/time'
import { clockOrigin, leaderLapAt } from '~/engine/timeline/markers'
import { getRuntime, usePlaybackStore } from '~/stores/playback'

const { t } = useI18n()
const playback = usePlaybackStore()
const rt = getRuntime()!
const clock = rt.clock
const { playback: pb, type } = rt.session.manifest.session
const isRace = type === 'race' || type === 'sprint'
const origin = clockOrigin(type, rt.session.timing, pb)
const tla = new Map(rt.drivers.map((d) => [d.number, d.tla]))

const track = ref<HTMLElement | null>(null)
const head = ref<HTMLElement | null>(null)
const fill = ref<HTMLElement | null>(null)
const hover = ref<{ x: number; label: string } | null>(null)
const dragging = ref(false)

const pct = (ms: number) => `${(((ms - clock.startMs) / clock.duration) * 100).toFixed(4)}%`
const inRange = (ms: number) => ms >= clock.startMs && ms <= clock.endMs

const laps = rt.markers.laps.filter((l) => inRange(l.t))
const windows = rt.markers.windows.filter((w) => w.toMs >= clock.startMs && w.fromMs <= clock.endMs)
const flags = rt.markers.flags.filter((f) => inRange(f.t))
const pits = rt.markers.pits.filter((p) => inRange(p.inMs))
const selectedPits = computed(() => pits.filter((p) => p.car === playback.selectedCar))

function windowStyle(w: { fromMs: number; toMs: number }) {
  const from = Math.max(w.fromMs, clock.startMs)
  const to = Math.min(w.toMs, clock.endMs)
  return { left: pct(from), width: `${(((to - from) / clock.duration) * 100).toFixed(4)}%` }
}

function label(ms: number): string {
  const lap = isRace ? leaderLapAt(rt.markers, ms) : 0
  const time = formatClock(ms - origin)
  return lap > 0 ? t('timeline.atLap', { lap, time }) : time
}

const valueText = computed(() => label(playback.timeMs))
const valueNow = computed(() => Math.round((playback.timeMs - clock.startMs) / 1000))

function fractionAt(clientX: number): number {
  const r = track.value!.getBoundingClientRect()
  return Math.min(1, Math.max(0, (clientX - r.left) / r.width))
}

function onPointerDown(event: PointerEvent) {
  if (event.button !== 0 && event.pointerType === 'mouse') return
  track.value!.setPointerCapture(event.pointerId)
  dragging.value = true
  clock.seekToFraction(fractionAt(event.clientX))
  track.value!.focus({ preventScroll: true })
}

function onPointerMove(event: PointerEvent) {
  const f = fractionAt(event.clientX)
  if (dragging.value) clock.seekToFraction(f)
  if (event.pointerType === 'mouse') {
    const r = track.value!.getBoundingClientRect()
    hover.value = { x: f * r.width, label: label(clock.startMs + f * clock.duration) }
  }
}

function onPointerUp(event: PointerEvent) {
  if (track.value?.hasPointerCapture(event.pointerId)) track.value.releasePointerCapture(event.pointerId)
  dragging.value = false
}

function onKeydown(event: KeyboardEvent) {
  const step = event.shiftKey ? SEEK_STEP_LARGE_MS : SEEK_STEP_MS
  const actions: Record<string, () => void> = {
    ArrowLeft: () => clock.seekBy(-step),
    ArrowDown: () => clock.seekBy(-step),
    ArrowRight: () => clock.seekBy(step),
    ArrowUp: () => clock.seekBy(step),
    PageDown: () => clock.seekBy(-60_000),
    PageUp: () => clock.seekBy(60_000),
    Home: () => clock.seek(clock.startMs),
    End: () => clock.seek(clock.endMs),
  }
  const action = actions[event.key]
  if (action) {
    event.preventDefault()
    action()
  }
}

let off: (() => void) | null = null
onMounted(() => {
  off = rt.onFrame((timeMs) => {
    const f = (timeMs - clock.startMs) / clock.duration
    if (head.value) head.value.style.transform = `translateX(${(f * 100).toFixed(3)}%)`
    if (fill.value) fill.value.style.transform = `scaleX(${f.toFixed(5)})`
  })
})
onBeforeUnmount(() => off?.())
</script>

<template>
  <div class="tz-timeline">
    <div
      ref="track"
      class="tz-timeline__track"
      :class="{ 'is-dragging': dragging }"
      role="slider"
      tabindex="0"
      :aria-label="t('timeline.label')"
      aria-valuemin="0"
      :aria-valuemax="Math.round(clock.duration / 1000)"
      :aria-valuenow="valueNow"
      :aria-valuetext="valueText"
      data-testid="timeline"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @pointerleave="hover = null"
      @keydown="onKeydown"
    >
      <div class="tz-timeline__rail">
        <div ref="fill" class="tz-timeline__fill" />
        <div
          v-for="(w, i) in windows"
          :key="`w${i}`"
          class="tz-timeline__window"
          :class="`is-${w.kind}`"
          :style="windowStyle(w)"
          :title="t(`timeline.window.${w.kind}`)"
          data-marker="window"
        />
      </div>
      <div class="tz-timeline__ticks" aria-hidden="true">
        <span
          v-for="l in laps"
          :key="`l${l.lap}`"
          class="tz-timeline__lap"
          :class="{ 'is-major': l.lap % 5 === 0 || l.lap === 1 }"
          :style="{ left: pct(l.t) }"
          :title="t('timeline.lapStart', { lap: l.lap })"
          data-marker="lap"
        />
        <span
          v-for="(f, i) in flags"
          :key="`f${i}`"
          class="tz-timeline__flag"
          :class="`is-${f.kind}`"
          :style="{ left: pct(f.t) }"
          :title="t(`timeline.flag.${f.kind}`)"
          data-marker="flag"
        />
        <span
          v-for="(p, i) in pits"
          :key="`p${i}`"
          class="tz-timeline__pit"
          :style="{ left: pct(p.inMs) }"
          :title="t('timeline.pit', { tla: tla.get(p.car) ?? p.car })"
          data-marker="pit"
        />
        <span
          v-for="(p, i) in selectedPits"
          :key="`sp${i}`"
          class="tz-timeline__pit is-selected"
          :style="{ left: pct(p.inMs) }"
          data-marker="pit-selected"
        />
      </div>
      <div ref="head" class="tz-timeline__head" aria-hidden="true"><span /></div>
      <div v-if="hover" class="tz-timeline__hover tz-tabular" :style="{ transform: `translateX(${hover.x}px)` }">
        {{ hover.label }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.tz-timeline {
  padding-top: var(--tz-space-5);
}

.tz-timeline__track {
  position: relative;
  height: 36px;
  cursor: pointer;
  touch-action: none;
  user-select: none;
  border-radius: var(--tz-radius-sm);
}

.tz-timeline__rail {
  position: absolute;
  left: 0;
  right: 0;
  top: 6px;
  height: 8px;
  border-radius: var(--tz-radius-pill);
  background: var(--tz-surface-3);
  overflow: hidden;
}

.tz-timeline__fill {
  position: absolute;
  inset: 0;
  background: var(--tz-accent-soft);
  transform-origin: left center;
  transform: scaleX(0);
}

.tz-timeline__window {
  position: absolute;
  top: 0;
  bottom: 0;
  opacity: 0.85;
}

.tz-timeline__window.is-sc {
  background: var(--tz-sc);
}

.tz-timeline__window.is-vsc,
.tz-timeline__window.is-vsc-ending {
  background: repeating-linear-gradient(90deg, var(--tz-vsc) 0 4px, transparent 4px 7px);
}

.tz-timeline__window.is-red {
  background: var(--tz-flag-red);
}

.tz-timeline__ticks {
  position: absolute;
  left: 0;
  right: 0;
  top: 18px;
  height: 16px;
  pointer-events: none;
}

.tz-timeline__ticks > span {
  position: absolute;
  top: 0;
  transform: translateX(-50%);
}

.tz-timeline__lap {
  width: 1px;
  height: 5px;
  background: var(--tz-text-faint);
}

.tz-timeline__lap.is-major {
  height: 9px;
  background: var(--tz-text-muted);
}

.tz-timeline__flag {
  top: 8px !important;
  width: 0;
  height: 0;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-bottom: 7px solid var(--tz-flag-yellow);
}

.tz-timeline__flag.is-sector_double_yellow {
  border-bottom-color: var(--tz-flag-double-yellow);
}

.tz-timeline__flag.is-red_flag {
  border-bottom-color: var(--tz-flag-red);
}

.tz-timeline__flag.is-chequered_flag {
  border-bottom-color: var(--tz-flag-chequered);
}

.tz-timeline__pit {
  top: 1px !important;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--tz-pit);
  opacity: 0.45;
}

.tz-timeline__pit.is-selected {
  width: 7px;
  height: 7px;
  opacity: 1;
  outline: 1px solid var(--tz-bg);
}

.tz-timeline__head {
  position: absolute;
  inset: 0;
  pointer-events: none;
  transform: translateX(0);
}

.tz-timeline__head span {
  position: absolute;
  left: -1px;
  top: 0;
  bottom: 0;
  width: 2px;
  border-radius: 1px;
  background: var(--tz-text);
  box-shadow: 0 0 0 1px var(--tz-bg);
}

.tz-timeline__hover {
  position: absolute;
  left: 0;
  bottom: calc(100% + 4px);
  padding: 2px var(--tz-space-2);
  border-radius: var(--tz-radius-sm);
  background: var(--tz-surface-3);
  font-family: var(--tz-font-mono);
  font-size: var(--tz-text-xs);
  white-space: nowrap;
  pointer-events: none;
  translate: -50% 0;
}
</style>
