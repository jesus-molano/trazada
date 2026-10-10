<script setup lang="ts">
/**
 * Herramientas de la escena: exageración de altura, separación visual de coches, la explicación de qué es
 * dato y qué es modelo en lo que se dibuja («Cómo se dibuja») y las etiquetas "Estimado" de lo que la escena
 * pinta sin ser dato real (opciones del usuario y campos del manifest).
 */
import { sceneManifestFields } from '~/engine/estimated'
import { ELEVATION_SCALES, useSettingsStore } from '~/stores/settings'

const props = defineProps<{ flat: boolean; estimated: readonly string[] }>()
const { t } = useI18n()
const settings = useSettingsStore()
const yScale = computed(() => (props.flat ? 1 : settings.elevationScale))
const manifestFields = computed(() => sceneManifestFields(props.estimated))

/** «Cómo se dibuja»: primero lo que viene de la fuente y después lo que pone el modelo. */
const HOW_DATA = ['positions', 'timing'] as const
const HOW_MODEL = ['interpolation', 'centreLine', 'forward', 'width', 'car', 'estimated'] as const
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
    <TzDisclosure :label="t('howDrawn.button')" testid="how-drawn">
      <p class="tz-how__title">{{ t('howDrawn.title') }}</p>
      <p id="tz-how-data" class="tz-how__heading">{{ t('howDrawn.dataTitle') }}</p>
      <ul class="tz-how__list" aria-labelledby="tz-how-data">
        <li v-for="k in HOW_DATA" :key="k" :data-item="k">{{ t(`howDrawn.${k}`) }}</li>
      </ul>
      <p id="tz-how-model" class="tz-how__heading">{{ t('howDrawn.modelTitle') }}</p>
      <ul class="tz-how__list" aria-labelledby="tz-how-model">
        <li v-for="k in HOW_MODEL" :key="k" :data-item="k">{{ t(`howDrawn.${k}`) }}</li>
      </ul>
    </TzDisclosure>
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

.tz-how__title {
  margin: 0 0 var(--tz-space-2);
  font-weight: var(--tz-weight-semibold);
}

.tz-how__heading {
  margin: var(--tz-space-2) 0 var(--tz-space-1);
  font-size: var(--tz-text-xs);
  font-weight: var(--tz-weight-semibold);
  color: var(--tz-text-muted);
}

.tz-how__list {
  display: grid;
  gap: var(--tz-space-1);
  margin: 0;
  padding-left: var(--tz-space-4);
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
