<script setup lang="ts">
/** Panel del bench de rendimiento (`?bench=1`): progreso y resultados, con copia en JSON. */
import { type BenchState, benchOptions, runBench } from '~/replay/bench'
import { getRuntime, usePlaybackStore } from '~/stores/playback'

const { t, locale } = useI18n()
const route = useRoute()
const playback = usePlaybackStore()
const opts = benchOptions(route.query)
const state = shallowRef<BenchState>({ status: 'warmup', elapsedS: 0, result: null })
/** Resultado de copiar: el botón lo dice con su texto (y su icono); un fallo también se dice. */
const copy = ref<'idle' | 'copied' | 'failed'>('idle')

const ms = computed(() => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 1, minimumFractionDigits: 1 }))
const result = computed(() => state.value.result)
const json = computed(() => (result.value ? JSON.stringify(result.value, null, 2) : ''))

async function copyJson() {
  try {
    await navigator.clipboard.writeText(json.value)
    copy.value = 'copied'
  } catch {
    copy.value = 'failed'
  }
}

let stop: (() => void) | null = null
onMounted(() => {
  const rt = getRuntime()
  if (!rt) return
  stop = runBench(rt, opts, (car) => playback.selectCar(car), (s) => {
    state.value = s
    if (s.result) (window as Window & { __trazadaBench?: unknown }).__trazadaBench = s.result
  })
})
onBeforeUnmount(() => stop?.())
</script>

<template>
  <section class="tz-bench" :aria-label="t('bench.title')" data-testid="bench" :data-status="state.status">
    <h2 class="tz-bench__title">{{ t('bench.title') }}</h2>
    <p v-if="state.status !== 'done'" class="tz-bench__progress tz-tabular" role="status">
      {{
        state.status === 'warmup'
          ? t('bench.warmup', { s: Math.max(0, Math.ceil(opts.warmupS - state.elapsedS)) })
          : t('bench.measuring', { s: Math.max(0, Math.ceil(opts.warmupS + opts.measureS - state.elapsedS)) })
      }}
    </p>
    <template v-else-if="result">
      <dl class="tz-bench__grid tz-tabular">
        <div><dt>{{ t('bench.p95') }}</dt><dd data-testid="bench-p95">{{ ms.format(result.p95) }}</dd></div>
        <div><dt>{{ t('bench.p99') }}</dt><dd>{{ ms.format(result.p99) }}</dd></div>
        <div><dt>{{ t('bench.over50') }}</dt><dd>{{ result.over50 }}</dd></div>
        <div>
          <dt>{{ t('bench.heap') }}</dt>
          <!-- Solo Chromium expone el heap: en otro navegador, «sin dato» con su estilo, nunca un número inventado. -->
          <dd v-if="result.heapMB !== null" data-testid="bench-heap">{{ result.heapMB }}</dd>
          <dd v-else class="is-missing" data-testid="bench-heap">{{ t('portada.noData') }}</dd>
        </div>
        <div><dt>{{ t('bench.dpr') }}</dt><dd>{{ result.dpr }}</dd></div>
        <div><dt>{{ t('bench.frames') }}</dt><dd>{{ result.frames }}</dd></div>
      </dl>
      <p class="tz-bench__gpu">{{ result.gpu }}</p>
      <div class="tz-bench__actions">
        <button type="button" class="tz-button" data-testid="bench-copy" @click="copyJson">
          <TzIcon :name="copy === 'copied' ? 'check' : 'copy'" size="sm" />{{
            copy === 'copied' ? t('bench.copied') : t('bench.copy')
          }}
        </button>
        <p v-if="copy === 'failed'" class="tz-bench__failed" role="alert" data-testid="bench-copy-failed">
          <TzIcon name="error" size="sm" class="tz-bench__failed-icon" />{{ t('portada.copyFailed') }}
        </p>
      </div>
    </template>
  </section>
</template>

<style scoped>
/* Debajo de la cabecera del replay (72 px = 48 + 24), centrado sobre la escena. */
.tz-bench {
  position: absolute;
  top: calc(var(--tz-space-12) + var(--tz-space-6));
  left: 50%;
  z-index: var(--tz-z-overlay);
  width: min(420px, calc(100% - 2 * var(--tz-space-6)));
  padding: var(--tz-space-3) var(--tz-space-4);
  border: 1px solid var(--tz-accent);
  border-radius: var(--tz-radius-lg);
  background: var(--tz-overlay);
  box-shadow: var(--tz-shadow-panel);
  transform: translateX(-50%);
}

/* Título del panel: rótulo condensado (h2, desde base.css) con el tracking de los rótulos en mayúsculas. */
.tz-bench__title {
  margin: 0 0 var(--tz-space-2);
  font-size: var(--tz-text-xs);
  font-weight: var(--tz-weight-semibold);
  letter-spacing: var(--tz-tracking-caps);
  text-transform: uppercase;
  color: var(--tz-accent-strong);
}

.tz-bench__progress {
  margin: 0;
  font-size: var(--tz-text-sm);
}

.tz-bench__grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--tz-space-2);
  margin: 0 0 var(--tz-space-2);
}

.tz-bench__grid dt {
  font-size: var(--tz-text-2xs);
  color: var(--tz-text-muted);
}

.tz-bench__grid dd {
  margin: 0;
  font-family: var(--tz-font-mono);
  font-size: var(--tz-text-lg);
  letter-spacing: var(--tz-tracking-mono);
}

/* «sin dato»: texto pequeño, tenue y en cursiva en la familia de texto, para no confundirlo con una cifra. */
.tz-bench__grid dd.is-missing {
  font-family: var(--tz-font-sans);
  font-size: var(--tz-text-sm);
  font-style: italic;
  font-weight: var(--tz-weight-regular);
  letter-spacing: normal;
  color: var(--tz-text-faint);
}

.tz-bench__gpu {
  margin: 0 0 var(--tz-space-2);
  font-size: var(--tz-text-2xs);
  color: var(--tz-text-muted);
  overflow-wrap: anywhere;
}

.tz-bench__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--tz-space-2) var(--tz-space-3);
}

.tz-bench__failed {
  display: inline-flex;
  align-items: center;
  gap: var(--tz-space-1);
  margin: 0;
  font-size: var(--tz-text-sm);
}

.tz-bench__failed-icon {
  color: var(--tz-danger);
}
</style>
