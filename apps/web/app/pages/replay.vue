<script setup lang="ts">
import { parseSessionId } from '~/data/session-id'
import { installDebugHandle } from '~/replay/debug'
import { createReplayRuntime } from '~/replay/runtime'
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

// La escena (y three.js) se monta un frame después de "listo": su coste no entra en la carga de datos.
const sceneEnabled = ref(false)
let removeDebug: (() => void) | null = null
watch(
  () => session.status,
  (status) => {
    removeDebug?.()
    removeDebug = null
    if (status !== 'ready' || !session.data) {
      sceneEnabled.value = false
      playback.detach()
      return
    }
    // El montaje (modelo, controles y escena) va en frames posteriores a "listo": así el mensaje de datos
    // listos se procesa en un instante y la interfaz no se bloquea.
    const data = session.data
    requestAnimationFrame(() => {
      if (session.data !== data) return
      const rt = createReplayRuntime(data)
      playback.attach(rt)
      removeDebug = installDebugHandle(rt, () => playback.selectedCar)
      requestAnimationFrame(() => (sceneEnabled.value = session.data === data))
    })
  },
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
      <TzTrackStatus v-if="playback.attached" :key="`ts-${session.id}`" />
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
