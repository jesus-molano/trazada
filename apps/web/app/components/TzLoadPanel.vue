<script setup lang="ts">
import { useSessionStore } from '~/stores/session'

const { t } = useI18n()
const session = useSessionStore()

const percent = computed(() => Math.round(session.progress * 100))
const retriable = computed(() => session.error && ['network', 'corrupt', 'decode'].includes(session.error.code))

function reload() {
  window.location.reload()
}
</script>

<template>
  <!-- Panel sobre la escena: fondo --tz-overlay, sin backdrop-filter (desenfocar un lienzo animado cuesta). -->
  <div class="tz-load" data-testid="load-panel" :data-state="session.status">
    <template v-if="session.status === 'loading'">
      <p class="tz-load__stage" aria-live="polite">{{ t(`replay.stage.${session.stage}`) }}</p>
      <div
        class="tz-load__bar"
        role="progressbar"
        :aria-label="t('replay.progressLabel')"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-valuenow="percent"
        data-testid="load-progress"
      >
        <div class="tz-load__fill" :style="{ transform: `scaleX(${session.progress})` }" />
      </div>
      <p class="tz-load__percent tz-tabular">{{ percent }} %</p>
    </template>

    <div
      v-else-if="session.status === 'error' && session.error"
      class="tz-load__error"
      role="alert"
      data-testid="load-error"
      :data-code="session.error.code"
    >
      <p class="tz-load__message">
        <TzIcon name="error" class="tz-load__icon" />{{ t(`replay.error.${session.error.code}`) }}
      </p>
      <p class="tz-load__detail">{{ session.error.message }}</p>
      <div class="tz-load__actions">
        <button v-if="retriable" type="button" class="tz-button" data-testid="load-retry" @click="session.retry()">
          <TzIcon name="retry" size="sm" />{{ t('replay.retry') }}
        </button>
        <button
          v-if="session.error.code === 'unsupported-version'"
          type="button"
          class="tz-button"
          data-testid="load-reload"
          @click="reload"
        >
          <TzIcon name="retry" size="sm" />{{ t('replay.reload') }}
        </button>
        <NuxtLink to="/" class="tz-button tz-button--quiet" data-testid="load-back">
          <TzIcon name="back" size="sm" />{{ t('replay.back') }}
        </NuxtLink>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tz-load {
  width: min(440px, calc(100vw - 2 * var(--tz-space-6)));
  padding: var(--tz-space-6);
  border: 1px solid var(--tz-border);
  border-radius: var(--tz-radius-lg);
  background: var(--tz-overlay);
  box-shadow: var(--tz-shadow-panel);
  /*
   * Aparece subiendo un poco (--tz-shift, 0 con prefers-reduced-motion), sin fundido: un error se lee entero desde
   * el primer frame. Después solo cambia el progreso.
   */
  animation: rise var(--tz-dur-base) var(--tz-ease-enter) backwards;
}

@keyframes rise {
  from {
    transform: translateY(var(--tz-shift));
  }
}

/* Fase de la carga: rótulo condensado en mayúsculas, como el título de un panel. */
.tz-load__stage {
  margin: 0 0 var(--tz-space-3);
  font-family: var(--tz-font-display);
  font-size: var(--tz-text-lg);
  font-weight: var(--tz-weight-semibold);
  letter-spacing: var(--tz-tracking-display);
  text-transform: uppercase;
}

.tz-load__message {
  display: flex;
  align-items: flex-start;
  gap: var(--tz-space-2);
  margin: 0 0 var(--tz-space-3);
  font-weight: var(--tz-weight-semibold);
}

.tz-load__icon {
  margin-top: var(--tz-space-0-5);
  color: var(--tz-danger);
}

.tz-load__bar {
  height: 6px;
  border-radius: var(--tz-radius-pill);
  background: var(--tz-surface-3);
  overflow: hidden;
}

/* Progreso de la carga (interfaz, no un dato de carrera): sigue al porcentaje con la duración del token. */
.tz-load__fill {
  height: 100%;
  background: var(--tz-accent);
  transform-origin: left center;
  transition: transform var(--tz-dur-base) var(--tz-ease-standard);
}

.tz-load__percent {
  margin: var(--tz-space-2) 0 0;
  font-family: var(--tz-font-mono);
  font-size: var(--tz-text-sm);
  letter-spacing: var(--tz-tracking-mono);
  color: var(--tz-text-muted);
  text-align: end;
}

.tz-load__detail {
  margin: 0 0 var(--tz-space-4);
  font-family: var(--tz-font-mono);
  font-size: var(--tz-text-xs);
  color: var(--tz-text-faint);
  overflow-wrap: anywhere;
}

.tz-load__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--tz-space-2);
}
</style>
