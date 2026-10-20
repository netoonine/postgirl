import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared') } },
  test: {
    include: ['test/unit/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20000
  }
})
