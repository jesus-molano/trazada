<script setup lang="ts">
/**
 * Herramientas de la escena: exageración de altura, separación visual de coches, las de cada función agrupadas en
 * «Capas» y «Cámara» (hueco `components/scene-tools/`, D29), la explicación de qué es dato y qué es modelo en lo que
 * se dibuja («Cómo se dibuja») y las etiquetas "Estimado" de lo que la escena pinta sin ser dato real (opciones del
 * usuario, campos del manifest y lo que declaran las capas del hueco en `stores/sceneEstimated.ts`: sus herramientas
 * van en menús plegados, y la etiqueta tiene que verse mientras se pinta).
 *
 * Cada grupo del hueco es un menú (un botón que despliega sus controles): así la cabecera ocupa lo mismo por muchas
 * herramientas que tenga el grupo y sigue cabiendo en una fila a 1280 px (con una cabecera partida, la escena y la
 * telemetría pierden alto). Con la meteorología y el grupo «Cámara» (Tanda 3), por debajo de 1600 px esos menús van
 * solo con su icono («Cómo se dibuja», por debajo de 1920 px) y, por debajo de 1360 px, «Altura» y «Separar coches»
 * también (ver los estilos).
 *
 * Las etiquetas «Estimado» de la escena no van en la fila de la cabecera (la partían en dos): flotan justo debajo de
 * ella, sobre el mapa (lo que describen), a la izquierda de la columna derecha y siempre a la vista; cada una se pulsa
 * para ver por qué es estimada. La página da su sitio con `--replay-over-right` (TzReplay.vue) y las quita
 * mientras la hoja de análisis tapa la escena entera (no describen nada a la vista ni flotan sobre la hoja).
 */
import type { IconName } from '~/design/icons'
import { isEstimatedField, sceneManifestFields } from '~/engine/estimated'
import { SEGMENT_GAP_MS } from '~/engine/interp/hermite'
import { TRAIL_SPAN_MS } from '~/engine/replay/trail'
import { MAX_SAMPLE_AGE_MS } from '~/engine/telemetry/telemetry'
import { CHEVRON_EVERY_M } from '~/engine/track/detail'
import { TRACK_WIDTH_M } from '~/engine/track/ribbon'
import { WEATHER_STALE_MS } from '~/engine/weather/weather'
import { SCENE_TOOLS, type SceneToolGroup } from '~/slots/scene-tools'
import { useSceneEstimatedStore } from '~/stores/sceneEstimated'
import { ELEVATION_SCALES, useSettingsStore } from '~/stores/settings'

const GROUP_ICONS: Record<SceneToolGroup, IconName> = { layers: 'layers', camera: 'camera' }

const props = defineProps<{ flat: boolean; estimated: readonly string[] }>()
const { t } = useI18n()
const settings = useSettingsStore()
const sceneEstimated = useSceneEstimatedStore()
const yScale = computed(() => (props.flat ? 1 : settings.elevationScale))
const manifestFields = computed(() => sceneManifestFields(props.estimated))

/**
 * «Cómo se dibuja»: primero lo que viene de la fuente y después lo que pone el modelo, también el de cada capa o
 * herramienta (estelas, zonas de DRS, colores de sector, comparación y fantasma, meteorología y cielo), la misma lista
 * que «Qué es dato y qué es modelo» del README. Cada herramienta, además, lleva su ⓘ y su «Estimado».
 */
const HOW_DATA = ['positions', 'timing'] as const
const HOW_MODEL = [
  'interpolation',
  'centreLine',
  'pit',
  'forward',
  'width',
  'car',
  'trails',
  'drs',
  'sectors',
  'trackDetail',
  'compare',
  'weather',
  'estimated',
] as const
/** Las cifras salen de las constantes que usa el motor: si cambian allí, el texto no se queda atrás. */
const HOW_PARAMS: Partial<Record<(typeof HOW_MODEL)[number], Record<string, number>>> = {
  interpolation: { s: SEGMENT_GAP_MS / 1000 },
  width: { m: TRACK_WIDTH_M },
  trackDetail: { m: CHEVRON_EVERY_M },
  trails: { s: TRAIL_SPAN_MS / 1000, age: MAX_SAMPLE_AGE_MS / 1000 },
  weather: { s: WEATHER_STALE_MS / 1000 },
}
/**
 * Lo que el manifest declara estimado en esta sesión (p. ej., posiciones reconstruidas en una sesión dev): la
 * lista de «dato de la fuente» no puede presentarlo como dato, así que se avisa justo debajo, con su explicación.
 */
const estimatedHint = (f: string) => (isEstimatedField(f) ? t(`estimated.hints.${f}`) : t('estimated.hintUnknown'))
</script>

<template>
  <div class="tz-tools" data-testid="scene-tools">
    <div class="tz-tools__group" role="group" :aria-label="t('scene.elevation')" :title="t('scene.elevation')">
      <span class="tz-tools__label">{{ t('scene.elevation') }}</span>
      <TzIcon name="elevation" size="sm" class="tz-tools__label-icon" />
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
      :aria-label="t('scene.separation')"
      :title="t('scene.separationHint')"
      data-testid="toggle-separation"
      @click="settings.setSeparation(!settings.separation)"
    >
      <TzIcon name="separation" size="sm" class="tz-tools__toggle-icon" />
      <span class="tz-tools__toggle-text">{{ t('scene.separation') }}</span>
    </button>
    <span v-if="flat" class="tz-tools__flat" :title="t('scene.flatHint')">{{ t('scene.flat') }}</span>
    <TzDisclosure
      v-for="g in SCENE_TOOLS"
      :key="g.group"
      :label="t(`scene.toolGroups.${g.group}`)"
      :name="t(`scene.toolGroups.${g.group}`)"
      :icon="GROUP_ICONS[g.group]"
      :testid="`tools-${g.group}`"
      tools
    >
      <template #label>
        <span class="tz-tools__menu-text">{{ t(`scene.toolGroups.${g.group}`) }}</span>
      </template>
      <div
        class="tz-tools__menu"
        role="group"
        :aria-label="t(`scene.toolGroups.${g.group}`)"
        :data-testid="`tool-group-${g.group}`"
      >
        <component :is="tool.component" v-for="tool in g.tools" :key="tool.name" />
      </div>
    </TzDisclosure>
    <TzDisclosure :label="t('howDrawn.button')" :name="t('howDrawn.button')" testid="how-drawn">
      <template #label>
        <span class="tz-tools__how-text">{{ t('howDrawn.button') }}</span>
      </template>
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
    <div class="tz-tools__estimated" data-testid="scene-estimated">
      <TzEstimated v-if="!flat && yScale !== 1" field="elevation" :params="{ k: yScale }" />
      <TzEstimated v-if="settings.separation" field="separation" />
      <TzEstimated v-for="f in manifestFields" :key="f" :field="f" />
      <TzEstimated v-for="l in sceneEstimated.labels" :key="`layer-${l.field}`" :field="l.field" :params="l.params" />
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
  gap: var(--tz-space-0-5);
  height: 28px;
  padding: var(--tz-space-0-5);
  border: 0;
  border-radius: var(--tz-radius-md);
  background: var(--tz-surface-2);
}

.tz-tools__label {
  padding: 0 var(--tz-space-2);
  font-size: var(--tz-text-xs);
  color: var(--tz-text-muted);
}

.tz-tools__label-icon {
  display: none;
  margin: 0 var(--tz-space-1);
  color: var(--tz-text-muted);
}

.tz-tools__toggle-icon {
  display: none;
  vertical-align: middle;
}

/*
 * La cabecera tiene que caber en una fila (si se parte, la escena y la telemetría pierden alto). Por debajo de
 * 1600 px, los menús «Capas» y «Cámara» solo con su icono, como Análisis y la meteorología (el nombre accesible y el
 * título siguen ahí), y «Altura» y «Separar coches» pasan a su icono (el grupo y el botón conservan su nombre
 * accesible y su título), como en la lámina de D50.
 */
@media (width < 1600px) {
  .tz-tools__menu-text,
  .tz-tools__label,
  .tz-tools__toggle-text {
    display: none;
  }

  .tz-tools__label-icon,
  .tz-tools__toggle-icon {
    display: inline-block;
  }
}

/* «Cómo se dibuja»: siempre solo el icono (D50); el nombre accesible y el título dicen qué abre. */
.tz-tools__how-text {
  display: none;
}

/* Controles de un grupo del hueco, uno por línea dentro de su menú. */
.tz-tools__menu {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--tz-space-2);
}

.tz-tools__btn {
  position: relative;
  min-width: 30px;
  height: 22px;
  border: 1px solid transparent;
  border-radius: var(--tz-radius-sm);
  background: transparent;
  font-size: var(--tz-text-xs);
  font-weight: var(--tz-weight-medium);
  cursor: pointer;
  transition: background-color var(--tz-dur-fast) var(--tz-ease-standard);
}

/* Zona táctil de --tz-hit-min con puntero grueso, sin mover el layout. */
.tz-tools__btn::after {
  content: '';
  position: absolute;
  inset: min(0px, calc((100% - var(--tz-hit-min)) / 2)) 0;
}

/* «Separar coches»: fantasma, como los demás botones de la cabecera (D50); activado, placa. */
.tz-tools__toggle {
  height: 28px;
  padding: 0 var(--tz-space-2);
  color: var(--tz-text-muted);
  font-size: var(--tz-text-sm);
}

/* Activado: placa maciza de pintura (D47); desplegado (los menús) conserva el relleno suave. */
.tz-tools__btn[aria-pressed='true'] {
  border-color: var(--tz-accent);
  background: var(--tz-accent);
  color: var(--tz-accent-on);
}

@media (hover: hover) {
  .tz-tools__btn:hover:not(:disabled, [aria-pressed='true']) {
    background: var(--tz-surface-3);
  }
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

/*
 * Etiquetas «Estimado» de la escena: fuera de la fila de la cabecera (no la parten en dos), justo debajo y sobre el
 * mapa, alineadas a la izquierda de la columna derecha. El bloque que las posiciona es la cabecera de la página
 * (`.tz-replay__bar`, con posición relativa); las variables `--replay-over-*` las pone la página (por defecto, a la
 * derecha y sin límite de ancho). Con la realización automática, bajan una fila (`--replay-over-top`).
 */
.tz-tools__estimated {
  position: absolute;
  top: calc(100% + var(--replay-over-top, var(--tz-space-1)));
  right: var(--replay-over-right, 0);
  /* La página las quita mientras la hoja de análisis tapa la escena (`--replay-over-display`). */
  display: var(--replay-over-display, flex);
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--tz-space-1);
  max-width: var(--replay-over-max, none);
}

.tz-tools__estimated:empty {
  display: none;
}

/* Sobre la escena, con el fondo de los paneles para leerse. */
.tz-tools__estimated > .tz-estimated {
  background: var(--tz-overlay);
}
</style>
