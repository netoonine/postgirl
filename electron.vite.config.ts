import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': resolve('src/shared') } },
    build: {
      rolldownOptions: {
        // o app e a CLI (bin/postwoman.js) saem do mesmo build e compartilham src/core
        input: { index: resolve('src/main/index.ts'), cli: resolve('src/cli/index.ts') }
      }
    }
  },
  preload: {},
  renderer: {
    resolve: { alias: { '@shared': resolve('src/shared') } },
    plugins: [react()]
  }
})
