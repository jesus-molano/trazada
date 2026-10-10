<script setup lang="ts">
const { t } = useI18n()
</script>

<template>
  <section class="tz-dock" :aria-label="t('controls.region')" data-testid="replay-dock">
    <TzControls />
    <TzTimeline />
  </section>
</template>

<style scoped>
.tz-dock {
  position: absolute;
  left: var(--tz-space-6);
  right: var(--tz-space-6);
  bottom: var(--tz-space-6);
  z-index: var(--tz-z-panels);
  padding: var(--tz-space-3) var(--tz-space-4) var(--tz-space-2);
  border: 1px solid var(--tz-border);
  border-radius: var(--tz-radius-lg);
  background: var(--tz-overlay);
  backdrop-filter: blur(10px);
  box-shadow: var(--tz-shadow-panel);
}
</style>
