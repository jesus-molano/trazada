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

const title = computed(() => {
  const m = session.manifest
  if (m) return `${m.session.event} · ${t(`session.${m.session.type}`)} · ${m.session.season}`
  return parsed.value ? `${parsed.value.season} · ${t(`session.${parsed.value.type}`)}` : t('replay.title')
})
useHead({ title })

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
    </header>

    <div v-if="session.status === 'loading' || session.status === 'error'" class="tz-replay__center">
      <TzLoadPanel />
    </div>

    <TzLeaderboard v-if="playback.attached" :key="`lb-${session.id}`" />
    <TzReplayDock v-if="playback.attached" :key="session.id ?? undefined" />
  </section>
</template>

<style scoped>
.tz-replay {
  position: relative;
  min-height: calc(100vh - 120px);
  overflow: hidden;
}

.tz-replay__bar {
  position: relative;
  z-index: var(--tz-z-panels);
  display: flex;
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

.tz-replay__center {
  position: absolute;
  inset: 0;
  z-index: var(--tz-z-panels);
  display: grid;
  place-items: center;
}
</style>
