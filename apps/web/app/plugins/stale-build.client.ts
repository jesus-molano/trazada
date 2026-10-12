/**
 * Build vieja (pendiente 6 del PLAN): con la página abierta, una build nueva (`pnpm build` mientras se usa `pnpm local`)
 * borra los trozos de JS con el hash de antes y, al pedir uno que aún no se había cargado, el navegador falla con
 * «Failed to fetch dynamically imported module». En vez de un error, un aviso no modal con «Recargar»
 * (TzStaleBuild, en app.vue). Se detecta por tres vías: el evento de Vite al no poder precargar un trozo, el gancho
 * `app:chunkError` de Nuxt y el manifiesto de builds de Nuxt cuando dice que hay una más nueva. No recarga sola: se
 * perdería lo que se esté mirando sin avisar.
 */
const STALE_MESSAGE = /dynamically imported module|Importing a module script failed|error loading dynamically imported module/i

export default defineNuxtPlugin((nuxtApp) => {
  const stale = useState('tz-stale-build', () => false)
  const flag = () => {
    stale.value = true
  }
  window.addEventListener('vite:preloadError', (event) => {
    // Sin esto, Vite relanza el error y la página lo enseña como fallo.
    event.preventDefault()
    flag()
  })
  window.addEventListener('unhandledrejection', (event) => {
    if (STALE_MESSAGE.test(String((event.reason as Error | undefined)?.message ?? event.reason))) flag()
  })
  nuxtApp.hook('app:chunkError', flag)
  nuxtApp.hook('app:manifest:update', flag)
})
