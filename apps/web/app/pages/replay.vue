<script setup lang="ts">
const { t } = useI18n()
useHead({ title: () => t('replay.title') })
</script>

<template>
  <section class="tz-replay">
    <h1>{{ t('replay.title') }}</h1>
  </section>
</template>

<style scoped>
.tz-replay {
  padding: var(--tz-space-6);
}
</style>
