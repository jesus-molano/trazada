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
 *
 * Radio de los equipos (D51): «Todo / Dirección de carrera / Radio» elige qué se lista (lo que suena en directo lo lleva
 * replay-overlays/TzRadioLive.vue, montado siempre); los clips van mezclados por hora
 * con los mensajes, también solo hasta el instante del reloj (nunca uno del futuro), con reproducir, pausa y progreso
 * (suena uno a la vez). Su hora es la de publicación: el mensaje pudo decirse unos segundos antes. «Escuchar en directo»
 * (apagado por defecto): a ×1 o ×2, cada clip suena cuando el reloj llega a él (los del coche elegido o, sin coche,
 * todos); se para al saltar, pausar o subir de ×2. Sin radio en la sesión no hay filtro ni nada que ocupe alto; de una
 * sesión de antes de 1.2.0, una línea pide volver a descargarla. Nada de transcripción.
 */
import type { RaceControlEvent, RadioClip } from '@trazada/schema'
import { duration, LIST_MOTION_MAX_CHANGES, LIST_MOTION_MAX_RATE, useReducedMotion } from '~/design/motion'
import { formatClock } from '~/engine/format/time'
import { clipsUpTo, radioClips, radioStatus } from '~/engine/radio/radio'
import { clockOrigin } from '~/engine/timeline/markers'
import { visibleCount } from '~/engine/trackstate/TrackState'
import { rcTint } from '~/replay/rcKinds'
import { useLayoutStore } from '~/stores/layout'
import { getRuntime, usePlaybackStore } from '~/stores/playback'
import { type RadioFilter, useRadioStore } from '~/stores/radio'

const { t, te } = useI18n()
const playback = usePlaybackStore()
const layout = useLayoutStore()
const reduced = useReducedMotion()
const rt = getRuntime()!
const { playback: pb, type } = rt.session.manifest.session
const origin = clockOrigin(type, rt.session.timing, pb)
const events = rt.raceControl
const times = events.map((e) => e.t)
const radio = useRadioStore()
const status = radioStatus(rt.session.manifest)
const clips = radioClips(rt.session.events)
const clipTimes = clips.map((c) => c.t)
const drivers = new Map(rt.drivers.map((d) => [d.number, d]))
const FILTERS: readonly RadioFilter[] = ['all', 'rc', 'radio']
const filterLabel = computed<Record<RadioFilter, string>>(() => ({
  all: t('radio.filter.all'),
  rc: t('radio.filter.rc'),
  radio: t('radio.filter.radio'),
}))

const open = computed({
  get: () => layout.current.rcOpen,
  set: (value: boolean) => layout.setRcOpen(value),
})
const count = ref(visibleCount(times, playback.timeMs))
const radioCount = ref(clipsUpTo(clipTimes, playback.timeMs))

type Row = { kind: 'rc'; i: number; e: RaceControlEvent } | { kind: 'radio'; i: number; c: RadioClip }
/** Lo que se lista, del más reciente al más antiguo: mensajes y clips mezclados por hora, según el filtro. */
const visible = computed<Row[]>(() => {
  const rows: Row[] = []
  const withRc = filter.value !== 'radio'
  const withRadio = filter.value !== 'rc'
  let a = withRc ? count.value - 1 : -1
  let b = withRadio ? radioCount.value - 1 : -1
  while (a >= 0 || b >= 0) {
    // A igual hora, el clip va encima (se publica después de lo que comenta).
    if (b >= 0 && (a < 0 || clips[b]!.t >= events[a]!.t)) {
      rows.push({ kind: 'radio', i: b, c: clips[b]! })
      b--
    } else {
      rows.push({ kind: 'rc', i: a, e: events[a]! })
      a--
    }
  }
  return rows
})

const who = (car: string) => drivers.get(car)?.tla ?? `#${car}`
const teamMark = (car: string) => ({ background: drivers.get(car)?.color || 'var(--tz-team-unknown)' })
const hasRadio = status === 'present' || status === 'partial'
// Sin radio no hay filtro: siempre se ve todo (lo que haya de dirección de carrera).
const filter = computed<RadioFilter>(() => (hasRadio ? radio.filter : 'all'))
const emptyText = computed(() => (filter.value === 'radio' ? t('radio.empty') : t('rc.empty')))

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
    radioCount.value = clipsUpTo(clipTimes, t)
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
        <span class="tz-rc__count tz-tabular" data-testid="rc-count">{{ t('rc.count', visible.length) }}</span>
        <TzIcon name="chevron" size="sm" class="tz-rc__chevron" />
      </button>
    </h2>
    <!-- Solo con radio (D51): una sesión sin ella no pierde alto; una de antes de 1.2.0 lo dice en una línea. -->
    <p v-if="open && status === 'outdated'" class="tz-rc__radio-note" data-testid="radio-outdated">{{ t('radio.outdated') }}</p>
    <div v-if="hasRadio" v-show="open" class="tz-rc__tools" data-testid="rc-tools">
      <span class="tz-segmented tz-rc__filter" role="group" :aria-label="t('radio.filter.label')">
        <button
          v-for="f in FILTERS"
          :key="f"
          type="button"
          :aria-pressed="radio.filter === f"
          :data-testid="`rc-filter-${f}`"
          @click="radio.filter = f"
        >
          {{ filterLabel[f] }}
        </button>
      </span>
      <button
        type="button"
        class="tz-rc__live"
        :aria-pressed="radio.live"
        :disabled="!hasRadio"
        :title="t('radio.liveHint')"
        data-testid="radio-live"
        @click="radio.live = !radio.live"
      >
        <TzIcon name="radio" size="sm" />{{ t('radio.live') }}
      </button>
    </div>
    <!--
      Región con scroll: enfocable para poder desplazarla con el teclado (las filas de radio llevan su botón). Sin animación (css y
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
      <li v-if="!visible.length" key="empty" class="tz-rc__empty" data-testid="rc-empty">{{ emptyText }}</li>
      <template v-for="row in visible" :key="`${row.kind}-${row.i}`">
        <li
          v-if="row.kind === 'rc'"
          class="tz-rc__item"
          :class="rcTint(row.e.parsed.kind)"
          :data-t="row.e.t"
          :data-kind="row.e.parsed.kind"
          :data-fresh="fresh === row.i ? '' : undefined"
          data-testid="rc-message"
        >
          <TzRcGlyph :kind="row.e.parsed.kind" class="tz-rc__glyph" />
          <div class="tz-rc__meta">
            <span class="tz-rc__kind" data-testid="rc-kind">{{ kindLabel(row.e) }}</span>
            <span v-if="row.e.lap" class="tz-rc__lap tz-tabular">{{ t('rc.lap', { lap: row.e.lap }) }}</span>
            <span class="tz-rc__time tz-tabular">{{ formatClock(row.e.t - origin) }}</span>
          </div>
          <p class="tz-rc__text" lang="en" :title="t('rc.original')" data-testid="rc-text">{{ row.e.text }}</p>
        </li>
        <li v-else class="tz-rc__item is-radio" :data-t="row.c.t" :data-car="row.c.car" data-testid="rc-radio">
          <span class="tz-rc__glyph tz-rc__glyph--radio" aria-hidden="true"><TzIcon name="radio" size="sm" /></span>
          <div class="tz-rc__meta">
            <span class="tz-rc__kind">
              {{ t('radio.kind') }}
              <span class="tz-rc__who"><span class="tz-rc__team" :style="teamMark(row.c.car)" />{{ who(row.c.car) }}</span>
            </span>
            <span />
            <span class="tz-rc__time tz-tabular" :title="t('radio.published')">{{ formatClock(row.c.t - origin) }}</span>
          </div>
          <TzRadioClip class="tz-rc__clip" :clip="row.c" :who="who(row.c.car)" :when="formatClock(row.c.t - origin)" />
        </li>
      </template>
    </TransitionGroup>
  </section>
</template>

<style scoped>
/*
 * Hoja de tiempos (D50): el panel es parte del cromo (sin caja ni sombra); filas con filetes, una columna de estado con
 * su glifo (TzRcGlyph), el tipo en seminegrita y «V5 11:30» en mono tenue a la derecha; las neutralizaciones y la roja
 * tiñen la fila entera. Nada de franjas de color a la izquierda. Nada se pinta fuera del panel.
 */
.tz-rc {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  border-top: 1px solid var(--tz-border);
  background: var(--tz-overlay);
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
 * mensaje» que la telemetría le puede pedir (`--replay-rc-one`, 6 rem con su borde, en TzReplay.vue).
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
  border-radius: var(--tz-radius-md);
  background: transparent;
  text-align: start;
  cursor: pointer;
}

@media (hover: hover) {
  .tz-rc__head:hover {
    background: var(--tz-surface-2);
  }
}

.tz-rc__title {
  flex: 1;
}

.tz-rc__count {
  flex: none;
  font-size: var(--tz-text-xs);
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
  padding: 0;
  overflow-y: auto;
  list-style: none;
}

.tz-rc__empty {
  padding: var(--tz-space-2) var(--tz-panel-pad);
  font-size: var(--tz-text-xs);
  color: var(--tz-text-muted);
}

.tz-rc__item {
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr);
  column-gap: var(--tz-space-2);
  padding: 9px var(--tz-space-2) 10px var(--tz-space-1);
  border-top: 1px solid var(--tz-row-rule);
}

.tz-rc__item:first-child {
  border-top: 0;
}

.tz-rc__item.is-neutral {
  background: var(--tz-row-tint-neutral);
}

.tz-rc__item.is-red {
  background: var(--tz-row-tint-red);
}

.tz-rc__glyph {
  grid-column: 1;
  grid-row: 1 / span 2;
  justify-self: center;
  margin-top: 2px;
}

.tz-rc__glyph--radio {
  color: var(--tz-radio);
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

/* Primero el tipo en seminegrita; «V5» y la hora en mono tenue, a la derecha. */
.tz-rc__meta {
  grid-column: 2;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  column-gap: var(--tz-space-2);
  align-items: baseline;
}

.tz-rc__kind {
  overflow: hidden;
  font-size: var(--tz-text-sm);
  font-weight: var(--tz-weight-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--tz-text);
}

.tz-rc__lap,
.tz-rc__time {
  font-family: var(--tz-font-mono);
  font-size: var(--tz-text-xs);
  color: var(--tz-text-faint);
}

/* El texto original (en inglés), en Barlow 12,5 secundario: se lee mejor que en mono (D50). */
.tz-rc__text {
  grid-column: 2;
  /* Se puede copiar (la página del replay no deja seleccionar lo demás). */
  user-select: text;
  margin: 3px 0 0;
  font-size: 12.5px;
  line-height: 1.35;
  color: var(--tz-text-muted);
  overflow-wrap: anywhere;
}

/* Filtro y «Escuchar en directo», bajo la cabecera. */
.tz-rc__tools {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--tz-space-2);
  padding: 0 var(--tz-panel-pad) var(--tz-space-2);
}

.tz-rc__radio-note {
  margin: 0;
  padding: 0 var(--tz-panel-pad) var(--tz-space-2);
  font-size: var(--tz-text-2xs);
  color: var(--tz-text-muted);
}

.tz-rc__live {
  display: inline-flex;
  align-items: center;
  gap: var(--tz-space-1);
  min-height: var(--tz-space-8);
  padding: 0 var(--tz-space-2);
  border: 0;
  border-radius: var(--tz-radius-md);
  background: transparent;
  color: var(--tz-text-muted);
  font-size: var(--tz-text-xs);
  cursor: pointer;
}

@media (hover: hover) {
  .tz-rc__live:hover:not(:disabled, [aria-pressed='true']) {
    background: var(--tz-surface-2);
    color: var(--tz-text);
  }
}

/* Activado: la placa maciza de pintura (D47). */
.tz-rc__live[aria-pressed='true'] {
  background: var(--tz-accent);
  color: var(--tz-accent-on);
}

.tz-rc__live:disabled {
  opacity: 0.5;
  cursor: default;
}

.tz-rc__who {
  display: inline-flex;
  align-items: center;
  gap: var(--tz-space-1);
  margin-left: var(--tz-space-1);
  font-family: var(--tz-font-mono);
  font-weight: var(--tz-weight-medium);
}

/* Marca del equipo (un dato, no el borde de la fila). */
.tz-rc__team {
  width: 3px;
  height: 12px;
  border-radius: 1px;
}

.tz-rc__clip {
  grid-column: 2;
  margin-top: var(--tz-space-1);
}
</style>
