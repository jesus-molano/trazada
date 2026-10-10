<script setup lang="ts">
/**
 * Herramientas de la escena: exageración de altura, separación visual de coches, las de cada función agrupadas en
 * «Capas» y «Cámara» (hueco `components/scene-tools/`, D29), la explicación de qué es dato y qué es modelo en lo que
 * se dibuja («Cómo se dibuja») y las etiquetas "Estimado" de lo que la escena pinta sin ser dato real (opciones del
 * usuario y campos del manifest).
 *
 * Cada grupo del hueco es un menú (un botón que despliega sus controles): así la cabecera ocupa lo mismo por muchas
 * herramientas que tenga el grupo y sigue cabiendo en una fila a 1280 px (con una cabecera partida, la escena y la
 * telemetría pierden alto).
 */
import type { IconName } from '~/design/icons'
import { isEstimatedField, sceneManifestFields } from '~/engine/estimated'
import { SEGMENT_GAP_MS } from '~/engine/interp/hermite'
import { TRACK_WIDTH_M } from '~/engine/track/ribbon'
import { SCENE_TOOLS, type SceneToolGroup } from '~/slots/scene-tools'
import { ELEVATION_SCALES, useSettingsStore } from '~/stores/settings'

const GROUP_ICONS: Record<SceneToolGroup, IconName> = { layers: 'layers', camera: 'camera' }

const props = defineProps<{ flat: boolean; estimated: readonly string[] }>()
const { t } = useI18n()
const settings = useSettingsStore()
const yScale = computed(() => (props.flat ? 1 : settings.elevationScale))
const manifestFields = computed(() => sceneManifestFields(props.estimated))

/** «Cómo se dibuja»: primero lo que viene de la fuente y después lo que pone el modelo. */
const HOW_DATA = ['positions', 'timing'] as const
const HOW_MODEL = ['interpolation', 'centreLine', 'pit', 'forward', 'width', 'car', 'estimated'] as const
/** Las cifras salen de las constantes que usa el motor: si cambian allí, el texto no se queda atrás. */
const HOW_PARAMS: Partial<Record<(typeof HOW_MODEL)[number], Record<string, number>>> = {
  interpolation: { s: SEGMENT_GAP_MS / 1000 },
  width: { m: TRACK_WIDTH_M },
}
/**
 * Lo que el manifest declara estimado en esta sesión (p. ej., posiciones reconstruidas en una sesión dev): la
 * lista de «dato de la fuente» no puede presentarlo como dato, así que se avisa justo debajo, con su explicación.
 */
const estimatedHint = (f: string) => (isEstimatedField(f) ? t(`estimated.hints.${f}`) : t('estimated.hintUnknown'))
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
    <TzDisclosure
      v-for="g in SCENE_TOOLS"
      :key="g.group"
      :label="t(`scene.toolGroups.${g.group}`)"
      :icon="GROUP_ICONS[g.group]"
      :testid="`tools-${g.group}`"
      tools
    >
      <div
        class="tz-tools__menu"
        role="group"
        :aria-label="t(`scene.toolGroups.${g.group}`)"
        :data-testid="`tool-group-${g.group}`"
      >
        <component :is="tool.component" v-for="tool in g.tools" :key="tool.name" />
      </div>
    </TzDisclosure>
    <TzDisclosure :label="t('howDrawn.button')" testid="how-drawn">
      <p class="tz-how__title">{{ t('howDrawn.title') }}</p>
      <p id="tz-how-data" class="tz-how__heading">{{ t('howDrawn.dataTitle') }}</p>
      <ul class="tz-how__list" aria-labelledby="tz-how-data">
        <li v-for="k in HOW_DATA" :key="k" :data-item="k">{{ t(`howDrawn.${k}`) }}</li>
      </ul>
      <template v-if="estimated.length">
        <p id="tz-how-estimated" class="tz-how__heading" data-item="sessionEstimated">{{ t('howDrawn.sessionEstimated') }}</p>
        <ul class="tz-how__list" aria-labelledby="tz-how-estimated">
          <li v-for="f in estimated" :key="f" :data-estimated="f">
            <span class="tz-how__tag">{{ t('estimated.tag') }}</span> {{ estimatedHint(f) }}
          </li>
        </ul>
      </template>
      <p id="tz-how-model" class="tz-how__heading">{{ t('howDrawn.modelTitle') }}</p>
      <ul class="tz-how__list" aria-labelledby="tz-how-model">
        <li v-for="k in HOW_MODEL" :key="k" :data-item="k">{{ t(`howDrawn.${k}`, HOW_PARAMS[k] ?? {}) }}</li>
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

/* Controles de un grupo del hueco, uno por línea dentro de su menú. */
.tz-tools__menu {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--tz-space-2);
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

.tz-how__tag {
  font-weight: var(--tz-weight-semibold);
  color: var(--tz-estimated);
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
