<script setup lang="ts">
/**
 * Zonas de DRS (ítem 11, D38): «No / Sí» en el grupo «Capas» de las herramientas de escena, con la leyenda (intensas
 * mientras dirección de carrera tiene el DRS activado, tenues si no) y la etiqueta «Estimado» (`drsZones`): se deducen
 * de la telemetría, no son las líneas oficiales. Mientras se pintan, la etiqueta sale también en la fila de etiquetas
 * de la escena (`stores/sceneEstimated.ts`), siempre a la vista: este menú va plegado.
 *
 * Sin zonas, lo dice y por qué: desde 2026 no hay DRS ni canal por coche; sin canal o sin aperturas suficientes,
 * «sin dato». Nunca se dibuja una zona inventada. La pista «ⓘ» explica de dónde salen.
 */
import { DRS_MIN_CARS, DRS_MIN_PASSES } from '~/engine/drs/zones'
import { useDrsStore } from '~/stores/drs'
import { getRuntime } from '~/stores/playback'
import { useSceneEstimatedStore } from '~/stores/sceneEstimated'

const { t } = useI18n()
const drs = useDrsStore()
const sceneEstimated = useSceneEstimatedStore()

// Datos de la sesión (fijos mientras vive la escena, que se monta de nuevo con cada sesión).
const session = getRuntime()?.session ?? null
const zones = session?.drsZones ?? null
const season = zones ? session!.manifest.session.season : null
/** ¿Anunció dirección de carrera el DRS? Si no, nunca hay ventana activa y las zonas se ven siempre tenues. */
const hasWindows = zones ? session!.events.windows.some((w) => w.kind === 'drs') : false
const deduced = zones?.status === 'deduced' && zones.spans.length > 0
const drawn = computed(() => deduced && drs.show)

onMounted(() => drs.hydrate())
watch(drawn, (on) => sceneEstimated.set('drs', on ? { field: 'drsZones' } : null), { immediate: true })
onBeforeUnmount(() => sceneEstimated.set('drs', null))

const note = computed(() => {
  if (!zones || deduced) return ''
  if (zones.status === 'season') return t('drs.noZonesSeason', { season: season ?? '' })
  if (zones.status === 'no-channel') return t('drs.noChannel')
  return t('drs.insufficient')
})

const hint = computed(() => {
  if (!zones) return ''
  if (deduced) {
    return [
      t('drs.hint'),
      t('drs.hintCars', { n: zones.cars }, zones.cars),
      zones.discardedCars > 0 ? t('drs.hintDiscarded', { n: zones.discardedCars }, zones.discardedCars) : '',
      hasWindows ? t('drs.hintWindows') : t('drs.hintNoWindows'),
      t('drs.hintZone'),
    ]
      .filter(Boolean)
      .join(' ')
  }
  if (zones.status === 'season') return t('drs.hintSeason')
  if (zones.status === 'no-channel') return t('drs.hintNoChannel')
  return t('drs.hintInsufficient', { passes: DRS_MIN_PASSES, cars: DRS_MIN_CARS })
})
</script>

<script lang="ts">
export const order = 20
export const group = 'layers'
</script>

<template>
  <span v-if="zones" class="tz-drs" data-testid="drs-tool" :data-status="zones.status">
    <span id="tz-drs-label" class="tz-drs__label">{{ t('drs.label') }}</span>
    <template v-if="deduced">
      <span class="tz-segmented" role="group" aria-labelledby="tz-drs-label">
        <button type="button" :aria-pressed="!drs.show" data-testid="drs-off" @click="drs.setShow(false)">
          {{ t('drs.off') }}
        </button>
        <button type="button" :aria-pressed="drs.show" data-testid="drs-on" @click="drs.setShow(true)">
          {{ t('drs.on') }}
        </button>
      </span>
      <span
        v-if="drs.show && hasWindows"
        class="tz-chip tz-drs__legend"
        role="group"
        :aria-label="t('drs.legendLabel')"
        data-testid="drs-legend"
      >
        <span class="tz-drs__swatch" aria-hidden="true" />
        <span>{{ t('drs.enabled') }}</span>
        <span class="tz-drs__swatch is-faint" aria-hidden="true" />
        <span>{{ t('drs.disabled') }}</span>
      </span>
      <TzEstimated v-if="drs.show" field="drsZones" />
    </template>
    <span v-else class="tz-drs__note" data-testid="drs-note">{{ note }}</span>
    <TzHint :label="t('drs.hintLabel')" :text="hint" testid="drs-hint" align="end" />
  </span>
</template>

<style scoped>
.tz-drs {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--tz-space-1);
  min-width: 0;
  max-width: 100%;
}

.tz-drs__label {
  font-size: var(--tz-text-xs);
  color: var(--tz-text-muted);
}

/* Varias líneas antes que un menú muy ancho. */
.tz-drs__note {
  max-width: 34ch;
  font-size: var(--tz-text-xs);
  color: var(--tz-text-muted);
}

.tz-drs__swatch {
  width: var(--tz-space-4);
  height: var(--tz-space-2);
  border-radius: var(--tz-radius-pill);
  background: var(--tz-drs);
}

/* Lo mismo que la capa: tenue mientras el DRS está desactivado. */
.tz-drs__swatch.is-faint {
  opacity: 0.3;
}
</style>
