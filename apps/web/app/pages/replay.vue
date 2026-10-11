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

// Layout propio (D44): sin la cabecera global; la marca y el idioma van en la cabecera del replay (TzBrandBar).
definePageMeta({ layout: 'replay' })

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
/** Nombre del estado (empieza por lo que se ve, «Listo») y su detalle, que se abre al pulsar el punto. */
const readyName = computed(() => (readyDetail.value ? `${t('replay.ready')} · ${readyDetail.value}` : t('replay.ready')))

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

    <!--
      Cabecera en una sola fila (D44): marca, título (se acorta con «…» antes que nada), estado, avisos, estado de pista,
      botones del hueco y herramientas de la escena. Por debajo de 1600 px, lo secundario va solo con su icono (el estado,
      los avisos y «Cómo se dibuja», por debajo de 1920 px); las etiquetas «Estimado» nunca se esconden (las de la escena
      flotan justo debajo, sobre el mapa).
    -->
    <header class="tz-replay__bar">
      <TzBrandBar />
      <h1 class="tz-replay__title" :title="title" data-testid="replay-title">{{ title }}</h1>
      <p
        v-if="session.status === 'ready'"
        class="tz-replay__status"
        role="status"
        data-testid="replay-status"
        data-state="ready"
      >
        <!-- Un punto que se pulsa para ver el detalle de la carga; desde 1920 px, también «Listo» y el detalle. -->
        <TzHint plain :label="readyName" :text="readyName" testid="replay-status-detail" :title="readyName">
          <template #button>
            <span class="tz-replay__dot" aria-hidden="true" />
            <span class="tz-replay__ready">{{ t('replay.ready') }}</span>
            <span class="tz-replay__detail tz-tabular" aria-hidden="true">{{ readyDetail }}</span>
          </template>
        </TzHint>
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
/*
 * Columna a toda la ventana (layouts/replay.vue): cabecera, escenario (paneles laterales) y dock; la escena 3D ocupa
 * todo el fondo. Anchos de los paneles con los tokens de densidad (D44); las etiquetas «Estimado» de la escena flotan
 * bajo la cabecera, a la izquierda de la columna derecha (`--replay-over-*`, que usa TzSceneTools).
 */
.tz-replay {
  --replay-side-w: var(--tz-panel-w);
  --replay-over-right: calc(var(--tz-space-6) + var(--replay-side-w) + var(--tz-space-3));
  /* Hasta la clasificación (su ancho, más el de las columnas de otras funciones y el margen), sin pisarla. */
  --replay-over-max: calc(100% - var(--replay-over-right) - var(--tz-panel-w) - var(--tz-space-12) - var(--tz-space-6));
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

/*
 * Cabecera: una sola fila (si se parte, la escena y los paneles pierden alto). Para decidir si cabe, el título cuenta
 * solo con su mínimo (6 em) y el estado de pista con su chip más ancho: después crecen hasta su contenido (primero el
 * estado de pista) y el título se acorta con «…» si no llega. Solo si ni así cabe (tablet), la fila se parte; nunca se
 * esconde una bandera ni una etiqueta «Estimado».
 */
.tz-replay__bar {
  position: relative;
  z-index: var(--tz-z-panels);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--tz-space-2) var(--tz-space-3);
  padding: var(--tz-space-3) var(--tz-space-6) var(--tz-space-2);
  pointer-events: none;
}

.tz-replay__bar > * {
  flex: none;
  pointer-events: auto;
}

/* Con un panel desplegado (avisos, «Cómo se dibuja»), la cabecera pasa por encima de los paneles laterales. */
.tz-replay__bar:has([aria-expanded='true']) {
  z-index: var(--tz-z-header);
}

/* Con el chip de la realización automática (centrado bajo la cabecera), las etiquetas «Estimado» bajan una fila. */
.tz-replay__bar:has([data-testid='tv-chip']) {
  --replay-over-top: calc(var(--tz-space-12) + var(--tz-space-2));
}

/*
 * Con la hoja de análisis abierta, la escena está tapada entera (`rt.setSceneHidden`): sus etiquetas «Estimado» no
 * describen nada que se vea y no flotan sobre la hoja (con la hoja, la cabecera pasa por encima de ella, por su
 * botón desplegado). Al cerrarla vuelven; lo estimado de cada pestaña lleva su propia etiqueta.
 */
.tz-replay:has([data-testid='analysis-sheet']) {
  --replay-over-display: none;
}

/* Base 0 y crece hasta su texto: cede sitio antes que nadie (con «…» y el texto entero en su título). */
.tz-replay__title {
  flex: 1 1 0;
  min-width: min(6em, 100%);
  max-width: max-content;
  margin: 0;
  overflow: hidden;
  font-size: var(--tz-text-xl);
  font-weight: var(--tz-weight-semibold);
  line-height: var(--tz-leading-tight);
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Estado de pista: cuenta con su chip más ancho y crece (antes que el título) hasta que caben todos sus chips. */
.tz-replay__bar > [data-testid='track-status'] {
  flex: 100 1 0;
  min-width: min-content;
  max-width: max-content;
}

/* Portátiles (< 1360 px): huecos más justos entre los elementos de la cabecera. */
@media (width < 1360px) {
  .tz-replay__bar {
    column-gap: var(--tz-space-2);
  }
}

/* Estado: un punto (el texto «Listo» sigue en el DOM, accesible); desde 1920 px, también «Listo» y el detalle. */
.tz-replay__status {
  margin: 0;
}

.tz-replay__status :deep(.tz-hint__trigger) {
  gap: var(--tz-space-2);
  height: 28px;
  padding: 0 var(--tz-space-2);
  border: 1px solid var(--tz-border-strong);
  border-radius: var(--tz-radius-pill);
  background: var(--tz-overlay);
  font-size: var(--tz-text-sm);
  font-weight: var(--tz-weight-semibold);
  white-space: nowrap;
}

.tz-replay__dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--tz-success);
}

.tz-replay__detail {
  font-weight: var(--tz-weight-regular);
  color: var(--tz-text-muted);
}

@media (width < 1920px) {
  .tz-replay__ready {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .tz-replay__detail {
    display: none;
  }
}

@media (width < 640px) {
  .tz-replay__title {
    font-size: var(--tz-text-lg);
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
  gap: var(--tz-panel-gap);
  width: var(--replay-side-w);
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
  .tz-replay {
    --replay-side-w: var(--tz-panel-w-narrow);
  }
}

/*
 * Tablet en vertical: el mapa arriba y los paneles en una franja inferior, en dos columnas. La escena
 * encuadra el circuito por encima de esa franja (TzScene mide los paneles que ocupan la parte baja).
 */
@media (width <= 900px) and (orientation: portrait) {
  .tz-replay {
    --replay-over-right: var(--tz-space-6);
    --replay-over-max: calc(100% - 2 * var(--tz-space-6));
  }

  .tz-replay__stage {
    --replay-panels-bottom: 1;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    align-content: end;
    gap: var(--tz-panel-gap);
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
