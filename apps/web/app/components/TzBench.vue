<script setup lang="ts">
/** Panel del bench de rendimiento (`?bench=1`): progreso y resultados, con copia en JSON. */
import { type BenchState, benchOptions, runBench } from '~/replay/bench'
import { getRuntime, usePlaybackStore } from '~/stores/playback'

const { t, locale } = useI18n()
const route = useRoute()
const playback = usePlaybackStore()
const opts = benchOptions(route.query)
const state = shallowRef<BenchState>({ status: 'warmup', elapsedS: 0, result: null })
const copied = ref(false)

const ms = computed(() => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 1, minimumFractionDigits: 1 }))
const result = computed(() => state.value.result)
const json = computed(() => (result.value ? JSON.stringify(result.value, null, 2) : ''))

async function copy() {
  try {
    await navigator.clipboard.writeText(json.value)
    copied.value = true
  } catch {
    copied.value = false
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
        <div><dt>{{ t('bench.heap') }}</dt><dd>{{ result.heapMB ?? '—' }}</dd></div>
        <div><dt>{{ t('bench.dpr') }}</dt><dd>{{ result.dpr }}</dd></div>
        <div><dt>{{ t('bench.frames') }}</dt><dd>{{ result.frames }}</dd></div>
      </dl>
      <p class="tz-bench__gpu">{{ result.gpu }}</p>
      <button type="button" class="tz-button" data-testid="bench-copy" @click="copy">
        {{ copied ? t('bench.copied') : t('bench.copy') }}
      </button>
    </template>
  </section>
</template>

<style scoped>
.tz-bench {
  position: absolute;
  top: 72px;
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

.tz-bench__title {
  margin: 0 0 var(--tz-space-2);
  font-size: var(--tz-text-xs);
  font-weight: var(--tz-weight-semibold);
  letter-spacing: 0.06em;
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
}

.tz-bench__gpu {
  margin: 0 0 var(--tz-space-2);
  font-size: var(--tz-text-2xs);
  color: var(--tz-text-muted);
  overflow-wrap: anywhere;
}
</style>
