<script setup lang="ts">
/**
 * Layout del replay (D44): sin la cabecera global (la marca y el idioma van en la cabecera del propio replay, con
 * `TzBrandBar`), así la escena gana su alto. Ocupa la ventana exacta con `100dvh` (en Safari de iPad, `100vh` cuenta
 * las barras del navegador y el dock quedaba fuera de la pantalla) y `100vh` de respaldo. El pie lleva el disclaimer
 * completo y visible, con menos relleno.
 */
</script>

<template>
  <div class="tz-replay-shell">
    <main class="tz-replay-shell__main">
      <slot />
    </main>
    <TzFooter compact />
  </div>
</template>

<style scoped>
.tz-replay-shell {
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
}

.tz-replay-shell__main {
  position: relative;
  min-height: 0;
}
</style>
