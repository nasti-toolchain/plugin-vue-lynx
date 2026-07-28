import { defineConfig } from '@lightning-js/lightning'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    pool: 'threads',
    poolOptions: {
      maxWorkers: 2,
    },
    testTimeout: 10_000,
    coverage: {
      enabled: false,
      provider: 'v8',
      reporter: ['text'],
      include: ['src/**/*.ts'],
    },
  },
})
