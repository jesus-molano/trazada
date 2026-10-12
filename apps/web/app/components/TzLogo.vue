<script setup lang="ts">
/**
 * Símbolo de Trazada: una curva de pista (sus dos bordes, tenues) y la trazada, la línea de carrera, en pintura, que la
 * corta de fuera a dentro y a fuera. Decorativo (`aria-hidden`): el nombre va siempre al lado o en el nombre accesible
 * del enlace. El favicon (`public/favicon.svg` y sus PNG) es el mismo dibujo sobre el cromo.
 */
</script>

<template>
  <svg class="tz-logo" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    <path class="tz-logo__edge" d="M5 26C5 13 13 5 26 5" />
    <path class="tz-logo__edge" d="M14 28A14 14 0 0 1 28 14" />
    <path class="tz-logo__line" d="M8 27C11 19 19 11 27 8" />
  </svg>
</template>

<style scoped>
.tz-logo {
  flex: none;
  width: 1.2em;
  height: 1.2em;
}

.tz-logo__edge,
.tz-logo__line {
  fill: none;
  stroke-linecap: round;
}

.tz-logo__edge {
  stroke: var(--tz-text-faint);
  stroke-width: 1.8;
}

.tz-logo__line {
  stroke: var(--tz-paint);
  stroke-width: 3.6;
}
</style>
