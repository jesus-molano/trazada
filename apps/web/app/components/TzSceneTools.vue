<script setup lang="ts">
/**
 * Herramientas de la escena: exageración de altura, separación visual de coches y las etiquetas
 * "Estimado" de lo que la escena pinta sin ser dato real (opciones del usuario y campos del manifest).
 */
import { sceneManifestFields } from '~/engine/estimated'
import { ELEVATION_SCALES, useSettingsStore } from '~/stores/settings'

const props = defineProps<{ flat: boolean; estimated: readonly string[] }>()
const { t } = useI18n()
const settings = useSettingsStore()
const yScale = computed(() => (props.flat ? 1 : settings.elevationScale))
const manifestFields = computed(() => sceneManifestFields(props.estimated))
</script>

<template>
  <div class="tz-tools" data-testid="scene-tools">
    <div class="tz-tools__group" role="group" :aria-label="t('scene.elevation')">
      <span class="tz-tools__label">{{ t('scene.elevation') }}</span>
      <button
        v-for="k in ELEVATION_SCALES"
        :key="k"
        type="button"
        class="tz-tools__btn tz-tabular"
        :aria-pressed="yScale === k"
        :disabled="flat"
        :data-testid="`elevation-${k}`"
        @click="settings.setElevationScale(k)"
      >
        ×{{ k }}
      </button>
    </div>
    <button
      type="button"
      class="tz-tools__btn tz-tools__toggle"
      :aria-pressed="settings.separation"
      :title="t('scene.separationHint')"
      data-testid="toggle-separation"
      @click="settings.setSeparation(!settings.separation)"
    >
      {{ t('scene.separation') }}
    </button>
    <span v-if="flat" class="tz-tools__flat" :title="t('scene.flatHint')">{{ t('scene.flat') }}</span>
    <div class="tz-tools__estimated">
      <TzEstimated v-if="!flat && yScale !== 1" field="elevation" :params="{ k: yScale }" />
      <TzEstimated v-if="settings.separation" field="separation" />
      <TzEstimated v-for="f in manifestFields" :key="f" :field="f" />
    </div>
  </div>
</template>

<style scoped>
.tz-tools {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: center;
  gap: var(--tz-space-2);
}

.tz-tools__group {
  display: inline-flex;
  align-items: center;
  gap: var(--tz-space-1);
  padding: 2px;
  border: 1px solid var(--tz-border);
  border-radius: var(--tz-radius-md);
  background: var(--tz-overlay);
}

.tz-tools__label {
  padding: 0 var(--tz-space-2);
  font-size: var(--tz-text-xs);
  color: var(--tz-text-muted);
}

.tz-tools__btn {
  min-width: 30px;
  height: 26px;
  border: 1px solid transparent;
  border-radius: var(--tz-radius-sm);
  background: transparent;
  font-size: var(--tz-text-xs);
  font-weight: var(--tz-weight-semibold);
  cursor: pointer;
  transition: background-color var(--tz-dur-fast) var(--tz-ease-standard);
}

.tz-tools__toggle {
  padding: 0 var(--tz-space-2);
  border-color: var(--tz-border);
  background: var(--tz-overlay);
}

.tz-tools__btn[aria-pressed='true'] {
  border-color: var(--tz-accent);
  background: var(--tz-accent-soft);
  color: var(--tz-accent-strong);
}

.tz-tools__btn:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.tz-tools__flat {
  font-size: var(--tz-text-xs);
  color: var(--tz-text-muted);
}

.tz-tools__estimated {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--tz-space-1);
  flex-basis: 100%;
}

.tz-tools__estimated:empty {
  display: none;
}
</style>
