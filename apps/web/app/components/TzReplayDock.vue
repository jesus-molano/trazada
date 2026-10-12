<script setup lang="ts">
/**
 * Dock de reproducción: controles (con los botones del hueco `components/replay-dock/`, D29) y timeline. Desde
 * 1280 px de ancho, en una sola fila (los controles y, a su derecha, el timeline): la escena gana alto (D44).
 */
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
/*
 * Por encima de los paneles y de las hojas que tapan el escenario (análisis, `--tz-z-panels` + 1): la tarjeta de la
 * vista previa del timeline sale del dock hacia arriba y tiene que verse también con la hoja abierta. El dock no
 * pisa el escenario: solo sobresale esa tarjeta.
 */
/* Sobre el cromo, sin caja propia (D50): parte del marco que rodea al mapa. */
.tz-dock {
  position: relative;
  flex: none;
  margin: 0 var(--tz-space-4) var(--tz-space-2);
  z-index: calc(var(--tz-z-panels) + 2);
  padding: var(--tz-space-1) var(--tz-space-2);
  border: 0;
  border-radius: 0;
  background: var(--tz-bg);
}

/* Modo compacto (móvil y ventanas pequeñas, pages/replay.vue): pegado a los bordes. */
@media (width < 768px), (height < 500px) {
  .tz-dock {
    margin: 0 var(--tz-space-2) var(--tz-space-1);
  }
}

/*
 * Una sola fila: los controles a su ancho y el timeline con el resto (sin su margen de arriba). También en el móvil en
 * horizontal (poco alto, ancho de sobra): ahí cada fila es mapa que se pierde.
 */
@media (width >= 1280px), (height < 500px) and (width >= 640px) {
  .tz-dock {
    display: flex;
    align-items: center;
    gap: var(--tz-space-6);
  }

  .tz-dock > .tz-controls {
    flex: none;
    flex-wrap: nowrap;
  }

  .tz-dock > .tz-timeline {
    flex: 1 1 auto;
    min-width: 0;
    padding-top: 0;
  }
}
</style>
