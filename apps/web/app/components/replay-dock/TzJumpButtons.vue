<script setup lang="ts">
/**
 * Saltos al momento anterior y siguiente (ítem 5, D35): adelantamientos, inicio de duelos, neutralizaciones y
 * mensajes destacados de dirección de carrera (`stores/moments.ts`), o solo la clase elegida en la pestaña «Momentos».
 * Cada salto llega 5 s antes del momento. Teclas: coma (anterior) y punto (siguiente). Sin momento hacia ese lado, el
 * botón se deshabilita. El nombre accesible dice hacia dónde y entre cuáles; nunca qué pasa (sin spoilers).
 * Mientras están montados, la paleta de comandos (ítem 14) ofrece «siguiente/anterior momento» con los mismos destinos
 * y, con el mismo precálculo, «siguiente adelantamiento», «duelo HAM»… (ítem 14b), sin spoilers si la hoja de análisis
 * tiene «Sin spoilers».
 */
import { registerCommandService } from '~/replay/commands'
import { registerShortcut } from '~/replay/keys'
import { type JumpFilter, useMomentsStore } from '~/stores/moments'

const { t } = useI18n()
const moments = useMomentsStore()

const KIND_TEXT: Record<JumpFilter, () => string> = {
  all: () => t('moments.jump.kind.all'),
  overtake: () => t('moments.jump.kind.overtake'),
  duel: () => t('moments.jump.kind.duel'),
  neutralisation: () => t('moments.jump.kind.neutralisation'),
  raceControl: () => t('moments.jump.kind.raceControl'),
}

/** Teclas: coma y punto (sin Mayúsculas ni AltGr en las distribuciones habituales, también la española). */
const PREV_KEY = ','
const NEXT_KEY = '.'

const kind = computed(() => KIND_TEXT[moments.filter]())
const prevLabel = computed(() => t('moments.jump.prev', { kind: kind.value }))
const nextLabel = computed(() => t('moments.jump.next', { kind: kind.value }))
const keyHint = (key: string) => t('moments.jump.key', { key })

let offKeys: (() => void)[] = []
onMounted(() => {
  offKeys = [
    // Mantenidas, siguen saltando (como las flechas); los conmutadores (L, T, ?) no.
    registerShortcut({ key: PREV_KEY }, () => moments.jump(-1), { repeat: true }),
    registerShortcut({ key: NEXT_KEY }, () => moments.jump(1), { repeat: true }),
    registerCommandService(
      'moments',
      // «Sin spoilers» de la hoja de análisis, al leerlo (uno por runtime: `useAnalysis` lo crea si aún no existe).
      moments.commandService(() => useAnalysis().noSpoilers.value),
    ),
  ]
})
onBeforeUnmount(() => {
  for (const off of offKeys) off()
  offKeys = []
})
</script>

<script lang="ts">
/** Hueco `replay-dock` (D29): saltos entre momentos (ítem 5), los primeros botones del dock. */
export const order = 10
</script>

<template>
  <div class="tz-jumps" role="group" :aria-label="t('moments.jump.group')" data-testid="jump-buttons" :data-filter="moments.filter">
    <button
      type="button"
      class="tz-jumps__btn"
      :disabled="!moments.prev"
      :aria-label="prevLabel"
      :aria-keyshortcuts="PREV_KEY"
      :title="`${prevLabel} (${keyHint(PREV_KEY)})`"
      data-testid="jump-prev"
      @click="moments.jump(-1)"
    >
      <TzIcon name="jumpBack" size="sm" />
    </button>
    <button
      type="button"
      class="tz-jumps__btn"
      :disabled="!moments.next"
      :aria-label="nextLabel"
      :aria-keyshortcuts="NEXT_KEY"
      :title="`${nextLabel} (${keyHint(NEXT_KEY)})`"
      data-testid="jump-next"
      @click="moments.jump(1)"
    >
      <TzIcon name="jumpForward" size="sm" />
    </button>
  </div>
</template>

<style scoped>
.tz-jumps {
  display: inline-flex;
  gap: var(--tz-space-1);
}

/* Como los controles del dock: 32 px y, con puntero grueso, zona táctil de --tz-hit-min. */
.tz-jumps__btn {
  position: relative;
  display: inline-grid;
  place-items: center;
  width: var(--tz-space-8);
  height: var(--tz-space-8);
  padding: 0;
  border: 1px solid var(--tz-border-strong);
  border-radius: var(--tz-radius-md);
  background: transparent;
  cursor: pointer;
  transition:
    border-color var(--tz-dur-fast) var(--tz-ease-standard),
    transform var(--tz-dur-fast) var(--tz-ease-standard);
}

.tz-jumps__btn::after {
  content: '';
  position: absolute;
  inset: min(0px, calc((100% - var(--tz-hit-min)) / 2));
}

.tz-jumps__btn:active:not(:disabled) {
  transform: scale(var(--tz-press-scale));
}

.tz-jumps__btn:disabled {
  border-color: var(--tz-border);
  color: var(--tz-text-faint);
  cursor: default;
}

@media (hover: hover) {
  .tz-jumps__btn:hover:not(:disabled) {
    border-color: var(--tz-accent);
  }
}
</style>
