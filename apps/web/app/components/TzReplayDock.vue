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
/*
 * Por encima de los paneles y de las hojas que tapan el escenario (análisis, `--tz-z-panels` + 1): la tarjeta de la
 * vista previa del timeline sale del dock hacia arriba y tiene que verse también con la hoja abierta. El dock no
 * pisa el escenario: solo sobresale esa tarjeta.
 */
.tz-dock {
  position: relative;
  flex: none;
  margin: 0 var(--tz-space-6) var(--tz-space-6);
  z-index: calc(var(--tz-z-panels) + 2);
  padding: var(--tz-space-3) var(--tz-space-4) var(--tz-space-2);
  border: 1px solid var(--tz-border);
  border-radius: var(--tz-radius-lg);
  background: var(--tz-overlay);
  box-shadow: var(--tz-shadow-panel);
}
</style>
