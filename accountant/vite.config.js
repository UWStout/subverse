import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  root: 'client',
  build: {
    // Relative to root ('client'), so '../public' lands in the project root
    outDir: '../public',
    emptyOutDir: true
  },
  server: {
    port: 5173,
    proxy: {
      '/user': {
        target: 'http://localhost:3000',
        changeOrigin: true
      },
      '/class': {
        target: 'http://localhost:3000',
        changeOrigin: true
      },
      '/offering': {
        target: 'http://localhost:3000',
        changeOrigin: true
      },
      '/project': {
        target: 'http://localhost:3000',
        changeOrigin: true
      },
      '/auth': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    }
  }
})

// NOTE: test configuration lives in vitest.config.js at the project root
// (both the client and server projects) - not here. This file is dev/build only.
