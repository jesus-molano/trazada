<script setup lang="ts">
/**
 * «Centrar» (D53) en el grupo «Cámara» de las herramientas de escena: vuelve a la vista general por defecto (también
 * desde el seguimiento o la realización), con su tecla (C). Deshabilitado con la vista ya en su sitio.
 */
import { usePlaybackStore } from '~/stores/playback'
import { useTvStore } from '~/stores/tv'
import { useViewStore } from '~/stores/view'

const { t } = useI18n()
const view = useViewStore()
const playback = usePlaybackStore()
const tv = useTvStore()
const moved = computed(() => view.moved || playback.following || tv.active)
</script>

<script lang="ts">
/** Hueco `scene-tools` (D29), grupo «Cámara», antes de la realización. */
export const order = 5
export const group = 'camera'
</script>

<template>
  <span class="tz-center-tool" data-testid="center-tool">
    <button type="button" class="tz-center-tool__button" :disabled="!moved" :title="t('view.centerHint')" data-testid="center-tool-button" @click="view.recenter()">
      <TzIcon name="recenter" />{{ t('view.center') }}
    </button>
    <kbd class="tz-center-tool__key" :title="t('view.keyHint')" :aria-label="t('view.keyHint')">{{ t('view.key') }}</kbd>
  </span>
</template>

<style scoped>
.tz-center-tool {
  display: inline-flex;
  align-items: center;
  gap: var(--tz-space-1);
  min-width: 0;
}

.tz-center-tool__button {
  display: inline-flex;
  align-items: center;
  gap: var(--tz-space-1);
  min-height: var(--tz-hit-min);
  padding: 0 var(--tz-space-2);
  border: 1px solid var(--tz-border);
  border-radius: var(--tz-radius-sm);
  background: var(--tz-surface-1);
  color: var(--tz-text);
  font-size: var(--tz-text-xs);
  cursor: pointer;
}

.tz-center-tool__button:disabled {
  color: var(--tz-text-muted);
  cursor: default;
}

.tz-center-tool__key {
  padding: 0 var(--tz-space-1);
  border: 1px solid var(--tz-border);
  border-radius: var(--tz-radius-sm);
  background: var(--tz-surface-1);
  color: var(--tz-text-muted);
  font-family: var(--tz-font-mono);
  font-size: var(--tz-text-xs);
}
</style>
