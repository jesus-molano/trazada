import { defineVitestProject } from '@nuxt/test-utils/config'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          // tokens.css se importa en crudo (?raw) desde design/tokens.ts: no se puede vaciar.
          css: { include: [/tokens\.css/] },
          include: ['app/**/*.test.ts', 'tests/unit/**/*.test.ts'],
          // Los huecos por glob (D29) importan sus .vue al cargar: sus tests van en el proyecto nuxt, que los compila.
          exclude: [...configDefaults.exclude, 'app/slots/**'],
        },
      },
      await defineVitestProject({
        test: {
          name: 'nuxt',
          environment: 'nuxt',
          css: { include: [/tokens\.css/] },
          include: ['tests/nuxt/**/*.test.ts', 'app/slots/**/*.test.ts'],
        },
      }),
    ],
  },
})
