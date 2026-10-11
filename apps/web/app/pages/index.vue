<script setup lang="ts">
const { t } = useI18n()
useHead({ title: () => t('home.title') })
</script>

<template>
  <section class="tz-home">
    <h1>{{ t('home.title') }}</h1>
    <p class="tz-lead">{{ t('home.lead') }}</p>
    <!-- «Seguir viendo» (ítem 13): solo con sesiones guardadas que siguen en el catálogo. -->
    <TzContinue />
    <TzSelector />
  </section>
</template>

<style scoped>
.tz-home {
  display: grid;
  gap: var(--tz-space-6);
  padding: var(--tz-space-10) var(--tz-space-6);
  max-width: 1200px;
}

h1 {
  margin: 0;
  font-size: var(--tz-text-3xl);
  line-height: var(--tz-leading-tight);
  letter-spacing: -0.01em;
}

.tz-lead {
  margin: calc(-1 * var(--tz-space-3)) 0 0;
  max-width: 70ch;
  color: var(--tz-text-muted);
  font-size: var(--tz-text-lg);
}
</style>
