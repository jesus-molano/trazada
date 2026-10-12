<script setup lang="ts">
/**
 * Chip de la realización automática (ítem 9, D39), justo debajo de la cabecera y centrado, solo mientras está
 * encendida: a quién sigue y por qué, con «Salir».
 *
 * Honestidad: la única cifra es el intervalo de la torre oficial («a 0,412 s»), con el formato de la clasificación;
 * si el duelo sale de la cercanía en pista, «cerca en pista» y ningún número. El líder es el de la clasificación
 * oficial, nunca el que va primero en pista. Bajo neutralización, lo dice con el nombre del estado de pista.
 *
 * También registra la tecla L, de «live» (encender y apagar, con la escena 3D montada) y Esc (`ESC_PRIORITY.tv`: por encima del
 * seguimiento y de la selección). Para lectores de pantalla, un aviso solo cuando cambia el plano (no con cada cifra).
 */
import { ESC_PRIORITY, registerEscape, registerShortcut } from '~/replay/keys'
import { getRuntime } from '~/stores/playback'
import { type TvShotView, useTvStore } from '~/stores/tv'

const { t, locale } = useI18n()
const tv = useTvStore()
const tla = new Map(getRuntime()!.drivers.map((d) => [d.number, d.tla]))
const name = (car: string | undefined) => (car ? (tla.get(car) ?? car) : '')

const intervalFmt = computed(() => new Intl.NumberFormat(locale.value, { minimumFractionDigits: 3, maximumFractionDigits: 3 }))

function shotText(v: TvShotView): string {
  const neutral = v.neutral ? t(`trackStatus.neutral.${v.neutral}`) : ''
  if (v.kind === 'duel') {
    const [a, b] = [name(v.cars[0]), name(v.cars[1])]
    if (v.basis === 'tower') {
      if (!v.positions) return t('tv.chip.duel', { a, b })
      const base = { ahead: a, behind: b, p1: v.positions[0], p2: v.positions[1] }
      return v.intervalMs === null
        ? t('tv.chip.duelTowerNoInterval', base)
        : t('tv.chip.duelTower', { ...base, interval: intervalFmt.value.format(v.intervalMs / 1000) })
    }
    return t('tv.chip.duelProximity', { a, b })
  }
  if (v.kind === 'leader') {
    const driver = name(v.cars[0])
    return neutral ? t('tv.chip.leaderNeutral', { driver, neutral }) : t('tv.chip.leader', { driver })
  }
  return neutral ? t('tv.chip.overviewNeutral', { neutral }) : t('tv.chip.overview')
}

const text = computed(() => (tv.view ? shotText(tv.view) : t('tv.chip.starting')))
const camera = computed(() => {
  const v = tv.view
  if (v?.camera !== 'corner') return ''
  return v.corner ? t('tv.chip.corner', { label: v.corner }) : t('tv.chip.cornerNoLabel')
})
const title = computed(() => {
  const v = tv.view
  if (!v) return ''
  if (v.kind === 'duel') return v.basis === 'tower' ? t('tv.chip.towerTitle') : t('tv.chip.proximityTitle')
  return v.kind === 'leader' ? t('tv.chip.leaderTitle') : t('tv.chip.overviewTitle')
})

/** Aviso para lectores de pantalla: solo al cambiar de plano (la cifra de la torre cambia a menudo). */
const announcement = ref('')
watch(
  [() => tv.view?.id, () => tv.view?.kind],
  ([id]) => {
    announcement.value = id !== undefined && tv.view ? t('tv.chip.announce', { text: shotText(tv.view) }) : ''
  },
)

let offKeys: (() => void)[] = []
onMounted(() => {
  offKeys = [
    registerShortcut({ key: 'l' }, () => tv.toggle(), { when: () => tv.available }),
    registerEscape(ESC_PRIORITY.tv, { active: () => tv.active, run: () => tv.stop('escape') }),
  ]
})
onBeforeUnmount(() => {
  for (const off of offKeys) off()
  offKeys = []
  tv.stop('session')
})
</script>

<script lang="ts">
/** Hueco components/replay-overlays/ (D29): un aviso fijo mientras dura la realización. */
export const order = 70
</script>

<template>
  <!-- Debajo de la cabecera (posición relativa): el chip sigue su borde inferior aunque la cabecera ocupe dos filas. -->
  <Teleport defer to=".tz-replay__bar">
    <div v-if="tv.active" class="tz-tv-chip" data-testid="tv-chip" :data-kind="tv.view?.kind ?? 'pending'">
      <TzIcon name="director" size="sm" />
      <span class="tz-tv-chip__label">{{ t('tv.chip.label') }}</span>
      <span class="tz-tv-chip__text tz-tabular" :title="title" data-testid="tv-chip-text">{{ text }}</span>
      <span v-if="camera" class="tz-tv-chip__camera" data-testid="tv-chip-camera">{{ camera }}</span>
      <button
        type="button"
        class="tz-button tz-button--quiet tz-tv-chip__exit"
        :aria-label="t('tv.chip.exitLabel')"
        data-testid="tv-exit"
        @click="tv.stop('toggle')"
      >
        {{ t('tv.chip.exit') }}
      </button>
    </div>
  </Teleport>
  <p class="tz-visually-hidden" role="status" data-testid="tv-announce">{{ announcement }}</p>
</template>

<style scoped>
/*
 * Dentro de la ventana del mapa, arriba a la izquierda (`--replay-over-*`, pages/replay.vue): las etiquetas «Estimado»
 * de la escena van a la derecha, en la misma fila, y cada lado se queda con la mitad como mucho.
 */
.tz-tv-chip {
  position: absolute;
  top: calc(100% + var(--replay-over-top, var(--tz-space-3)));
  left: var(--replay-over-left, var(--tz-space-6));
  z-index: var(--tz-z-header);
  display: flex;
  align-items: center;
  gap: var(--tz-space-2);
  width: max-content;
  max-width: min(640px, var(--replay-over-max, calc(100% - 2 * var(--tz-space-6))));
  padding: var(--tz-space-1) var(--tz-space-1) var(--tz-space-1) var(--tz-space-3);
  border: 1px solid var(--tz-border-strong);
  border-radius: var(--tz-radius-pill);
  background: var(--tz-surface-2);
  box-shadow: var(--tz-shadow-panel);
  color: var(--tz-text);
  font-size: var(--tz-text-sm);
  pointer-events: auto;
  animation: tz-enter var(--tz-dur-slow) var(--tz-ease-enter);
}

.tz-tv-chip > .tz-icon {
  color: var(--tz-accent);
}

.tz-tv-chip__label {
  color: var(--tz-text-muted);
  font-size: var(--tz-text-xs);
  white-space: nowrap;
}

.tz-tv-chip__text {
  min-width: 0;
  overflow: hidden;
  font-weight: var(--tz-weight-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tz-tv-chip__camera {
  color: var(--tz-text-muted);
  font-size: var(--tz-text-xs);
  white-space: nowrap;
}

.tz-tv-chip__exit {
  padding: var(--tz-space-0-5) var(--tz-space-3);
  font-size: var(--tz-text-sm);
  white-space: nowrap;
}

/* Estrecho (tablet en vertical): sin la etiqueta, que ya dice el icono con el botón de la cabecera pulsado. */
@media (width < 900px) {
  .tz-tv-chip__label,
  .tz-tv-chip__camera {
    display: none;
  }
}
</style>
