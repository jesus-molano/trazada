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
v-else-if="session.status === 'error' && session.error" role="alert" data-testid="load-error"
      :data-code="session.error.code">
      <p class="tz-load__message">{{ t(`replay.error.${session.error.code}`) }}</p>
      <p class="tz-load__detail">{{ session.error.message }}</p>
      <div class="tz-load__actions">
        <button v-if="retriable" type="button" class="tz-button" data-testid="load-retry" @click="session.retry()">
          {{ t('replay.retry') }}
        </button>
        <button
          v-if="session.error.code === 'unsupported-version'"
          type="button"
          class="tz-button"
          data-testid="load-reload"
          @click="reload"
        >
          {{ t('replay.reload') }}
        </button>
        <NuxtLink to="/" class="tz-button tz-button--quiet">{{ t('replay.back') }}</NuxtLink>
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
  backdrop-filter: blur(8px);
  box-shadow: var(--tz-shadow-panel);
}

.tz-load__stage,
.tz-load__message {
  margin: 0 0 var(--tz-space-3);
  font-weight: var(--tz-weight-semibold);
}

.tz-load__bar {
  height: 6px;
  border-radius: var(--tz-radius-pill);
  background: var(--tz-surface-3);
  overflow: hidden;
}

.tz-load__fill {
  height: 100%;
  background: var(--tz-accent);
  transform-origin: left center;
  transition: transform var(--tz-dur-base) var(--tz-ease-standard);
}

.tz-load__percent {
  margin: var(--tz-space-2) 0 0;
  font-size: var(--tz-text-sm);
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
