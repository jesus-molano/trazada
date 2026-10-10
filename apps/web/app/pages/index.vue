<script setup lang="ts">
const { t } = useI18n()
useHead({ title: () => t('home.title') })
</script>

<template>
  <section class="tz-home">
    <h1>{{ t('home.title') }}</h1>
    <p class="tz-lead">{{ t('home.lead') }}</p>
  </section>
</template>

<style scoped>
.tz-home {
  padding: var(--tz-space-10) var(--tz-space-6);
  max-width: 960px;
}

h1 {
  margin: 0 0 var(--tz-space-3);
  font-size: var(--tz-text-3xl);
  line-height: var(--tz-leading-tight);
  letter-spacing: -0.01em;
}

.tz-lead {
  margin: 0;
  color: var(--tz-text-muted);
  font-size: var(--tz-text-lg);
}
</style>
