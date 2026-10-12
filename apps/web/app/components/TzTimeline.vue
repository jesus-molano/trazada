<script setup lang="ts">
/**
 * Timeline de la sesión. El cabezal se mueve escribiendo `transform` en cada frame (sin reactividad);
 * los marcadores son estáticos. Arrastrable con ratón y táctil (Pointer Events + captura). Debajo de las marcas,
 * los carriles de otras funciones (hueco `components/timeline-lanes/`, D29).
 *
 * Vista previa (ítem 16, `TzTimelinePreview`): al pasar el ratón (o el lápiz), al arrastrar con el dedo y con el foco
 * del teclado (sobre el cabezal), una tarjeta con lo que pasaba en ese instante. Se recalcula como mucho una vez por
 * frame de pantalla y solo mientras el puntero se mueve (nada por frame del reloj); Esc la oculta.
 *
 * Zoom y desplazamiento (D56): la pista se ensancha `zoom` veces dentro de su marco y se desplaza con
 * `transform`; todo lo de dentro (marcas, ventanas, carriles) va en % de la duración, así que se estira solo, y el
 * instante bajo el puntero se sigue midiendo con la caja de la pista. Rueda: acercar o alejar en el cursor; Mayús + rueda
 * o la rueda horizontal: desplazar; + y − con el foco; botones (también en táctil) y una barra con lo que se ve, que se
 * arrastra. Como mucho, `MIN_WINDOW_MS` a la vista. Reproduciendo, si el cabezal sale de la vista, la vista pasa
 * página (salvo unos segundos después de moverla a mano). Todo directo al DOM: el zoom cambia solo con el usuario.
 */
import { SEEK_STEP_LARGE_MS, SEEK_STEP_MS } from '~/composables/useReplayShortcuts'
import { formatClock } from '~/engine/format/time'
import { clockOrigin, leaderLapAt } from '~/engine/timeline/markers'
import { createTimelinePreview, PREVIEW_EXT, type PreviewAt, type TimelinePreview } from '~/engine/timeline/preview'
import { TIMELINE_LANES } from '~/slots/timeline-lanes'
import { getRuntime, usePlaybackStore } from '~/stores/playback'

const { t } = useI18n()
const playback = usePlaybackStore()
const rt = getRuntime()!
const clock = rt.clock
const { playback: pb, type } = rt.session.manifest.session
const isRace = type === 'race' || type === 'sprint'
const origin = clockOrigin(type, rt.session.timing, pb)
const tla = new Map(rt.drivers.map((d) => [d.number, d.tla]))

const frame = ref<HTMLElement | null>(null)
const track = ref<HTMLElement | null>(null)
const thumb = ref<HTMLElement | null>(null)
const head = ref<HTMLElement | null>(null)
const fill = ref<HTMLElement | null>(null)
const dragging = ref(false)

const pct = (ms: number) => `${(((ms - clock.startMs) / clock.duration) * 100).toFixed(4)}%`
const inRange = (ms: number) => ms >= clock.startMs && ms <= clock.endMs

const laps = rt.markers.laps.filter((l) => inRange(l.t))
const overlaps = (w: { fromMs: number; toMs: number }) => w.toMs >= clock.startMs && w.fromMs <= clock.endMs
const windows = rt.markers.windows.filter(overlaps)
const assists = rt.markers.assists.filter(overlaps)
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

// --- Zoom y desplazamiento ---
/** Lo mínimo que se ve con el zoom al máximo (y como mucho ×64). */
const MIN_WINDOW_MS = 120_000
const MAX_ZOOM = Math.max(1, Math.min(64, clock.duration / MIN_WINDOW_MS))
/** Tras mover la vista a mano, cuánto tiempo no la mueve el cabezal al reproducir (ms). */
const MANUAL_HOLD_MS = 5000
/** Acercar o alejar con un botón o una tecla. */
const ZOOM_STEP = 2
/** Ampliación (estado grueso: cambia solo con el usuario) y comienzo de lo que se ve (fracción de la sesión). */
const zoom = ref(1)
let offset = 0
let manualUntil = 0
const zoomLabel = computed(() => `×${zoom.value < 10 ? Math.round(zoom.value * 10) / 10 : Math.round(zoom.value)}`)

/** Escribe la vista en el DOM: ancho y desplazamiento de la pista y la barra de lo que se ve. */
function applyView() {
  const el = track.value
  if (el) {
    el.style.width = zoom.value > 1 ? `${(zoom.value * 100).toFixed(3)}%` : ''
    el.style.transform = zoom.value > 1 ? `translateX(${(-offset * 100).toFixed(4)}%)` : ''
  }
  if (thumb.value) {
    thumb.value.style.left = `${(offset * 100).toFixed(3)}%`
    thumb.value.style.width = `${(100 / zoom.value).toFixed(3)}%`
  }
}

function setView(z: number, start: number, manual = true) {
  const nz = Math.min(MAX_ZOOM, Math.max(1, z))
  offset = Math.min(1 - 1 / nz, Math.max(0, start))
  if (nz !== zoom.value) {
    zoom.value = nz
    hidePreview()
  }
  if (manual) manualUntil = performance.now() + MANUAL_HOLD_MS
  applyView()
}

/** Cambia el zoom dejando fijo el instante que está en `at` (fracción del ancho del marco, 0…1). */
function zoomAround(factor: number, at: number) {
  const t = offset + at / zoom.value
  const nz = Math.min(MAX_ZOOM, Math.max(1, zoom.value * factor))
  setView(nz, t - at / nz)
}

/** Fracción del marco donde cae el cabezal (para los botones y las teclas: el zoom va hacia él si se ve). */
function headAt(): number {
  const f = (playback.timeMs - clock.startMs) / clock.duration
  const at = (f - offset) * zoom.value
  return at >= 0 && at <= 1 ? at : 0.5
}

const zoomIn = () => zoomAround(ZOOM_STEP, headAt())
const zoomOut = () => zoomAround(1 / ZOOM_STEP, headAt())
const zoomReset = () => setView(1, 0)

function onWheel(event: WheelEvent) {
  const r = frame.value?.getBoundingClientRect()
  if (!r || !(r.width > 0)) return
  event.preventDefault()
  const horizontal = event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)
  if (horizontal) {
    const d = event.shiftKey && event.deltaX === 0 ? event.deltaY : event.deltaX
    if (zoom.value > 1) setView(zoom.value, offset + d / r.width / zoom.value)
    return
  }
  const at = Math.min(1, Math.max(0, (event.clientX - r.left) / r.width))
  zoomAround(Math.exp(-event.deltaY * 0.002), at)
}

/** La barra de lo que se ve: arrastrar desplaza la vista; un toque fuera del pulgar la centra ahí. */
let pan: { pointer: number; x: number; from: number; moved: boolean } | null = null
function onScrollDown(event: PointerEvent) {
  if (zoom.value <= 1) return
  const bar = event.currentTarget as HTMLElement
  bar.setPointerCapture?.(event.pointerId)
  pan = { pointer: event.pointerId, x: event.clientX, from: offset, moved: false }
}
function onScrollMove(event: PointerEvent) {
  if (!pan || event.pointerId !== pan.pointer) return
  const w = (event.currentTarget as HTMLElement).getBoundingClientRect().width
  const dx = event.clientX - pan.x
  if (Math.abs(dx) > 3) pan.moved = true
  if (pan.moved && w > 0) setView(zoom.value, pan.from + dx / w)
}
function onScrollUp(event: PointerEvent) {
  if (!pan || event.pointerId !== pan.pointer) return
  const moved = pan.moved
  pan = null
  if (moved) return
  const r = (event.currentTarget as HTMLElement).getBoundingClientRect()
  if (r.width > 0) setView(zoom.value, (event.clientX - r.left) / r.width - 0.5 / zoom.value)
}

function fractionAt(clientX: number): number {
  const r = track.value!.getBoundingClientRect()
  return Math.min(1, Math.max(0, (clientX - r.left) / r.width))
}

// --- Vista previa (ítem 16) ---
/** Marcadores que entran en la tarjeta: a menos de estos px del instante. */
const MARKER_PX = 8
type CardSource = 'pointer' | 'touch' | 'focus'
const previewId = useId()
/**
 * Lo último que pintó la tarjeta y si se ve. Cambia al ritmo del puntero o del estado grueso, nunca por frame. Al
 * ocultarse conserva su contenido mientras se desvanece (una sola tarjeta, sin duplicados al volver enseguida).
 */
const preview = shallowRef<{ at: PreviewAt; x: number; width: number } | null>(null)
const previewShown = ref(false)
/** De dónde sale el instante: el puntero (ratón o lápiz encima), el dedo arrastrando o el cabezal con el foco. */
let source: CardSource | null = null
/** El foco llegó con el teclado (no con un clic): la tarjeta sigue al cabezal. */
let keyboardFocus = false
/**
 * El foco lo está dando `onPointerDown` (ratón, lápiz o dedo): nunca es del teclado. Chromium marca :focus-visible un
 * focus() por script sin una interacción previa de ratón, como el de un toque (que llega antes que el del navegador).
 */
let pointerFocusing = false
let model: TimelinePreview | null = null
/** Precálculo perezoso, uno por runtime (`rt.ext`): la primera vez que hace falta. */
const previewModel = () => (model ??= rt.ext(PREVIEW_EXT, createTimelinePreview))
/** Un cálculo por frame de pantalla como mucho: el puntero puede mandar varios movimientos por frame. */
let raf = 0
let pending: { clientX: number; from: CardSource } | null = null

function showAt(ms: number, from: CardSource) {
  const r = track.value?.getBoundingClientRect()
  const fr = frame.value?.getBoundingClientRect()
  if (!r || !fr || !(r.width > 0)) return
  const f = (ms - clock.startMs) / clock.duration
  // Con zoom, la pista es más ancha que su marco y está desplazada: la tarjeta se coloca y se recorta en el marco.
  const toleranceMs = (MARKER_PX / r.width) * clock.duration
  source = from
  preview.value = { at: previewModel().at(ms, toleranceMs), x: r.left - fr.left + f * r.width, width: fr.width }
  previewShown.value = true
}

function schedule(clientX: number, from: CardSource) {
  pending = { clientX, from }
  if (!raf) raf = requestAnimationFrame(flush)
}

function flush() {
  raf = 0
  const p = pending
  pending = null
  if (p && track.value) showAt(clock.startMs + fractionAt(p.clientX) * clock.duration, p.from)
}

function cancelPending() {
  cancelAnimationFrame(raf)
  raf = 0
  pending = null
}

function hidePreview() {
  cancelPending()
  source = null
  previewShown.value = false
}

/** La tarjeta sobre el cabezal (foco del teclado), o nada si el foco no vino del teclado. */
function followHead() {
  cancelPending()
  if (keyboardFocus) showAt(playback.timeMs, 'focus')
  else hidePreview()
}

function onPointerDown(event: PointerEvent) {
  if (event.button !== 0 && event.pointerType === 'mouse') return
  track.value!.setPointerCapture(event.pointerId)
  dragging.value = true
  playback.setScrubbing(true)
  clock.seekToFraction(fractionAt(event.clientX))
  // Con el puntero ya no se usa el teclado: al soltar, la tarjeta no se queda sobre el cabezal.
  keyboardFocus = false
  pointerFocusing = true
  try {
    track.value!.focus({ preventScroll: true })
  } finally {
    pointerFocusing = false
  }
  if (event.pointerType === 'touch') schedule(event.clientX, 'touch')
}

function onPointerMove(event: PointerEvent) {
  const f = fractionAt(event.clientX)
  if (dragging.value) clock.seekToFraction(f)
  // Ratón y lápiz: al pasar por encima. Dedo: solo mientras arrastra (sobre el dedo).
  if (event.pointerType !== 'touch') schedule(event.clientX, 'pointer')
  else if (dragging.value) schedule(event.clientX, 'touch')
}

function onPointerUp(event: PointerEvent) {
  if (track.value?.hasPointerCapture(event.pointerId)) track.value.releasePointerCapture(event.pointerId)
  dragging.value = false
  playback.setScrubbing(false)
  if (event.pointerType === 'touch') {
    followHead()
    return
  }
  // Un arrastre con el ratón que se suelta fuera de la pista: ya no está encima.
  const r = track.value?.getBoundingClientRect()
  if (r && (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom)) {
    followHead()
  }
}

function onPointerLeave(event: PointerEvent) {
  // Con el dedo, la captura la suelta `pointerup`; al salir un ratón, vuelve al cabezal si el foco es del teclado.
  if (event.pointerType !== 'touch' && !dragging.value) followHead()
}

function onFocus() {
  if (pointerFocusing) return
  try {
    keyboardFocus = track.value?.matches(':focus-visible') ?? false
  } catch {
    keyboardFocus = false
  }
  if (keyboardFocus && source !== 'pointer') followHead()
}

function onBlur() {
  keyboardFocus = false
  if (source === 'focus') hidePreview()
}

// Con el foco del teclado, la tarjeta sigue al cabezal al ritmo del estado grueso (flechas, Inicio, Fin…).
watch(
  () => playback.timeMs,
  () => {
    if (source === 'focus') followHead()
  },
)

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    // Se oculta sin mover el foco (vuelve con la siguiente tecla o al mover el puntero).
    if (previewShown.value) {
      event.preventDefault()
      hidePreview()
    }
    return
  }
  if (event.key === '+' || event.key === '=') {
    event.preventDefault()
    zoomIn()
    return
  }
  if (event.key === '-') {
    event.preventDefault()
    zoomOut()
    return
  }
  if (keyboardFocus && source === null) source = 'focus'
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
    // Con zoom, si el cabezal sale de la vista (reproduciendo o tras un salto), la vista pasa página hasta él.
    if (zoom.value > 1 && !dragging.value && performance.now() > manualUntil) {
      const span = 1 / zoom.value
      if (f < offset || f > offset + span) setView(zoom.value, f - span * 0.1, false)
    }
  })
})
onBeforeUnmount(() => {
  off?.()
  cancelPending()
  if (dragging.value) playback.setScrubbing(false)
})
</script>

<template>
  <div class="tz-timeline">
    <!-- Marco de la pista: la tarjeta de la vista previa va fuera del slider (sus hijos son presentacionales). -->
    <div ref="frame" class="tz-timeline__frame" :class="{ 'is-zoomed': zoom > 1 }" @wheel="onWheel">
    <div
      ref="track"
      class="tz-timeline__track"
      :class="{ 'is-dragging': dragging, 'has-lanes': TIMELINE_LANES.length > 0 }"
      role="slider"
      tabindex="0"
      :aria-label="t('timeline.label')"
      aria-valuemin="0"
      :aria-valuemax="Math.round(clock.duration / 1000)"
      :aria-valuenow="valueNow"
      :aria-valuetext="valueText"
      :aria-describedby="previewShown ? previewId : undefined"
      data-testid="timeline"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @pointerleave="onPointerLeave"
      @focus="onFocus"
      @blur="onBlur"
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
      <div v-if="assists.length" class="tz-timeline__assists">
        <div
          v-for="(w, i) in assists"
          :key="`a${i}`"
          class="tz-timeline__assist"
          :class="`is-${w.kind}`"
          :style="windowStyle(w)"
          :title="t(`timeline.window.${w.kind}`)"
          data-marker="assist"
          :data-kind="w.kind"
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
      <div v-if="TIMELINE_LANES.length" class="tz-timeline__lanes">
        <component :is="lane.component" v-for="lane in TIMELINE_LANES" :key="lane.name" />
      </div>
      <div class="tz-timeline__headlane" aria-hidden="true">
        <div ref="head" class="tz-timeline__head"><span /></div>
      </div>
    </div>
    <TzTimelinePreview
      v-if="preview"
      :id="previewId"
      :at="preview.at"
      :x="preview.x"
      :width="preview.width"
      :visible="previewShown"
    />
    <!-- Lo que se ve con zoom: arrastrar desplaza la vista. -->
    <div
      v-show="zoom > 1"
      class="tz-timeline__scroll"
      aria-hidden="true"
      data-testid="timeline-scroll"
      @pointerdown="onScrollDown"
      @pointermove="onScrollMove"
      @pointerup="onScrollUp"
      @pointercancel="onScrollUp"
    >
      <div ref="thumb" class="tz-timeline__thumb" />
    </div>
    </div>
    <div class="tz-timeline__zoom" role="group" :aria-label="t('timeline.zoom.label')" :title="t('timeline.zoom.hint')">
      <button
        type="button"
        class="tz-iconbtn tz-timeline__zoombtn"
        :aria-label="t('timeline.zoom.out')"
        :disabled="zoom <= 1"
        data-testid="timeline-zoom-out"
        @click="zoomOut"
      >
        <TzIcon name="zoomOut" size="sm" />
      </button>
      <!-- Su hueco se reserva siempre (oculto sin zoom): al acercar, la pista no cambia de ancho. -->
      <button
        type="button"
        class="tz-timeline__zoomlevel tz-tabular"
        :class="{ 'is-idle': zoom <= 1 }"
        :aria-label="t('timeline.zoom.reset', { z: zoomLabel })"
        data-testid="timeline-zoom-reset"
        @click="zoomReset"
      >
        {{ zoomLabel }}
      </button>
      <button
        type="button"
        class="tz-iconbtn tz-timeline__zoombtn"
        :aria-label="t('timeline.zoom.in')"
        :disabled="zoom >= MAX_ZOOM"
        data-testid="timeline-zoom-in"
        @click="zoomIn"
      >
        <TzIcon name="zoomIn" size="sm" />
      </button>
    </div>
  </div>
</template>

<style scoped>
/* Debajo de los controles (en una fila con ellos desde 1280 px: TzReplayDock le quita este margen). */
.tz-timeline {
  display: flex;
  align-items: flex-start;
  gap: var(--tz-space-2);
  padding-top: var(--tz-space-3);
}

.tz-timeline__frame {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
}

/* Con zoom, la pista (más ancha) se recorta en el marco; la tarjeta de la vista previa sigue saliendo por arriba. */
.tz-timeline__frame.is-zoomed {
  overflow-x: clip;
}

/* Lo que se ve de la sesión con zoom: una barra fina bajo la pista; el pulgar se arrastra. */
.tz-timeline__scroll {
  position: relative;
  height: 10px;
  margin-top: 2px;
  cursor: grab;
  touch-action: none;
}

.tz-timeline__scroll::before {
  content: '';
  position: absolute;
  inset: 4px 0;
  border-radius: var(--tz-radius-pill);
  background: var(--tz-surface-2);
}

.tz-timeline__thumb {
  position: absolute;
  top: 3px;
  bottom: 3px;
  min-width: 6px;
  border-radius: var(--tz-radius-pill);
  background: var(--tz-text-faint);
}

.tz-timeline__zoom {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: var(--tz-space-0-5);
}

.tz-timeline__zoombtn {
  width: 28px;
  height: 28px;
}

.tz-timeline__zoomlevel.is-idle {
  visibility: hidden;
}

.tz-timeline__zoomlevel {
  min-width: 36px;
  height: 28px;
  padding: 0 var(--tz-space-1);
  border: 0;
  border-radius: var(--tz-radius-md);
  background: var(--tz-surface-2);
  color: var(--tz-text);
  font-size: var(--tz-text-xs);
  cursor: pointer;
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
  transition: transform var(--tz-dur-fast) var(--tz-ease-standard);
}

/*
 * Microinteracción (21b): el riel engorda un poco al pasar por encima o al arrastrar, y el cabezal se ensancha mientras
 * se arrastra (su `span`, hijo del transform que se escribe en cada frame, que nunca lleva transición).
 */
.tz-timeline__track.is-dragging .tz-timeline__rail {
  transform: scaleY(1.25);
}

@media (hover: hover) {
  .tz-timeline__track:hover .tz-timeline__rail {
    transform: scaleY(1.25);
  }
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

/* Carril fino bajo el riel: ventanas de OVERTAKE (2026) o DRS (2023–25) activadas por race control. */
.tz-timeline__assists {
  position: absolute;
  left: 0;
  right: 0;
  top: 15px;
  height: 2px;
  pointer-events: none;
}

.tz-timeline__assist {
  position: absolute;
  top: 0;
  bottom: 0;
  border-radius: 1px;
  background: var(--tz-flag-green);
  opacity: 0.8;
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

/* Carriles extra (timeline-lanes/): en el flujo, bajo las marcas; la pista crece con ellos y el cabezal los cruza. */
.tz-timeline__track.has-lanes {
  height: auto;
  min-height: 36px;
}

.tz-timeline__lanes {
  display: grid;
  gap: 2px;
  padding-top: 36px;
}

/* El cabezal se mueve con translateX(% del ancho de la pista): su carril lo recorta para no desbordar. */
.tz-timeline__headlane {
  position: absolute;
  inset: 0 -2px;
  overflow: hidden;
  pointer-events: none;
}

.tz-timeline__head {
  position: absolute;
  inset: 0 2px;
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
  transition: transform var(--tz-dur-fast) var(--tz-ease-standard);
}

.tz-timeline__track.is-dragging .tz-timeline__head span {
  transform: scaleX(2);
}

</style>
