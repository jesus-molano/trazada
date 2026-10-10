<script setup lang="ts">
import type { SessionType } from '@trazada/schema'
import type { ComponentPublicInstance } from 'vue'
import { DATA_DELAY_MIN, type SessionView } from '~/manager/model'

const props = defineProps<{ type: SessionType; view: SessionView }>()
const emit = defineEmits<{ download: []; cancel: [id: string] }>()
const { t, locale } = useI18n()

const name = computed(() => t(`session.${props.type}`))
const job = computed(() =>
  props.view.kind === 'queued' || props.view.kind === 'running' || props.view.kind === 'error' ? props.view.job : null,
)
const pct = computed(() => Math.round(job.value?.pct ?? 0))
/** El motivo real de «No disponible» (sin posiciones o entrada de catálogo no válida). */
const unavailableHint = computed(() =>
  props.view.kind === 'unavailable' && props.view.reason === 'invalid'
    ? t('selector.unavailableInvalidHint')
    : t('selector.unavailableHint'),
)
/** La hora de una sesión futura es aproximada (inicio del calendario + duración típica + margen): se explica. */
const futureHint = computed(() => t('manager.availableFromHint', { delay: DATA_DELAY_MIN }))
const barStyle = computed(() => ({ transform: `scaleX(${pct.value / 100})` }))
/** Mensaje del error y, después, el registro (sin repetir el mensaje si el registro ya lo trae). */
const details = computed(() => {
  const log = job.value?.log ?? []
  const message = job.value?.error?.message
  return [message && !log.includes(message) ? message : null, ...log]
    .filter((line): line is string => !!line)
    .join('\n')
})

/**
 * Una sola acción por fila (Descargar, Cancelar o Reintentar) en el mismo <button>: al cambiar de estado se
 * actualiza en sitio y el foco del teclado no se pierde.
 */
const action = computed(() => {
  const v = props.view
  if (v.kind === 'download') {
    return {
      text: t('manager.download'),
      label: t('manager.downloadSession', { session: name.value }),
      title: t('manager.downloadHint'),
      testid: `download-${props.type}`,
      quiet: false,
      run: () => emit('download'),
    }
  }
  if (v.kind === 'error') {
    return {
      text: t('manager.retry'),
      label: t('manager.retrySession', { session: name.value }),
      title: undefined,
      testid: `retry-${props.type}`,
      quiet: false,
      run: () => emit('download'),
    }
  }
  if (v.kind === 'queued' || v.kind === 'running') {
    const id = v.job.id
    return {
      text: t('manager.cancel'),
      label: t('manager.cancelSession', { session: name.value }),
      title: undefined,
      testid: `cancel-${props.type}`,
      quiet: true,
      run: () => emit('cancel', id),
    }
  }
  return null
})

// Si el foco estaba en la fila y la fila cambia de elemento (p. ej. la descarga termina y pasa a ser un enlace),
// se lleva al nuevo control en vez de dejarlo caer al <body>.
const root = ref<HTMLElement | ComponentPublicInstance | null>(null)
const rootEl = (): HTMLElement | null =>
  root.value instanceof HTMLElement ? root.value : ((root.value?.$el as HTMLElement | undefined) ?? null)
watch(
  () => props.view.kind,
  async () => {
    const had = rootEl()?.contains(document.activeElement) ?? false
    if (!had) return
    await nextTick()
    const el = rootEl()
    if (!el || el.contains(document.activeElement)) return
    ;(el.matches('a, button') ? el : (el.querySelector<HTMLElement>('a, button') ?? el)).focus()
  },
  { flush: 'pre' },
)
</script>

<template>
  <NuxtLink
    v-if="view.kind === 'link'"
    ref="root"
    :to="view.to"
    class="tz-session"
    data-state="link"
    :data-testid="`session-${type}`"
  >
    <span class="tz-session__name">{{ name }}</span>
    <span v-if="view.dev" class="tz-badge tz-badge--dev" :title="t('selector.devHint')">{{ t('selector.dev') }}</span>
    <span v-if="view.bytes" class="tz-session__size tz-tabular">{{ formatBytes(view.bytes, locale) }}</span>
  </NuxtLink>

  <div
    v-else-if="view.kind === 'unavailable'"
    ref="root"
    class="tz-session is-disabled"
    aria-disabled="true"
    tabindex="-1"
    data-state="unavailable"
    :data-reason="view.reason"
    :title="unavailableHint"
    :data-testid="`session-${type}`"
  >
    <span class="tz-session__name">{{ name }}</span>
    <span class="tz-badge">{{ t('selector.unavailable') }}</span>
    <span class="tz-visually-hidden">{{ unavailableHint }}</span>
  </div>

  <div
    v-else-if="view.kind === 'future'"
    ref="root"
    class="tz-session is-disabled"
    aria-disabled="true"
    tabindex="-1"
    data-state="future"
    :data-testid="`session-${type}`"
  >
    <span class="tz-session__name">{{ name }}</span>
    <template v-if="view.at">
      <span class="tz-session__note" :title="futureHint" data-testid="available-from">{{
        t('manager.availableFrom', { date: formatDateTime(view.at, locale) })
      }}</span>
      <span class="tz-visually-hidden">{{ futureHint }}</span>
    </template>
    <span v-else class="tz-session__note">{{ t('manager.notYet') }}</span>
  </div>

  <div
    v-else
    ref="root"
    class="tz-session"
    :class="`is-${view.kind}`"
    :data-state="view.kind"
    :data-testid="`session-${type}`"
  >
    <span class="tz-session__name">{{ name }}</span>
    <span v-if="view.kind === 'queued'" class="tz-badge">{{ t('manager.queued') }}</span>
    <template v-else-if="view.kind === 'running'">
      <span class="tz-session__note">{{ t(`manager.phase.${view.job.phase ?? 'start'}`) }}</span>
      <span class="tz-session__pct tz-tabular">{{ t('manager.progress', { pct }) }}</span>
    </template>
    <span v-else-if="view.kind === 'error'" class="tz-badge tz-badge--error">{{ t('manager.failedBadge') }}</span>

    <button
      v-if="action"
      type="button"
      class="tz-button tz-session__action"
      :class="{ 'tz-button--quiet': action.quiet }"
      :title="action.title"
      :aria-label="action.label"
      :data-testid="action.testid"
      @click="action.run()"
    >
      {{ action.text }}
    </button>

    <span
      v-if="view.kind === 'running'"
      class="tz-session__progress"
      role="progressbar"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-valuenow="pct"
      :aria-label="t('manager.progressLabel', { session: name })"
      :data-testid="`progress-${type}`"
    >
      <span class="tz-session__bar" :style="barStyle" />
    </span>

    <template v-if="view.kind === 'error'">
      <p class="tz-session__error" :data-testid="`error-${type}`">
        {{ t(`manager.error.${view.job.error?.code ?? 'failed'}`) }}
      </p>
      <details v-if="details" class="tz-session__details">
        <summary>{{ t('manager.details') }}</summary>
        <pre>{{ details }}</pre>
      </details>
    </template>
  </div>
</template>

<style scoped>
.tz-session {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--tz-space-2) var(--tz-space-3);
  min-height: 48px;
  padding: var(--tz-space-3) var(--tz-space-4);
  border: 1px solid var(--tz-border);
  border-radius: var(--tz-radius-md);
  background: var(--tz-surface-1);
  color: var(--tz-text);
}

a.tz-session:hover {
  border-color: var(--tz-accent);
  text-decoration: none;
}

.tz-session.is-disabled {
  color: var(--tz-text-faint);
  cursor: not-allowed;
}

.tz-session[tabindex='-1']:focus {
  outline: none;
}

.tz-session.is-running,
.tz-session.is-queued {
  border-color: var(--tz-accent);
}

.tz-session.is-error {
  border-color: var(--tz-danger);
}

.tz-session__name {
  flex: 1;
  font-weight: var(--tz-weight-medium);
}

.tz-session__size,
.tz-session__note,
.tz-session__pct {
  font-size: var(--tz-text-sm);
  color: var(--tz-text-muted);
}

.tz-session__action {
  padding: var(--tz-space-1) var(--tz-space-3);
  font-size: var(--tz-text-sm);
}

.tz-session__progress {
  flex-basis: 100%;
  height: 4px;
  overflow: hidden;
  border-radius: var(--tz-radius-pill);
  background: var(--tz-surface-3);
}

.tz-session__bar {
  display: block;
  height: 100%;
  background: var(--tz-accent);
  transform-origin: left center;
  transition: transform var(--tz-dur-base) var(--tz-ease-standard);
}

.tz-session__error {
  flex-basis: 100%;
  margin: 0;
  font-size: var(--tz-text-sm);
  color: var(--tz-text-muted);
}

.tz-session__details {
  flex-basis: 100%;
  font-size: var(--tz-text-xs);
  color: var(--tz-text-muted);
}

.tz-session__details summary {
  cursor: pointer;
}

.tz-session__details pre {
  max-height: 200px;
  margin: var(--tz-space-2) 0 0;
  padding: var(--tz-space-2);
  overflow: auto;
  border-radius: var(--tz-radius-sm);
  background: var(--tz-bg);
  font-family: var(--tz-font-mono);
  white-space: pre-wrap;
  word-break: break-word;
}

.tz-badge {
  padding: 2px var(--tz-space-2);
  border: 1px solid var(--tz-border-strong);
  border-radius: var(--tz-radius-pill);
  font-size: var(--tz-text-2xs);
  font-weight: var(--tz-weight-semibold);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.tz-badge--dev {
  border-color: var(--tz-estimated);
  color: var(--tz-estimated);
}

.tz-badge--error {
  border-color: var(--tz-danger);
  color: var(--tz-danger);
}

@media (prefers-reduced-motion: reduce) {
  .tz-session__bar {
    transition: none;
  }
}
</style>
