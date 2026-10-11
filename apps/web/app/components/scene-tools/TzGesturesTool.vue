<script setup lang="ts">
/**
 * Gestos de la escena (ítem 17, D43) en el grupo «Cámara» de las herramientas: la pista «ⓘ» que los explica (en iPad un
 * `title` no se ve nunca). Doble toque o doble clic para seguir un coche, dos dedos en horizontal para mover el reloj
 * (la escala sale de la constante del motor), el pellizco para el zoom y dos dedos en vertical para el mapa.
 */
import { SCRUB_WINDOW_MS } from '~/engine/gestures/twoFinger'

const { t } = useI18n()

const hint = computed(() =>
  [t('gestures.hint.follow'), t('gestures.hint.scrub', { min: SCRUB_WINDOW_MS / 60_000 }), t('gestures.hint.pinch'), t('gestures.hint.map')].join(' '),
)
</script>

<script lang="ts">
/** Hueco `scene-tools` (D29), grupo «Cámara», detrás de la realización automática. */
export const order = 20
export const group = 'camera'
</script>

<template>
  <span class="tz-gestures-tool" data-testid="gestures-tool">
    <span class="tz-gestures-tool__label">{{ t('gestures.name') }}</span>
    <TzHint :label="t('gestures.hintLabel')" :text="hint" testid="gestures-hint" align="end" />
  </span>
</template>

<style scoped>
.tz-gestures-tool {
  display: inline-flex;
  align-items: center;
  gap: var(--tz-space-1);
}

.tz-gestures-tool__label {
  font-size: var(--tz-text-xs);
  color: var(--tz-text-muted);
}
</style>
