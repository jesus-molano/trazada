// @ts-check
import vueI18n from '@intlify/eslint-plugin-vue-i18n'
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt(
  ...vueI18n.configs['flat/recommended'],
  {
    settings: {
      'vue-i18n': {
        // Un fichero por namespace en i18n/locales/<idioma>/ (D29): el idioma es el nombre de la carpeta.
        localeDir: {
          pattern: './i18n/locales/*/*.json',
          localeKey: 'path',
          localePattern: String.raw`^.*[\\/](?<locale>[A-Za-z0-9-_]+)[\\/][^\\/]+\.json$`,
        },
        messageSyntaxVersion: '^11.0.0',
      },
    },
    rules: {
      // Ningún texto visible fuera de i18n.
      '@intlify/vue-i18n/no-raw-text': ['error', { ignorePattern: '^[-—–#:()&.,/·×+%\\d\\s]+$' }],
      '@intlify/vue-i18n/no-missing-keys': 'error',
      // Claves que se usan con nombre dinámico (t(`session.${type}`), etc.).
      '@intlify/vue-i18n/no-unused-keys': [
        'warn',
        { extensions: ['.ts', '.vue'], ignores: ['/^session\\./', '/^replay\\.stage\\./', '/^replay\\.error\\./', '/^timeline\\.(flag|window)\\./', '/^compound\\./', '/^telemetry\\.drs\\./', '/^rc\\.kind\\./', '/^estimated\\.(fields|hints)\\./', '/^trackStatus\\.(neutral|sector)\\./', '/^manager\\.(phase|error)\\./', '/^howDrawn\\./', '/^sessionNotes\\.note\\./', '/^scene\\.toolGroups\\./'] },
      ],
      '@intlify/vue-i18n/no-v-html': 'error',
    },
  },
)
