<script setup lang="ts">
import type { SessionType } from '@trazada/schema'
import type { ComponentPublicInstance } from 'vue'
import type { IconName } from '~/design/icons'
import { DATA_DELAY_MIN, type SessionView } from '~/manager/model'

const props = defineProps<{
  type: SessionType
  view: SessionView
  /** Prefijo de los `data-testid` (la misma fila en otro sitio de la portada, p. ej. la ficha del Gran Premio del momento). */
  scope?: string
}>()
const tid = (id: string) => (props.scope ? `${props.scope}-${id}` : id)
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
/** Sin posiciones: «sin señal»; entrada no válida: aviso. El icono acompaña al motivo, que va siempre en texto. */
const unavailableIcon = computed<IconName>(() =>
  props.view.kind === 'unavailable' && props.view.reason === 'invalid' ? 'alert' : 'noSignal',
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
 * actualiza en sitio y el foco del teclado no se pierde. El icono acompaña al texto; el nombre accesible es
 * `label`, con la sesión.
 */
const action = computed<{
  text: string
  label: string
  title: string | undefined
  testid: string
  icon: IconName
  quiet: boolean
  run: () => void
} | null>(() => {
  const v = props.view
  if (v.kind === 'download') {
    return {
      text: t('manager.download'),
      label: t('manager.downloadSession', { session: name.value }),
      title: t('manager.downloadHint'),
      testid: `download-${props.type}`,
      icon: 'download',
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
      icon: 'retry',
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
      icon: 'close',
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

/**
 * Destello único (tz-flash, --tz-dur-flash) cuando una descarga en curso termina y la fila pasa a ser el enlace al
 * replay. Solo la interfaz (D42): ninguna cifra se anima. Con prefers-reduced-motion dura 0 y se va al momento.
 */
const fresh = ref(false)
watch(
  () => props.view.kind,
  (kind, prev) => {
    fresh.value = kind === 'link' && (prev === 'running' || prev === 'queued')
  },
)
function onAnimationEnd(event: AnimationEvent) {
  if (event.animationName === 'tz-flash') fresh.value = false
}
</script>

<template>
  <NuxtLink
    v-if="view.kind === 'link'"
    ref="root"
    :to="view.to"
    class="tz-session is-link"
    :class="{ 'is-fresh': fresh }"
    data-state="link"
    :data-fresh="fresh ? '' : undefined"
    :data-testid="tid(`session-${type}`)"
    @animationend="onAnimationEnd"
  >
    <span class="tz-session__name">{{ name }}</span>
    <span v-if="view.dev" class="tz-badge tz-badge--dev" :title="t('selector.devHint')">{{ t('selector.dev') }}</span>
    <span v-if="view.bytes" class="tz-session__size tz-tabular">{{ formatBytes(view.bytes, locale) }}</span>
    <!-- Abre el replay: el icono es la señal visual; el nombre del enlace es el de la sesión. -->
    <TzIcon name="play" size="sm" class="tz-session__go" />
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
    :data-testid="tid(`session-${type}`)"
  >
    <span class="tz-session__name">{{ name }}</span>
    <span class="tz-badge">{{ t('selector.unavailable') }}</span>
    <!-- El motivo, en texto visible (en iPad un title no se ve nunca). -->
    <span class="tz-session__reason" :data-testid="tid('unavailable-reason')">
      <TzIcon :name="unavailableIcon" size="sm" />{{ unavailableHint }}
    </span>
  </div>

  <div
    v-else-if="view.kind === 'future'"
    ref="root"
    class="tz-session is-disabled"
    aria-disabled="true"
    tabindex="-1"
    data-state="future"
    :data-testid="tid(`session-${type}`)"
  >
    <span class="tz-session__name">{{ name }}</span>
    <template v-if="view.at">
      <span class="tz-session__note" :title="futureHint" :data-testid="tid('available-from')">{{
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
    :data-testid="tid(`session-${type}`)"
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
      class="tz-button tz-button--quiet tz-session__action"
      :class="{ 'tz-button--quiet': action.quiet }"
      :title="action.title"
      :aria-label="action.label"
      :data-testid="tid(action.testid)"
      @click="action.run()"
    >
      <TzIcon :name="action.icon" size="sm" />{{ action.text }}
    </button>

    <span
      v-if="view.kind === 'running'"
      class="tz-session__progress"
      role="progressbar"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-valuenow="pct"
      :aria-label="t('manager.progressLabel', { session: name })"
      :data-testid="tid(`progress-${type}`)"
    >
      <span class="tz-session__bar" :style="barStyle" />
    </span>

    <template v-if="view.kind === 'error'">
      <p class="tz-session__error" :data-testid="tid(`error-${type}`)">
        <TzIcon name="error" size="sm" class="tz-session__error-icon" />{{ t(`manager.error.${view.job.error?.code ?? 'failed'}`) }}
      </p>
      <details v-if="details" class="tz-session__details">
        <summary class="tz-link">
          <TzIcon name="chevron" size="sm" class="tz-session__chevron" />{{ t('manager.details') }}
        </summary>
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
  min-height: var(--tz-space-12);
  padding: var(--tz-space-2) var(--tz-space-1);
  border: 0;
  border-radius: var(--tz-radius-md);
  background: transparent;
  color: var(--tz-text);
  transition:
    background-color var(--tz-dur-fast) var(--tz-ease-standard),
    border-color var(--tz-dur-fast) var(--tz-ease-standard),
    transform var(--tz-dur-fast) var(--tz-ease-standard);
}

/* Lista para ver: toda la fila es el enlace al replay, con el icono de abrir a la derecha; tono al pasar por encima. */
@media (hover: hover) {
  .tz-session.is-link:hover {
    background: var(--tz-surface-2);
  }
}

.tz-session.is-link:active {
  transform: scale(var(--tz-press-scale));
}

/* Recién descargada: un destello de pintura, una sola vez (tz-flash, de base.css). */
.tz-session.is-fresh {
  animation: tz-flash var(--tz-dur-flash) var(--tz-ease-standard);
}

/* No se puede abrir (sin posiciones, entrada no válida o aún por celebrarse): texto tenue. */
.tz-session.is-disabled {
  background: transparent;
  color: var(--tz-text-faint);
  cursor: not-allowed;
}

.tz-session[tabindex='-1']:focus {
  outline: none;
}

.tz-session.is-running,
.tz-session.is-queued {
  background: var(--tz-surface-2);
}

.tz-session.is-error {
  background: var(--tz-surface-2);
}

.tz-session__name {
  flex: 1;
  font-size: var(--tz-text-md);
  font-weight: var(--tz-weight-semibold);
}

.tz-session__size,
.tz-session__note,
.tz-session__pct {
  font-size: var(--tz-text-sm);
  color: var(--tz-text-muted);
}

.tz-session.is-disabled .tz-session__note {
  color: var(--tz-text-faint);
}

.tz-session__size,
.tz-session__pct {
  font-family: var(--tz-font-mono);
  letter-spacing: var(--tz-tracking-mono);
}

.tz-session__go {
  color: var(--tz-text-muted);
  transition: color var(--tz-dur-fast) var(--tz-ease-standard);
}

/* Motivo de «No disponible»: segunda línea, con su icono delante. */
.tz-session__reason {
  display: flex;
  flex-basis: 100%;
  align-items: center;
  gap: var(--tz-space-1);
  font-size: var(--tz-text-xs);
}

.tz-session__action {
  position: relative;
  padding: var(--tz-space-1) var(--tz-space-3);
  font-size: var(--tz-text-sm);
}

/* Zona táctil de la acción y de «Detalles»: crece hasta --tz-hit-min (44 px en iPad) sin mover la fila. */
.tz-session__action::after,
.tz-session__details summary::after {
  content: '';
  position: absolute;
  inset: min(0px, calc((100% - var(--tz-hit-min)) / 2)) 0;
}

.tz-session__progress {
  flex-basis: 100%;
  height: var(--tz-space-1);
  overflow: hidden;
  border-radius: var(--tz-radius-pill);
  background: var(--tz-surface-3);
}

/* Progreso de la descarga (interfaz, no un dato de carrera): sigue al porcentaje con la duración del token. */
.tz-session__bar {
  display: block;
  height: 100%;
  background: var(--tz-accent);
  transform-origin: left center;
  transition: transform var(--tz-dur-base) var(--tz-ease-standard);
}

.tz-session__error {
  display: flex;
  flex-basis: 100%;
  align-items: flex-start;
  gap: var(--tz-space-1);
  margin: 0;
  font-size: var(--tz-text-sm);
  color: var(--tz-text-muted);
}

.tz-session__error-icon {
  margin-top: var(--tz-space-0-5);
  color: var(--tz-danger);
}

.tz-session__details {
  flex-basis: 100%;
  font-size: var(--tz-text-xs);
  color: var(--tz-text-muted);
}

/* «Detalles»: desplegable con aspecto de enlace (.tz-link) y chevron propio en vez del triángulo del navegador. */
.tz-session__details summary {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: var(--tz-space-1);
  list-style: none;
}

.tz-session__details summary::-webkit-details-marker {
  display: none;
}

.tz-session__chevron {
  transform: rotate(-90deg);
  transition: transform var(--tz-dur-fast) var(--tz-ease-standard);
}

.tz-session__details[open] .tz-session__chevron {
  transform: none;
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

/* Insignia de estado: siglas cortas en monoespaciada (DEV, EN COLA, ERROR…). */
.tz-badge {
  padding: var(--tz-space-0-5) var(--tz-space-2);
  border: 1px solid var(--tz-border-strong);
  border-radius: var(--tz-radius-pill);
  font-family: var(--tz-font-mono);
  font-size: var(--tz-text-2xs);
  font-weight: var(--tz-weight-semibold);
  letter-spacing: var(--tz-tracking-mono);
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

/* Hover solo con un puntero que puede «flotar»: en táctil se quedaría pegado tras tocar. */
@media (hover: hover) {
  .tz-session.is-link:hover {
    border-color: var(--tz-accent);
    background: var(--tz-surface-2);
    text-decoration: none;
  }

  .tz-session.is-link:hover .tz-session__go {
    color: var(--tz-accent);
  }
}
</style>
