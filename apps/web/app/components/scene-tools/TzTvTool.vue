<script setup lang="ts">
/**
 * Realización automática (ítem 9, D39): «No / Sí» en el grupo «Cámara» de las herramientas de escena, con la tecla
 * que la enciende (L) y la pista «ⓘ» de qué elige y por qué: la cifra solo sale de la torre oficial; por cercanía en
 * pista, ninguna. En iPad, además, el botón de la cabecera (`replay-header/TzTvButton.vue`).
 */
import { CUT_MIN_MS, DUEL_MAX_MS } from '~/engine/camera/Director'
import { useTvStore } from '~/stores/tv'

const { t } = useI18n()
const tv = useTvStore()

const hint = computed(() =>
  [
    t('tv.hint.what', { s: DUEL_MAX_MS / 1000 }),
    t('tv.hint.number'),
    t('tv.hint.neutral'),
    t('tv.hint.cuts', { s: CUT_MIN_MS / 1000 }),
    t('tv.hint.exit'),
  ].join(' '),
)
</script>

<script lang="ts">
/** Hueco `scene-tools` (D29), grupo «Cámara». */
export const order = 10
export const group = 'camera'
</script>

<template>
  <span class="tz-tv-tool" data-testid="tv-tool">
    <span id="tz-tv-label" class="tz-tv-tool__label">{{ t('tv.name') }}</span>
    <span class="tz-segmented" role="group" aria-labelledby="tz-tv-label">
      <button type="button" :aria-pressed="!tv.active" data-testid="tv-off" @click="tv.stop('toggle')">
        {{ t('tv.off') }}
      </button>
      <button type="button" :aria-pressed="tv.active" :disabled="!tv.available" data-testid="tv-on" @click="tv.start()">
        {{ t('tv.on') }}
      </button>
    </span>
    <kbd class="tz-tv-tool__key" :title="t('tv.keyHint')" :aria-label="t('tv.keyHint')">{{ t('tv.key') }}</kbd>
    <TzHint :label="t('tv.hintLabel')" :text="hint" testid="tv-hint" align="end" />
  </span>
</template>

<style scoped>
.tz-tv-tool {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--tz-space-1);
  min-width: 0;
}

.tz-tv-tool__label {
  font-size: var(--tz-text-xs);
  color: var(--tz-text-muted);
}

.tz-tv-tool__key {
  padding: 0 var(--tz-space-1);
  border: 1px solid var(--tz-border);
  border-radius: var(--tz-radius-sm);
  background: var(--tz-surface-1);
  color: var(--tz-text-muted);
  font-family: var(--tz-font-mono);
  font-size: var(--tz-text-xs);
}
</style>
