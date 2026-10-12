<script setup lang="ts">
// Layout propio (D44): sin la cabecera global; la marca y el idioma van en la cabecera del replay (TzBrandBar).
definePageMeta({ layout: 'replay' })

/**
 * Llegar desde la portada, en tres tareas en vez de una (con la CPU ×4, juntas pasaban de 50 ms; perf.spec):
 * 1. el cambio de ruta monta fuera de la vista el layout del replay y esta página, que espera a ceder el hilo (setup
 *    asíncrono: el Suspense de Nuxt deja la portada a la vista mientras tanto, sin parpadeo);
 * 2. el Suspense resuelve: desmonta la portada y pone el layout nuevo;
 * 3. se monta el replay (TzReplay).
 * Al hidratar (carga directa de /replay) todo va de una vez, para que el HTML prerenderizado coincida. Si se vuelve
 * atrás justo en esa tarea, Nuxt no da su page:finish y el <head> no se actualiza hasta la siguiente navegación: una
 * ventana de una tarea, se acepta.
 */
const nuxtApp = useNuxtApp()
const hydrating = import.meta.server || nuxtApp.isHydrating
const booted = ref(hydrating)
let alive = true
onBeforeUnmount(() => (alive = false))
onMounted(async () => {
  if (booted.value) return
  await yieldToMain()
  if (alive) booted.value = true
})
if (!hydrating) await yieldToMain()
</script>

<template>
  <TzReplay v-if="booted" />
  <div v-else class="tz-replay-boot" />
</template>

<style scoped>
/* Hasta montar el replay (una tarea): el hueco de la página, del alto de la ventana, para que el pie no suba. */
.tz-replay-boot {
  block-size: 100%;
}
</style>
