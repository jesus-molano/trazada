<script setup lang="ts">
/**
 * Lo que la ficha de una serie de las gráficas de análisis cuenta del coche (D49), con `engine/analysis/carStory.ts`,
 * hasta el corte de la pestaña («Sin spoilers»):
 *
 * - Si dejó de pasar por meta (`stopped`): su último paso, la entrada al pit lane en esa vuelta si la hubo y que
 *   después no hay más pasos en los datos, sin decir por qué (la fuente no lo dice).
 * - Hasta dos mensajes de dirección de carrera que lo nombran (incidente, coche detenido, trompo, sanción, banderas
 *   negras), con su texto original en inglés y su clase, del más reciente al más antiguo, y cuántos más hay. En la
 *   forma corta de la ficha (`compact`: no cabe en el alto de la gráfica), solo el más reciente, en una línea, y lo del
 *   detenido seguido, en un solo párrafo.
 *
 * Va dentro de la ficha (un `role="tooltip"` con el ratón): sin controles.
 */
import type { RaceControlEvent } from '@trazada/schema'
import { CAR_STORY_MAX, carStory } from '~/engine/analysis/carStory'
import { rcTone } from '~/replay/rcKinds'
import { getRuntime } from '~/stores/playback'

const props = defineProps<{ car: string; cutoffMs: number; stopped: boolean; compact?: boolean }>()

const { t, te } = useI18n()
const rt = getRuntime()!
const st = useAnalysis()
const story = computed(() => carStory(st.table, rt.raceControl, props.car, props.cutoffMs, props.compact ? 1 : CAR_STORY_MAX))
const lapText = (lap: number) => t('analysis.lapShort', { lap })

function kindLabel(e: RaceControlEvent): string {
  const key = `rc.kind.${e.parsed.kind}`
  return te(key) ? t(key) : t('rc.kind.other')
}
</script>

<template>
  <div class="tz-story" data-testid="analysis-card-story">
    <div v-if="stopped && story.lastLap !== null" class="tz-story__stop" :class="{ 'is-inline': compact }">
      <p data-testid="analysis-card-last">{{ t('analysis.card.lastCrossing', { x: lapText(story.lastLap) }) }}</p>
      <p v-if="story.pitInOnLastLap" data-testid="analysis-card-pit">{{ t('analysis.card.pitIn') }}</p>
      <p class="tz-story__muted" data-testid="analysis-card-after">{{ t('analysis.card.nothingAfter') }}</p>
    </div>
    <template v-if="story.rc.length">
      <p class="tz-story__title">{{ t('rc.title') }}</p>
      <ul class="tz-story__rc">
        <li v-for="e in story.rc" :key="`${e.t}-${e.parsed.kind}`" :class="rcTone(e.parsed.kind)" data-testid="analysis-card-rc">
          <span class="tz-story__meta">
            <span v-if="e.lap" class="tz-story__lap tz-tabular">{{ lapText(e.lap) }}</span>
            <span class="tz-story__kind">{{ kindLabel(e) }}</span>
          </span>
          <span class="tz-story__text" :class="{ 'is-short': compact }" lang="en" :title="e.text">{{ e.text }}</span>
        </li>
      </ul>
      <p v-if="story.rcMore > 0" class="tz-story__muted" data-testid="analysis-card-rc-more">
        {{ t('analysis.card.rcMore', { n: story.rcMore }) }}
      </p>
    </template>
  </div>
</template>

<style scoped>
.tz-story {
  display: grid;
  gap: var(--tz-space-1);
}

.tz-story:empty {
  display: none;
}

.tz-story p {
  margin: 0;
}

.tz-story__muted,
.tz-story__title {
  color: var(--tz-text-muted);
}

.tz-story__title {
  margin-top: var(--tz-space-1);
  font-size: var(--tz-text-2xs);
  font-weight: var(--tz-weight-semibold);
}

.tz-story__rc {
  display: grid;
  gap: var(--tz-space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

/* Un mensaje: franja de su tono (como en dirección de carrera), vuelta y clase, y el texto original. */
.tz-story__rc li {
  display: grid;
  gap: 2px;
  padding-left: var(--tz-space-2);
  border-left: 3px solid var(--tz-border-strong);
}

.tz-story__rc li.is-stewards {
  border-left-color: var(--tz-paint);
}

.tz-story__rc li.is-neutral {
  border-left-color: var(--tz-sc);
}

.tz-story__rc li.is-flag {
  border-left-color: var(--tz-flag-green);
}

.tz-story__rc li.is-yellow {
  border-left-color: var(--tz-flag-yellow);
}

.tz-story__meta {
  display: flex;
  align-items: baseline;
  gap: var(--tz-space-2);
}

.tz-story__lap {
  font-family: var(--tz-font-mono);
  color: var(--tz-text-muted);
}

.tz-story__kind {
  font-weight: var(--tz-weight-semibold);
}

/* Lo de un detenido: en párrafos; en la forma corta, seguido (ocupa menos alto). */
.tz-story__stop {
  display: grid;
  gap: var(--tz-space-1);
}

.tz-story__stop.is-inline {
  display: block;
}

.tz-story__stop.is-inline p {
  display: inline;
  margin-inline-end: 0.3em;
}

/* El texto tal cual, en dos líneas como mucho (en la forma corta, una; el entero en su título). */
.tz-story__text {
  display: -webkit-box;
  overflow: hidden;
  font-family: var(--tz-font-mono);
  line-height: 1.35;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
}

.tz-story__text.is-short {
  -webkit-line-clamp: 1;
  line-clamp: 1;
}
</style>
