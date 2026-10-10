import { fileURLToPath } from 'node:url'

const localDataDir = fileURLToPath(new URL('../../data', import.meta.url))

export default defineNuxtConfig({
  compatibilityDate: '2026-08-01',
  ssr: true,
  devtools: { enabled: false },

  modules: ['@nuxt/eslint', '@pinia/nuxt', '@nuxtjs/i18n', '@tresjs/nuxt'],

  // Componentes por nombre de fichero (prefijo Tz), sin prefijo de carpeta.
  components: [{ path: '~/components', pathPrefix: false }],

  css: [
    '@fontsource-variable/inter/index.css',
    '@fontsource-variable/jetbrains-mono/index.css',
    '~/design/tokens.css',
    '~/design/base.css',
  ],

  app: {
    head: {
      title: 'Trazada',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'color-scheme', content: 'dark' },
        { name: 'description', content: 'Replay y análisis de carreras. Proyecto no oficial.' },
        // Proyecto personal: nunca indexable, aunque algún día se despliegue (docs/BRIEF.md, D23).
        { name: 'robots', content: 'noindex, nofollow' },
      ],
    },
  },

  runtimeConfig: {
    public: {
      // Base de los datos publicados (Worker de datos). En desarrollo, mismo origen.
      // Se sobrescribe con NUXT_PUBLIC_DATA_BASE_URL.
      dataBaseUrl: '/data',
    },
  },

  i18n: {
    strategy: 'no_prefix',
    defaultLocale: 'es',
    locales: [
      { code: 'es', language: 'es-ES', name: 'Español', file: 'es.json' },
      { code: 'en', language: 'en-GB', name: 'English', file: 'en.json' },
    ],
    detectBrowserLanguage: {
      useCookie: true,
      cookieKey: 'trazada_lang',
      fallbackLocale: 'es',
      redirectOn: 'root',
    },
  },

  tres: {
    devtools: false,
  },

  typescript: {
    strict: true,
  },

  vite: {
    worker: { format: 'es' },
  },

  nitro: {
    prerender: {
      routes: ['/', '/replay'],
      crawlLinks: false,
    },
  },

  // En desarrollo los datos se sirven desde data/ en el mismo origen (/data).
  // Nunca se incluyen en el build de producción.
  $development: {
    nitro: {
      publicAssets: [{ dir: localDataDir, baseURL: '/data', maxAge: 0 }],
    },
  },
})
