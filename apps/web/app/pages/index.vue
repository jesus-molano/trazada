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
/* Página ancha y centrada (D50): hasta 1680 px, con 32 px de margen lateral. */
.tz-home {
  display: grid;
  gap: var(--tz-space-6);
  max-width: 1680px;
  margin-inline: auto;
  padding: var(--tz-space-10) var(--tz-space-8);
}

h1 {
  margin: 0;
  font-size: 40px;
  line-height: var(--tz-leading-tight);
  letter-spacing: -0.01em;
}

.tz-lead {
  margin: calc(-1 * var(--tz-space-3)) 0 0;
  max-width: 70ch;
  color: var(--tz-text-muted);
  font-size: 15px;
}
</style>
