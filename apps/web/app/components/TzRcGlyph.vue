<script setup lang="ts">
/**
 * Glifo de la columna de estado de las hojas de tiempos (D50): bandera con mástil y paño en su color (doble amarilla con
 * dos paños, a cuadros), rótulo SC/VSC/PIT en condensada, cuadrado hueco de pintura para los comisarios, «»» para
 * adelantamiento y DRS y un punto tenue para lo demás. Nunca una franja de color, y nunca solo: el tipo va escrito al
 * lado (aria-hidden). En forced-colors, los paños llevan borde para no desaparecer.
 */
import { rcGlyph } from '~/replay/rcKinds'

const props = defineProps<{ kind: string }>()
const glyph = computed(() => rcGlyph(props.kind))
const flag = computed(() => glyph.value.startsWith('flag-'))
const LABELS: Partial<Record<string, string>> = { sc: 'SC', vsc: 'VSC', pit: 'PIT', overtake: '»', dot: '·' }
</script>

<template>
  <span class="tz-glyph" :class="`is-${glyph}`" aria-hidden="true" :data-glyph="glyph">
    <template v-if="flag">
      <span class="tz-glyph__mast" />
      <span class="tz-glyph__cloth" />
      <span v-if="glyph === 'flag-double-yellow'" class="tz-glyph__cloth" />
    </template>
    <span v-else-if="glyph === 'stewards'" class="tz-glyph__box" />
    <span v-else class="tz-glyph__label">{{ LABELS[glyph] }}</span>
  </span>
</template>

<style scoped>
.tz-glyph {
  display: inline-flex;
  align-items: flex-start;
  justify-content: center;
  width: 22px;
  height: 14px;
  flex: none;
  line-height: 14px;
}

.tz-glyph__mast {
  width: 2px;
  height: 14px;
  border-radius: 1px;
  background: var(--tz-text-faint);
}

.tz-glyph__cloth {
  width: 10px;
  height: 8px;
  margin-left: 1px;
  border-radius: 0 1px 1px 0;
  background: var(--tz-text-faint);
}

.is-flag-green .tz-glyph__cloth {
  background: var(--tz-flag-green);
}

.is-flag-yellow .tz-glyph__cloth {
  background: var(--tz-flag-yellow);
}

.is-flag-double-yellow .tz-glyph__cloth {
  width: 7px;
  background: var(--tz-flag-double-yellow);
}

.is-flag-blue .tz-glyph__cloth {
  background: var(--tz-flag-blue);
}

.is-flag-red .tz-glyph__cloth {
  background: var(--tz-flag-red);
}

.is-flag-chequered .tz-glyph__cloth {
  background: conic-gradient(var(--tz-flag-chequered) 25%, var(--tz-bg) 0 50%, var(--tz-flag-chequered) 0 75%, var(--tz-bg) 0) 0
    0 / 4px 4px;
}

.tz-glyph__box {
  width: 9px;
  height: 9px;
  margin-top: 3px;
  border: 1.5px solid var(--tz-paint);
  border-radius: 2px;
}

.tz-glyph__label {
  font-family: var(--tz-font-display);
  font-size: var(--tz-text-2xs);
  font-weight: var(--tz-weight-bold);
  letter-spacing: var(--tz-tracking-display);
  color: var(--tz-text-faint);
}

.is-sc .tz-glyph__label {
  color: var(--tz-sc);
}

.is-vsc .tz-glyph__label {
  color: var(--tz-vsc);
}

.is-pit .tz-glyph__label {
  color: var(--tz-pit);
}

.is-overtake .tz-glyph__label {
  font-family: var(--tz-font-sans);
  font-size: var(--tz-text-md);
  color: var(--tz-text-muted);
}

.is-dot .tz-glyph__label {
  font-size: var(--tz-text-lg);
}

/* Colores forzados: los paños son fondos y desaparecerían; con borde, la forma se queda. */
@media (forced-colors: active) {
  .tz-glyph__cloth,
  .tz-glyph__mast {
    border: 1px solid CanvasText;
  }
}
</style>
