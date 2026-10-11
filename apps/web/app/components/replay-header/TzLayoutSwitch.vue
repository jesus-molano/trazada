<script setup lang="ts">
/**
 * Cambio de diseño del replay en la cabecera (ítem 15, D44): «Espectador» (el mapa primero, paneles compactos) o
 * «Análisis» (clasificación con columnas opcionales y telemetría más grande), como control segmentado (el elegido,
 * placa maciza). También con la tecla L y desde la paleta de comandos. Se recuerda por navegador (stores/layout.ts).
 *
 * La cabecera va en una fila: desde 1600 px, icono y texto; por debajo (o antes, si el título no cabe entero:
 * `data-fit-hide="2"`, ver pages/replay.vue), solo el icono, con su nombre accesible y su título.
 */
import { PORTRAIT_QUERY } from '~/composables/useReplayLayout'
import type { IconName } from '~/design/icons'
import { LAYOUT_PRESETS, type LayoutPreset } from '~/engine/layout/presets'
import { registerCommandService } from '~/replay/commands'
import { registerShortcut } from '~/replay/keys'
import { useLayoutStore } from '~/stores/layout'

const { t } = useI18n()
const layout = useLayoutStore()

const ICON: Record<LayoutPreset, IconName> = { spectator: 'spectator', analysis: 'columns' }
const NAME: Record<LayoutPreset, () => string> = {
  spectator: () => t('layout.switch.spectator'),
  analysis: () => t('layout.switch.analysis'),
}
const HINT: Record<LayoutPreset, () => string> = {
  spectator: () => t('layout.switch.spectatorHint'),
  analysis: () => t('layout.switch.analysisHint'),
}

const offs: (() => void)[] = []
onMounted(() => {
  offs.push(
    registerShortcut({ key: 'l' }, () => layout.togglePreset()),
    // Comandos de diseño de la paleta (engine/commands/builtin/layout.ts).
    registerCommandService('layout', {
      get preset() {
        return layout.preset
      },
      get customized() {
        return layout.customized
      },
      get resizable() {
        return !window.matchMedia?.(PORTRAIT_QUERY).matches
      },
      setPreset: (p) => layout.setPreset(p),
      resetWidths: () => layout.resetWidths(),
    }),
  )
})
onBeforeUnmount(() => {
  for (const off of offs.splice(0)) off()
})
</script>

<script lang="ts">
/** Hueco `replay-header` (D29): detrás de los botones de análisis y de la realización automática. */
export const order = 30
</script>

<template>
  <div class="tz-segmented tz-layout-switch" role="group" :aria-label="t('layout.switch.label')" aria-keyshortcuts="L" data-testid="layout-switch">
    <button
      v-for="p in LAYOUT_PRESETS"
      :key="p"
      type="button"
      class="tz-layout-switch__btn"
      :aria-pressed="layout.preset === p"
      :aria-label="NAME[p]()"
      :title="HINT[p]()"
      :data-testid="`layout-${p}`"
      @click="layout.setPreset(p)"
    >
      <TzIcon :name="ICON[p]" size="sm" />
      <span class="tz-layout-switch__text" aria-hidden="true" data-fit-hide="2">{{ NAME[p]() }}</span>
    </button>
  </div>
</template>

<style scoped>
/* A la altura de los chips de la cabecera (28 px); con puntero grueso, la zona táctil de .tz-segmented. */
.tz-layout-switch {
  flex: none;
  align-items: center;
  height: 28px;
  background: var(--tz-overlay);
}

.tz-layout-switch__btn {
  display: inline-flex;
  align-items: center;
  gap: var(--tz-space-1);
  height: 22px;
  font-weight: var(--tz-weight-semibold);
}

/* Por debajo de 1600 px, solo el icono (el nombre accesible y el título siguen ahí). */
@media (width < 1600px) {
  .tz-layout-switch__text {
    display: none;
  }
}
</style>
