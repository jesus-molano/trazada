<script setup lang="ts">
import { parseSessionId } from '~/data/session-id'
import { installDebugHandle } from '~/replay/debug'
import {
  parseTimeParam,
  planResume,
  RESUME_EXT,
  type ResumeApplied,
  resumeInfo,
  resumeStore,
  type ResumeTracker,
  trackResume,
} from '~/replay/resume'
import { createReplayRuntime, defaultInitialMs } from '~/replay/runtime'
import { REPLAY_HEADER, REPLAY_OVERLAYS } from '~/slots/replay'
import { usePlaybackStore } from '~/stores/playback'
import { useSessionStore } from '~/stores/session'

const { t, locale } = useI18n()
const route = useRoute()
const session = useSessionStore()
const playback = usePlaybackStore()
useReplayShortcuts()

const id = computed(() => (typeof route.query.s === 'string' ? route.query.s : ''))
const parsed = computed(() => parseSessionId(id.value))

// La página se prerenderiza sin `?s=`: hasta montar, el título es el genérico (sin desajuste de hidratación).
const mounted = ref(false)
onMounted(() => (mounted.value = true))
const title = computed(() => {
  const m = session.manifest
  if (m) return `${m.session.event} · ${t(`session.${m.session.type}`)} · ${m.session.season}`
  return mounted.value && parsed.value ? `${parsed.value.season} · ${t(`session.${parsed.value.type}`)}` : t('replay.title')
})
useHead({ title })

/** `?bench=1`: bench de rendimiento (docs/PERFORMANCE.md). */
const benchMode = computed(() => route.query.bench === '1')
/** `?t=<ms de sesión>`: instante de arranque explícito; manda sobre la posición guardada (ítem 13). */
const urlTime = computed(() => parseTimeParam(route.query.t))

// La escena (y three.js) se monta un frame después de "listo": su coste no entra en la carga de datos.
const sceneEnabled = ref(false)
let removeDebug: (() => void) | null = null
/** Guardado de la posición de la sesión abierta (ítem 13). */
let tracker: ResumeTracker | null = null
/** Guarda por última vez la sesión que se deja; antes de soltar su runtime. */
function stopTracking() {
  tracker?.stop()
  tracker = null
}

watch(
  () => session.status,
  (status) => {
    removeDebug?.()
    removeDebug = null
    if (status !== 'ready' || !session.data) {
      stopTracking()
      sceneEnabled.value = false
      playback.detach()
      return
    }
    // El montaje (modelo, controles y escena) va en frames posteriores a "listo": así el mensaje de datos
    // listos se procesa en un instante y la interfaz no se bloquea.
    const data = session.data
    requestAnimationFrame(() => {
      if (session.data !== data) return
      stopTracking()
      // Reanudar donde se dejó (ítem 13): en pausa, en ese instante, con el coche (si sigue en la sesión), el
      // seguimiento y la velocidad. `?t=` manda sobre lo guardado; el bench ni lo usa ni guarda nada.
      const pb = data.manifest.session.playback
      const defaultMs = defaultInitialMs(pb)
      const plan =
        benchMode.value || urlTime.value !== null
          ? null
          : planResume(resumeStore.get(data.id), {
              t0Utc: data.manifest.session.t0Utc,
              startMs: pb.startMs,
              endMs: pb.endMs,
              defaultMs,
              cars: data.manifest.drivers.map((d) => d.number),
            })
      const rt = createReplayRuntime(data, { initialMs: urlTime.value ?? plan?.t })
      const info = resumeInfo(data, rt.markers, defaultMs)
      // Lo retomado, para el aviso (components/replay-overlays/TzResumeToast.vue), antes de que se monte.
      rt.ext<ResumeApplied | null>(RESUME_EXT, () => (plan ? { plan, info } : null))
      if (plan) rt.clock.setRate(plan.rate)
      playback.attach(rt)
      if (plan?.car) {
        playback.selectCar(plan.car)
        playback.setFollowing(plan.follow)
      }
      removeDebug = installDebugHandle(rt, () => playback.selectedCar)
      if (!benchMode.value) {
        tracker = trackResume(rt, info, () => ({ car: playback.selectedCar, follow: playback.following }))
      }
      requestAnimationFrame(() => (sceneEnabled.value = session.data === data))
    })
  },
)
// Elegir otro coche o dejar de seguirlo también se recuerda (1 s después del último cambio).
watch(
  () => [playback.selectedCar, playback.following],
  () => tracker?.touch(),
)

const readyDetail = computed(() => {
  const timings = session.data?.timings
  if (!timings) return ''
  return t('replay.readyDetail', {
    size: formatBytes(timings.bytes, locale.value),
    seconds: formatSeconds(timings.totalMs, locale.value),
  })
})

onMounted(() => void session.load(id.value))
watch(id, (value) => void session.load(value))
onBeforeUnmount(() => {
  stopTracking()
  removeDebug?.()
  playback.detach()
  session.unload()
})
</script>

<template>
  <section class="tz-replay">
    <LazyTzScene v-if="sceneEnabled" />

    <header class="tz-replay__bar">
      <h1 class="tz-replay__title" data-testid="replay-title">{{ title }}</h1>
      <p
        v-if="session.status === 'ready'"
        class="tz-replay__status"
        role="status"
        data-testid="replay-status"
        data-state="ready"
        :title="readyDetail"
      >
        <span class="tz-replay__dot" aria-hidden="true" />{{ t('replay.ready') }}
        <span class="tz-replay__detail tz-tabular">{{ readyDetail }}</span>
      </p>
      <!-- Avisos de calidad del pipeline (quality.notes del manifest), si los hay. -->
      <TzSessionNotes v-if="session.status === 'ready'" :key="`notes-${session.id}`" :notes="session.manifest?.quality.notes" />
      <TzTrackStatus v-if="playback.attached" :key="`ts-${session.id}`" />
      <!-- Botones y chips de otras funciones (hueco components/replay-header/, D29). -->
      <template v-if="playback.attached">
        <component :is="h.component" v-for="h in REPLAY_HEADER" :key="`${h.name}-${session.id}`" />
      </template>
      <!-- La escena teletransporta aquí sus herramientas (altura, separación y etiquetas "Estimado"). -->
      <div id="tz-scene-tools" class="tz-replay__tools" />
    </header>

    <div v-if="session.status === 'loading' || session.status === 'error'" class="tz-replay__center">
      <TzLoadPanel />
    </div>

    <div v-if="playback.attached" class="tz-replay__stage">
      <TzLeaderboard :key="`lb-${session.id}`" />
      <aside class="tz-replay__side">
        <TzTelemetry v-if="playback.selectedCar" :key="`tel-${session.id}`" />
        <TzRaceControl :key="`rc-${session.id}`" />
      </aside>
    </div>
    <TzReplayDock v-if="playback.attached" :key="session.id ?? undefined" />
    <!-- Hojas, tarjetas y avisos de otras funciones (hueco components/replay-overlays/, D29). -->
    <template v-if="playback.attached">
      <component :is="o.component" v-for="o in REPLAY_OVERLAYS" :key="`${o.name}-${session.id}`" />
    </template>
    <TzBench v-if="benchMode && sceneEnabled" :key="`bench-${session.id}`" />
  </section>
</template>

<style scoped>
/* Columna: cabecera, escenario (paneles laterales) y dock; la escena 3D ocupa todo el fondo. */
.tz-replay {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: calc(100vh - 120px);
  overflow: hidden;
}

.tz-replay__bar {
  position: relative;
  z-index: var(--tz-z-panels);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--tz-space-4);
  padding: var(--tz-space-4) var(--tz-space-6);
  pointer-events: none;
}

.tz-replay__bar > * {
  pointer-events: auto;
}

/* Con un panel desplegado (avisos, «Cómo se dibuja»), la cabecera pasa por encima de los paneles laterales. */
.tz-replay__bar:has([aria-expanded='true']) {
  z-index: var(--tz-z-header);
}

.tz-replay__title {
  margin: 0;
  font-size: var(--tz-text-xl);
  font-weight: var(--tz-weight-semibold);
}

.tz-replay__status {
  display: inline-flex;
  flex: none;
  white-space: nowrap;
  align-items: center;
  gap: var(--tz-space-2);
  margin: 0;
  padding: var(--tz-space-1) var(--tz-space-3);
  border: 1px solid var(--tz-border-strong);
  border-radius: var(--tz-radius-pill);
  background: var(--tz-overlay);
  font-size: var(--tz-text-sm);
  font-weight: var(--tz-weight-semibold);
}

.tz-replay__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--tz-success);
}

.tz-replay__detail {
  font-weight: var(--tz-weight-regular);
  color: var(--tz-text-muted);
}

@media (width < 640px) {
  .tz-replay__bar {
    align-items: flex-start;
  }

  .tz-replay__title {
    font-size: var(--tz-text-lg);
  }

  .tz-replay__detail {
    display: none;
  }
}

.tz-replay__tools {
  margin-left: auto;
}

.tz-replay__stage {
  /* 1 si los paneles van en una franja inferior (tablet vertical): la escena encuadra por encima. */
  --replay-panels-bottom: 0;
  position: relative;
  z-index: var(--tz-z-panels);
  flex: 1 1 auto;
  min-height: 0;
  margin: 0 var(--tz-space-6) var(--tz-space-3);
  pointer-events: none;
}

.tz-replay__stage > * {
  pointer-events: auto;
}

/* Columna derecha: telemetría (si hay coche seleccionado) y, debajo, dirección de carrera. */
.tz-replay__side {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  gap: var(--tz-space-3);
  width: 290px;
  pointer-events: none;
}

.tz-replay__side > * {
  pointer-events: auto;
}

/* Con un coche elegido, la dirección de carrera cede sitio (se ve su último mensaje) para que quepan las gráficas. */
.tz-replay__side:has([data-testid='telemetry']) {
  --replay-rc-min: 104px;
}

/* Portátiles bajos (≤ 860 px de alto): con un coche elegido, de la dirección de carrera solo queda su cabecera. */
@media (height <= 860px) {
  .tz-replay__side:has([data-testid='telemetry']) {
    --replay-rc-min: 48px;
  }
}

/* Tablet en horizontal y portátiles pequeños: paneles más estrechos. */
@media (width <= 1100px) {
  .tz-replay__side {
    width: 250px;
  }
}

/*
 * Tablet en vertical: el mapa arriba y los paneles en una franja inferior, en dos columnas. La escena
 * encuadra el circuito por encima de esa franja (TzScene mide los paneles que ocupan la parte baja).
 */
@media (width <= 900px) and (orientation: portrait) {
  .tz-replay__stage {
    --replay-panels-bottom: 1;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    align-content: end;
    gap: var(--tz-space-3);
  }

  .tz-replay__stage > * {
    position: relative;
    max-height: 34vh;
  }

  .tz-replay__side {
    position: relative;
    inset: auto;
    width: auto;
    height: 34vh;
  }
}

.tz-replay__center {
  position: absolute;
  inset: 0;
  z-index: var(--tz-z-panels);
  display: grid;
  place-items: center;
}
</style>
