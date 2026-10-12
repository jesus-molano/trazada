import { fileURLToPath } from 'node:url'
import { localeFiles } from './i18n/messages'

const localDataDir = fileURLToPath(new URL('../../data', import.meta.url))

export default defineNuxtConfig({
  compatibilityDate: '2026-08-01',
  ssr: true,
  devtools: { enabled: false },

  modules: ['@nuxt/eslint', '@pinia/nuxt', '@nuxtjs/i18n', '@tresjs/nuxt'],

  // Componentes por nombre de fichero (prefijo Tz), sin prefijo de carpeta.
  components: [{ path: '~/components', pathPrefix: false }],

  // Fuentes autoalojadas (OFL-1.1, D47), solo los pesos que usan los tokens (--tz-weight-*): Barlow para leer,
  // Barlow Condensed para rótulos y cifras grandes, IBM Plex Mono para siglas y datos. Cada hoja declara sus
  // subconjuntos con unicode-range, así que el navegador solo descarga el latino.
  css: [
    '@fontsource/barlow/400.css',
    '@fontsource/barlow/500.css',
    '@fontsource/barlow/600.css',
    '@fontsource/barlow/700.css',
    '@fontsource/barlow-condensed/500.css',
    '@fontsource/barlow-condensed/600.css',
    '@fontsource/barlow-condensed/700.css',
    // Cifras grandes de la telemetría (D50, de «Grafismo de TV»).
    '@fontsource/barlow-condensed/800.css',
    '@fontsource/ibm-plex-mono/400.css',
    '@fontsource/ibm-plex-mono/500.css',
    '@fontsource/ibm-plex-mono/600.css',
    '@fontsource/ibm-plex-mono/700.css',
    '~/design/tokens.css',
    '~/design/base.css',
  ],

  experimental: {
    // Build vieja (plugins/stale-build.client.ts): mira cada minuto si hay una más nueva (solo pide
    // /_nuxt/builds/latest.json al propio servidor; por defecto, cada hora).
    checkOutdatedBuildInterval: 60_000,
  },
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
    // Un fichero por namespace en i18n/locales/<idioma>/ (D29): base.json y uno por función.
    locales: [
      { code: 'es', language: 'es-ES', name: 'Español', files: localeFiles('es') },
      { code: 'en', language: 'en-GB', name: 'English', files: localeFiles('en') },
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
