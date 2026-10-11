<script setup lang="ts">
/**
 * Un clip de la radio de los equipos (D51): reproducir / pausar y, mientras es el que suena, su progreso. Suena uno a la
 * vez en toda la página (`useRadioPlayer`). El nombre accesible dice de quién es y cuándo se publicó.
 */
import type { RadioClip } from '@trazada/schema'
import { clipUrl } from '~/engine/radio/radio'
import { manifestPath } from '~/data/session-id'
import { getRuntime } from '~/stores/playback'

const props = defineProps<{ clip: RadioClip; who: string; when: string }>()
const { t } = useI18n()
const rt = getRuntime()!
const player = useRadioPlayer()
const dataUrl = useDataUrl()
const url = computed(() => clipUrl(dataUrl(manifestPath(rt.session.id)), props.clip))
const current = computed(() => player.now.value?.key === props.clip.file)
const playing = computed(() => current.value && player.playing.value)
const pct = computed(() => (current.value ? Math.round(player.progress.value * 100) : 0))

function onClick() {
  if (url.value) player.toggle(url.value, props.clip.file)
}
</script>

<template>
  <span class="tz-clip" :class="{ 'is-current': current }" data-testid="radio-clip" :data-file="clip.file" :data-playing="playing">
    <button
      type="button"
      class="tz-clip__button"
      :aria-label="playing ? t('radio.pause', { who, when }) : t('radio.play', { who, when })"
      :aria-pressed="playing"
      :disabled="!url"
      data-testid="radio-play"
      @click="onClick"
    >
      <TzIcon :name="playing ? 'pause' : 'play'" size="sm" />
    </button>
    <span
      v-if="current"
      class="tz-clip__bar"
      role="progressbar"
      :aria-label="t('radio.progress', { who })"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-valuenow="pct"
      data-testid="radio-progress"
    >
      <span class="tz-clip__fill" :style="{ width: `${pct}%` }" />
    </span>
  </span>
</template>

<style scoped>
.tz-clip {
  display: inline-flex;
  align-items: center;
  gap: var(--tz-space-2);
  min-width: 0;
}

.tz-clip__button {
  display: inline-grid;
  place-items: center;
  width: var(--tz-hit-min);
  height: var(--tz-hit-min);
  flex: none;
  padding: 0;
  border: 1px solid var(--tz-border);
  border-radius: var(--tz-radius-sm);
  background: var(--tz-surface-1);
  color: var(--tz-text);
  cursor: pointer;
}

.tz-clip__button[aria-pressed='true'] {
  border-color: var(--tz-radio);
  color: var(--tz-radio);
}

.tz-clip__bar {
  position: relative;
  width: 64px;
  height: 3px;
  border-radius: 2px;
  background: var(--tz-border-strong);
  overflow: hidden;
}

.tz-clip__fill {
  position: absolute;
  inset: 0 auto 0 0;
  background: var(--tz-radio);
}
</style>
