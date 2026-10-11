import { defineVitestProject } from '@nuxt/test-utils/config'
import { defineConfig } from 'vitest/config'

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
        },
      },
      await defineVitestProject({
        test: {
          name: 'nuxt',
          environment: 'nuxt',
          css: { include: [/tokens\.css/] },
          include: ['tests/nuxt/**/*.test.ts'],
        },
      }),
    ],
  },
})
