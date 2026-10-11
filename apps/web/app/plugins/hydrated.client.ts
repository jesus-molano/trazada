/** Marca el documento cuando la app ya está hidratada e interactiva (lo usan los tests e2e). */
export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.hook('app:mounted', () => {
    document.documentElement.dataset.hydrated = 'true'
  })
})
