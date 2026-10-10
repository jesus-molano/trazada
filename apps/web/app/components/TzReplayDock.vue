<script setup lang="ts">
/** Dock de reproducción: controles (con los botones del hueco `components/replay-dock/`, D29) y timeline. */
import { REPLAY_DOCK } from '~/slots/replay-dock'

const { t } = useI18n()
</script>

<template>
  <section class="tz-dock" :aria-label="t('controls.region')" data-testid="replay-dock">
    <TzControls>
      <component :is="item.component" v-for="item in REPLAY_DOCK" :key="item.name" />
    </TzControls>
    <TzTimeline />
  </section>
</template>

<style scoped>
.tz-dock {
  position: relative;
  flex: none;
  margin: 0 var(--tz-space-6) var(--tz-space-6);
  z-index: var(--tz-z-panels);
  padding: var(--tz-space-3) var(--tz-space-4) var(--tz-space-2);
  border: 1px solid var(--tz-border);
  border-radius: var(--tz-radius-lg);
  background: var(--tz-overlay);
  box-shadow: var(--tz-shadow-panel);
}
</style>
