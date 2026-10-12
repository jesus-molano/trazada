<script setup lang="ts">
import { warmLatinFonts } from '~/design/fonts'
import { useLayoutStore } from '~/stores/layout'
import { usePlaybackStore } from '~/stores/playback'
import { useSessionStore } from '~/stores/session'

const { t } = useI18n()
useHead({ title: () => t('home.title') })

// El replay (su página, su layout, el cliente de carga, sus fuentes y sus stores), preparado una vez con la portada ya
// ociosa: los enlaces no precargan (nuxt.config.ts), y sin esto el primer clic en una sesión bajaría y evaluaría el
// trozo del replay, su primer layout esperaría a las fuentes que la portada no usa y Pinia crearía los stores (sin
// efectos al crearse) dentro del montaje. Al acabar, la marca `trazada:home-warm` (la espera perf.spec).
const nuxtApp = useNuxtApp()
onNuxtReady(() => {
  warmLatinFonts()
  useSessionStore()
  usePlaybackStore()
  useLayoutStore()
  void Promise.allSettled([
    preloadRouteComponents('/replay'),
    nuxtApp.callHook('link:prefetch', '/replay'),
    import('~/data/session-client'),
    document.fonts.ready,
  ]).then(() => performance.mark('trazada:home-warm'))
})
</script>

<template>
  <section class="tz-home">
    <h1>{{ t('home.title') }}</h1>
    <p class="tz-lead">{{ t('home.lead') }}</p>
    <!-- El Gran Premio del momento (el del fin de semana, el último o el próximo), arriba y en grande. -->
    <TzFeaturedEvent />
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
