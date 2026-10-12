<script setup lang="ts">
// <html lang> con el idioma, aquí y no en cada layout: app.vue no se desmonta, así que pasar de la portada al replay
// (otro layout) no quita y vuelve a poner la misma entrada de head.
const { locale } = useI18n()
useHead(() => ({ htmlAttrs: { lang: locale.value } }))
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
  <!-- Build vieja (plugins/stale-build.client.ts): aviso con «Recargar». -->
  <TzStaleBuild />
</template>
