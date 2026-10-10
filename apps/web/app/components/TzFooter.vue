<script setup lang="ts">
const { t } = useI18n()
</script>

<template>
  <footer class="tz-footer" data-testid="disclaimer">
    <p>{{ t('legal.disclaimer') }}</p>
  </footer>
</template>

<style scoped>
.tz-footer {
  position: relative;
  z-index: var(--tz-z-panels);
  padding: var(--tz-space-3) var(--tz-space-6);
  border-top: 1px solid var(--tz-border);
  background: var(--tz-surface-1);
  color: var(--tz-text-faint);
  font-size: var(--tz-text-2xs);
  line-height: var(--tz-leading-normal);
}

.tz-footer p {
  margin: 0;
  max-width: 120ch;
}
</style>
