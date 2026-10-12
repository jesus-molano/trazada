<script setup lang="ts">
/**
 * Detalle del trazado (D50, lámina 5) en el grupo «Capas» de las herramientas de escena: «Relieve» (faldones hasta el
 * suelo; con la pista plana no hay, y se deshabilita) y «Retícula» (suelo cada 100 m, decorativa), cada uno con
 * «No / Sí». Encendidos por defecto y recordados por navegador (`stores/trackDetail.ts`). La pista «ⓘ» dice qué es dato
 * y qué es decorativo; «Cómo se dibuja» lo repite con el resto del trazado.
 */
import { getRuntime } from '~/stores/playback'
import { useTrackDetailStore } from '~/stores/trackDetail'

/** Sin altitud fiable, la pista es plana: no hay relieve que enseñar. */
const flat = getRuntime()?.session.manifest.channels?.elevation === 'flat'

const { t } = useI18n()
const detail = useTrackDetailStore()
onMounted(() => detail.hydrate())
</script>

<script lang="ts">
export const order = 12
export const group = 'layers'
</script>

<template>
  <span class="tz-detail-tool" data-testid="track-detail-tool">
    <span class="tz-detail-tool__row">
      <span id="tz-detail-relief" class="tz-detail-tool__label">{{ t('scene.detail.relief') }}</span>
      <span class="tz-segmented" role="group" aria-labelledby="tz-detail-relief">
        <button type="button" :aria-pressed="!detail.relief" data-testid="relief-off" @click="detail.setRelief(false)">
          {{ t('scene.detail.off') }}
        </button>
        <button type="button" :aria-pressed="detail.relief" :disabled="flat" data-testid="relief-on" @click="detail.setRelief(true)">
          {{ t('scene.detail.on') }}
        </button>
      </span>
    </span>
    <span class="tz-detail-tool__row">
      <span id="tz-detail-grid" class="tz-detail-tool__label">{{ t('scene.detail.grid') }}</span>
      <span class="tz-segmented" role="group" aria-labelledby="tz-detail-grid">
        <button type="button" :aria-pressed="!detail.grid" data-testid="grid-off" @click="detail.setGrid(false)">
          {{ t('scene.detail.off') }}
        </button>
        <button type="button" :aria-pressed="detail.grid" data-testid="grid-on" @click="detail.setGrid(true)">
          {{ t('scene.detail.on') }}
        </button>
      </span>
    </span>
    <TzHint :label="t('scene.detail.hintLabel')" :text="t('scene.detail.hint')" testid="track-detail-hint" align="end" />
  </span>
</template>

<style scoped>
.tz-detail-tool {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--tz-space-2);
  min-width: 0;
}

.tz-detail-tool__row {
  display: inline-flex;
  align-items: center;
  gap: var(--tz-space-1);
}

.tz-detail-tool__label {
  font-size: var(--tz-text-xs);
  color: var(--tz-text-muted);
}
</style>
