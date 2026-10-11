<script setup lang="ts">
/**
 * Mensajes de dirección de carrera hasta el instante del reloj, del más reciente al más antiguo: el texto
 * original tal cual (en inglés) y el tipo traducido. Se recalcula con el estado grueso (~10 Hz) y solo
 * cambia el DOM cuando aparece o desaparece un mensaje. El título es el común de los paneles (una línea, condensada) y
 * el desplegable lleva el chevrón del registro de iconos (D30). Desplegada o plegada se recuerda por diseño
 * (stores/layout.ts, ítem 15).
 *
 * Microinteracciones (21b, D42): un mensaje nuevo entra desde arriba con un fundido y destella una vez (`data-fresh`)
 * solo con reproducción a ≤ ×4, si entran como mucho LIST_MOTION_MAX_CHANGES a la vez y sin salto del reloj; tras un
 * seek, en pausa, con reduced motion o a ×8/×16, la lista cambia al instante. El texto nunca se anima: solo la entrada.
 */
import type { RaceControlEvent } from '@trazada/schema'
import { duration, LIST_MOTION_MAX_CHANGES, LIST_MOTION_MAX_RATE, useReducedMotion } from '~/design/motion'
import { formatClock } from '~/engine/format/time'
import { clockOrigin } from '~/engine/timeline/markers'
import { visibleCount } from '~/engine/trackstate/TrackState'
import { rcTone } from '~/replay/rcKinds'
import { useLayoutStore } from '~/stores/layout'
import { getRuntime, usePlaybackStore } from '~/stores/playback'

const { t, te } = useI18n()
const playback = usePlaybackStore()
const layout = useLayoutStore()
const reduced = useReducedMotion()
const rt = getRuntime()!
const { playback: pb, type } = rt.session.manifest.session
const origin = clockOrigin(type, rt.session.timing, pb)
const events = rt.raceControl
const times = events.map((e) => e.t)

const open = computed({
  get: () => layout.current.rcOpen,
  set: (value: boolean) => layout.setRcOpen(value),
})
const count = ref(visibleCount(times, playback.timeMs))
const visible = computed(() => events.slice(0, count.value).reverse())

/** ¿Se anima la última entrada de mensajes? Y el índice del mensaje que destella (null: ninguno). */
const animate = ref(false)
const fresh = ref<number | null>(null)
let freshTimer: ReturnType<typeof setTimeout> | null = null
/** Margen (ms de pared) sobre lo que avanza el reloj entre dos actualizaciones gruesas antes de llamarlo salto. */
const JUMP_SLACK_MS = 250
let lastT = playback.timeMs
let lastWall = performance.now()

/**
 * ¿El reloj saltó (seek) entre dos actualizaciones gruesas? Con reproducción, el reloj avanza como mucho lo que pasa de
 * tiempo de pared por la velocidad; hacia atrás o mucho más, es un salto. En pausa, cualquier cambio lo es.
 */
function jumped(dt: number, wall: number): boolean {
  if (!playback.playing) return true
  return dt < 0 || dt > (wall + JUMP_SLACK_MS) * playback.rate
}

function clearFresh() {
  if (freshTimer) clearTimeout(freshTimer)
  freshTimer = null
  fresh.value = null
}

watch(
  () => playback.timeMs,
  (t) => {
    const now = performance.now()
    const jump = jumped(t - lastT, now - lastWall)
    lastT = t
    lastWall = now
    const next = visibleCount(times, t)
    const added = next - count.value
    if (added === 0) return
    animate.value =
      !jump && added > 0 && added <= LIST_MOTION_MAX_CHANGES && playback.rate <= LIST_MOTION_MAX_RATE && !reduced.value
    count.value = next
    clearFresh()
    if (animate.value) {
      // El más nuevo destella una vez (dura lo que --tz-dur-flash) y deja de estar «fresco».
      fresh.value = next - 1
      freshTimer = setTimeout(clearFresh, duration('flash') * 1000 + 50)
    }
  },
)
onBeforeUnmount(clearFresh)

function kindLabel(e: RaceControlEvent): string {
  const key = `rc.kind.${e.parsed.kind}`
  return te(key) ? t(key) : t('rc.kind.other')
}
</script>

<template>
  <section class="tz-rc" :class="{ 'is-open': open }" :aria-label="t('rc.title')" data-testid="race-control">
    <!-- Patrón de "disclosure": el botón va dentro del encabezado (nunca un encabezado dentro de un botón). -->
    <h2 class="tz-rc__heading">
      <button
        type="button"
        class="tz-rc__head"
        :aria-expanded="open"
        aria-controls="tz-rc-list"
        :title="t('rc.toggle')"
        data-testid="race-control-toggle"
        @click="open = !open"
      >
        <span class="tz-panel-title tz-rc__title">{{ t('rc.title') }}</span>
        <span class="tz-rc__count tz-tabular" data-testid="rc-count">{{ t('rc.count', count) }}</span>
        <TzIcon name="chevron" size="sm" class="tz-rc__chevron" />
      </button>
    </h2>
    <!--
      Región con scroll y sin controles dentro: enfocable para poder desplazarla con el teclado. Sin animación (css y
      move-class sin transición), los mensajes entran y salen al instante.
    -->
    <TransitionGroup
      v-show="open"
      id="tz-rc-list"
      tag="ol"
      name="tz-rc"
      class="tz-rc__list"
      aria-live="off"
      tabindex="0"
      :aria-label="t('rc.title')"
      :css="animate"
      :move-class="animate ? 'tz-rc-move' : 'tz-rc-still'"
      data-testid="rc-list"
    >
      <li v-if="!visible.length" key="empty" class="tz-rc__empty">{{ t('rc.empty') }}</li>
      <li
        v-for="(e, i) in visible"
        :key="count - 1 - i"
        class="tz-rc__item"
        :class="rcTone(e.parsed.kind)"
        :data-t="e.t"
        :data-kind="e.parsed.kind"
        :data-fresh="fresh === count - 1 - i ? '' : undefined"
        data-testid="rc-message"
      >
        <div class="tz-rc__meta">
          <span class="tz-rc__time tz-tabular">{{ formatClock(e.t - origin) }}</span>
          <span v-if="e.lap" class="tz-rc__lap tz-tabular">{{ t('rc.lap', { lap: e.lap }) }}</span>
          <span class="tz-rc__kind" data-testid="rc-kind">{{ kindLabel(e) }}</span>
        </div>
        <p class="tz-rc__text" lang="en" :title="t('rc.original')" data-testid="rc-text">{{ e.text }}</p>
      </li>
    </TransitionGroup>
  </section>
</template>

<style scoped>
/* Nada se pinta fuera de su borde redondeado (con poco alto, la lista asomaba por debajo del panel). */
.tz-rc {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--tz-border);
  border-radius: var(--tz-radius-lg);
  background: var(--tz-overlay);
  box-shadow: var(--tz-shadow-panel);
}

.tz-rc.is-open {
  /* Ocupa lo que deje la telemetría (base 0): su lista larga no le quita sitio. Su alto no depende de lo que contiene. */
  flex: 1 1 0;
  min-height: var(--replay-rc-floor, 150px);
  container-type: size;
}

/*
 * Con sitio solo para la cabecera (un coche elegido en una pantalla baja o en la tablet): la lista no asoma a medias.
 * 5,5 rem de contenido: la cabecera con su zona táctil (44 px) y un mensaje de una línea; por debajo del mínimo de «un
 * mensaje» que la telemetría le puede pedir (`--replay-rc-one`, 6 rem con su borde, en pages/replay.vue).
 */
@container (height < 5.5rem) {
  .tz-rc__list {
    display: none;
  }
}

.tz-rc__heading {
  margin: 0;
  font-size: inherit;
  font-weight: inherit;
}

.tz-rc__head {
  display: flex;
  align-items: center;
  gap: var(--tz-space-2);
  width: 100%;
  min-height: var(--tz-hit-min);
  padding: var(--tz-space-2) var(--tz-panel-pad);
  border: 0;
  background: transparent;
  text-align: start;
  cursor: pointer;
}

/* Título de panel común (.tz-panel-title: condensada, mayúsculas, --tz-tracking-caps y una sola línea). */
.tz-rc__title {
  flex: 1;
}

.tz-rc__count {
  flex: none;
  font-size: var(--tz-text-2xs);
  color: var(--tz-text-faint);
}

/* Cerrado, el chevrón apunta a la derecha; abierto, hacia abajo. */
.tz-rc__chevron {
  color: var(--tz-text-muted);
  transform: rotate(-90deg);
  transition: transform var(--tz-dur-fast) var(--tz-ease-standard);
}

.is-open .tz-rc__chevron {
  transform: rotate(0deg);
}

.tz-rc__list {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 0 var(--tz-space-2) var(--tz-space-2);
  overflow-y: auto;
  list-style: none;
}

.tz-rc__empty {
  padding: var(--tz-space-2);
  font-size: var(--tz-text-xs);
  color: var(--tz-text-muted);
}

.tz-rc__item {
  padding: var(--tz-space-2);
  border-left: 3px solid var(--tz-border-strong);
  border-radius: var(--tz-radius-sm);
}

.tz-rc__item + .tz-rc__item {
  margin-top: var(--tz-space-1);
}

/* Entrada de un mensaje nuevo (solo cuando se anima): desde arriba, con un fundido; los de debajo se desplazan. */
.tz-rc-enter-active {
  transition:
    opacity var(--tz-dur-base) var(--tz-ease-enter),
    transform var(--tz-dur-base) var(--tz-ease-enter);
}

.tz-rc-enter-from {
  opacity: 0;
  transform: translateY(calc(-1 * var(--tz-shift)));
}

.tz-rc-move {
  transition: transform var(--tz-dur-base) var(--tz-ease-standard);
}

/* El más nuevo destella una vez: el fondo, del acento suave a nada (con reduce, 0 ms). */
.tz-rc__item[data-fresh] {
  animation: tz-flash var(--tz-dur-flash) var(--tz-ease-exit);
}

.tz-rc__item.is-yellow {
  border-left-color: var(--tz-flag-yellow);
}

.tz-rc__item.is-flag {
  border-left-color: var(--tz-flag-green);
}

.tz-rc__item.is-neutral {
  border-left-color: var(--tz-sc);
}

/* Comisarios: franja de pintura de pista (categoría), no el acento de los controles (D47). */
.tz-rc__item.is-stewards {
  border-left-color: var(--tz-paint);
}

.tz-rc__meta {
  display: flex;
  align-items: baseline;
  gap: var(--tz-space-2);
  font-size: var(--tz-text-2xs);
  color: var(--tz-text-muted);
}

.tz-rc__time {
  font-family: var(--tz-font-mono);
}

.tz-rc__kind {
  margin-left: auto;
  font-weight: var(--tz-weight-semibold);
  color: var(--tz-text);
}

.tz-rc__text {
  margin: 2px 0 0;
  font-family: var(--tz-font-mono);
  font-size: var(--tz-text-xs);
  line-height: 1.35;
  overflow-wrap: anywhere;
}
</style>
