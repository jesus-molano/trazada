<script setup lang="ts">
/**
 * Paneles del replay en la cabecera (ítem 15, D44; nombres de D50): «Compactos» (el mapa primero; preset `spectator`) o
 * «Detallados» (preset `analysis`: clasificación con más columnas y telemetría más grande), como control segmentado (el elegido,
 * placa maciza). También con la tecla P (de «paneles»; la L es de la realización automática) y desde la paleta de comandos. Se recuerda por navegador (stores/layout.ts).
 *
 * La cabecera va en una fila: desde 1600 px, icono y texto; por debajo (o antes, si el título no cabe entero:
 * `data-fit-hide="2"`, ver TzReplay.vue), solo el icono, con su nombre accesible y su título. Por debajo de 1360 px
 * (o antes, con `data-fit="3"`): con ratón, botones de 24 px de ancho; en táctil (sin ratón), un solo botón que alterna
 * «Detallados» (pulsado) y «Compactos» (sin pulsar), con su zona táctil y el mismo nombre en voz alta. Así la cabecera
 * de la tablet en horizontal (1024 px) sigue en una fila, como antes del cambio de diseño.
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
    registerShortcut({ key: 'p' }, () => layout.togglePreset()),
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
export const order = 8
export const group = 'view'
</script>

<template>
  <div class="tz-layout-switch">
    <span class="tz-layout-switch__label" aria-hidden="true">{{ t('layout.switch.label') }}</span>
    <div
      class="tz-segmented tz-layout-switch__group"
      role="group"
      :aria-label="t('layout.switch.label')"
      aria-keyshortcuts="P"
      data-testid="layout-switch"
    >
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
    <!-- Forma compacta en táctil (por debajo de 1360 px o con data-fit="3"): un botón que alterna los dos diseños. -->
    <button
      type="button"
      class="tz-layout-switch__toggle"
      :aria-pressed="layout.preset === 'analysis'"
      :aria-label="t('layout.switch.toggle')"
      :title="t('layout.switch.toggleHint')"
      aria-keyshortcuts="P"
      data-testid="layout-toggle"
      @click="layout.togglePreset()"
    >
      <TzIcon name="columns" size="sm" />
    </button>
  </div>
</template>

<style scoped>
.tz-layout-switch {
  display: inline-flex;
  flex: none;
  align-items: center;
}

/* A la altura de los chips de la cabecera (28 px); con puntero grueso, la zona táctil de .tz-segmented. */
.tz-layout-switch__group {
  align-items: center;
  height: 28px;
}

/* Rótulo «Paneles» delante del segmentado (D50); el grupo lleva el mismo nombre accesible. */
.tz-layout-switch__label {
  margin-right: var(--tz-space-2);
  font-size: var(--tz-text-sm);
  color: var(--tz-text-faint);
  white-space: nowrap;
}

.tz-layout-switch__btn {
  display: inline-flex;
  align-items: center;
  gap: var(--tz-space-1);
  height: 22px;
  font-size: var(--tz-text-sm);
}

/* El botón que alterna: como el de la realización automática con solo el icono; pulsado («Análisis»), placa maciza. */
.tz-layout-switch__toggle {
  position: relative;
  display: none;
  align-items: center;
  height: 28px;
  padding: 0 var(--tz-space-2);
  border: 1px solid transparent;
  border-radius: var(--tz-radius-md);
  background: transparent;
  color: var(--tz-text-muted);
  cursor: pointer;
  transition:
    background-color var(--tz-dur-fast) var(--tz-ease-standard),
    color var(--tz-dur-fast) var(--tz-ease-standard),
    transform var(--tz-dur-fast) var(--tz-ease-standard);
}

.tz-layout-switch__toggle::after {
  content: '';
  position: absolute;
  inset: min(0px, calc((100% - var(--tz-hit-min)) / 2));
}

.tz-layout-switch__toggle[aria-pressed='true'] {
  border-color: var(--tz-accent);
  background: var(--tz-accent);
  color: var(--tz-accent-on);
}

.tz-layout-switch__toggle:active {
  transform: scale(var(--tz-press-scale));
}

/* Por debajo de 1600 px, solo el icono (el nombre accesible y el título siguen ahí). */
@media (width < 1600px) {
  .tz-layout-switch__text {
    display: none;
  }
}

/* Por debajo de 1360 px (o con `data-fit="3"`: TzReplay.vue), en táctil, el botón que alterna. */
@media (width < 1360px) {
  .tz-layout-switch__group {
    display: none;
  }

  .tz-layout-switch__toggle {
    display: inline-flex;
  }
}

/* Con ratón, el control segmentado con botones de 24 px de ancho (el mínimo de WCAG 2.2). */
@media (width < 1360px) and (hover: hover) and (pointer: fine) {
  .tz-layout-switch__group {
    display: inline-flex;
  }

  .tz-layout-switch__toggle {
    display: none;
  }

  .tz-layout-switch__btn {
    padding-inline: var(--tz-space-1);
  }
}

@media (hover: hover) {
  .tz-layout-switch__toggle:hover {
    background: var(--tz-surface-2);
    color: var(--tz-text);
  }
}
</style>
