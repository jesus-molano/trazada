<script setup lang="ts">
/**
 * Lienzo WebGL único de la app (TresJS). En H3 solo gestiona la disponibilidad de WebGL 2 y la
 * pérdida/recuperación del contexto; la escena llega en H5.
 */
import type { TresContext } from '@tresjs/core'
import { sceneStats } from '~/replay/debug'
import { getRuntime } from '~/stores/playback'

const { t } = useI18n()
const supported = ref<boolean | null>(null)
const lost = ref(false)
const canvasKey = ref(0)
let canvasEl: HTMLCanvasElement | null = null
let ctx: TresContext | null = null

function hasWebGL2(): boolean {
  try {
    const probe = document.createElement('canvas')
    const gl = probe.getContext('webgl2')
    if (!gl) return false
    gl.getExtension('WEBGL_lose_context')?.loseContext() // libera el contexto de prueba
    return true
  } catch {
    return false
  }
}

function onLost(event: Event) {
  event.preventDefault() // permite que el navegador lo restaure
  lost.value = true
}

function onRestored() {
  lost.value = false
  ctx?.renderer.invalidate()
}

function onRender() {
  sceneStats.renders++
}

function detach() {
  canvasEl?.removeEventListener('webglcontextlost', onLost)
  canvasEl?.removeEventListener('webglcontextrestored', onRestored)
  canvasEl = null
}

function onReady(context: TresContext) {
  detach()
  ctx = context
  // Modo on-demand: el runtime pide un frame en cada tick con reproducción y tras cada seek.
  getRuntime()?.setInvalidate(() => context.renderer.invalidate())
  canvasEl = context.renderer.instance.domElement as HTMLCanvasElement
  canvasEl.addEventListener('webglcontextlost', onLost)
  canvasEl.addEventListener('webglcontextrestored', onRestored)
}

function onError() {
  supported.value = false
}

/** Recuperación manual: un lienzo nuevo con un contexto nuevo. */
function remount() {
  detach()
  lost.value = false
  canvasKey.value++
}

onMounted(() => {
  supported.value = hasWebGL2()
})
onBeforeUnmount(() => {
  detach()
  getRuntime()?.setInvalidate(null)
})
</script>

<template>
  <div class="tz-scene" data-testid="scene" :data-webgl="supported === null ? 'pending' : supported ? 'yes' : 'no'">
    <TresCanvas
      v-if="supported"
      :key="canvasKey"
      clear-color="#0a0c0f"
      render-mode="on-demand"
      :dpr="[1, 2]"
      @ready="onReady"
      @render="onRender"
      @error="onError"
    >
      <TresPerspectiveCamera :position="[0, 900, 900]" :look-at="[0, 0, 0]" :far="20000" />
    </TresCanvas>

    <div v-if="supported === false" class="tz-scene__notice" role="alert" data-testid="webgl-unsupported">
      <p class="tz-scene__title">{{ t('scene.noWebgl') }}</p>
      <p class="tz-scene__hint">{{ t('scene.noWebglHint') }}</p>
    </div>

    <div v-if="lost" class="tz-scene__notice" role="alert" data-testid="webgl-lost">
      <p class="tz-scene__title">{{ t('scene.contextLost') }}</p>
      <p class="tz-scene__hint">{{ t('scene.contextLostHint') }}</p>
      <button type="button" class="tz-button" data-testid="webgl-recover" @click="remount">
        {{ t('scene.recover') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.tz-scene {
  position: absolute;
  inset: 0;
  z-index: var(--tz-z-canvas);
}

/* Arriba, bajo la cabecera del replay: el dock de controles ocupa la parte inferior. */
.tz-scene__notice {
  position: absolute;
  left: 50%;
  top: 72px;
  transform: translateX(-50%);
  width: min(480px, calc(100% - 2 * var(--tz-space-6)));
  padding: var(--tz-space-4) var(--tz-space-6);
  border: 1px solid var(--tz-border-strong);
  border-radius: var(--tz-radius-lg);
  background: var(--tz-overlay);
  box-shadow: var(--tz-shadow-panel);
}

.tz-scene__title {
  margin: 0 0 var(--tz-space-1);
  font-weight: var(--tz-weight-semibold);
}

.tz-scene__hint {
  margin: 0 0 var(--tz-space-3);
  color: var(--tz-text-muted);
  font-size: var(--tz-text-sm);
}
</style>
