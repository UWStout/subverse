import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  root: 'client',
  build: {
    // Relative to root ('client'), so '../public' lands in the project root
    outDir: '../public',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Vendor libraries get their own stable chunks: they rarely change,
        // so students keep a cached copy across deploys, and no single chunk
        // trips Vite's 500 kB warning. App code (which changes often) stays
        // in the per-route chunks created by React.lazy in App.jsx.
        manualChunks: (id) => {
          if (!id.includes('node_modules')) return null
          if (id.includes('@mui/') || id.includes('@emotion/')) return 'vendor-mui'
          if (
            id.includes('/react/') ||
            id.includes('/react-dom/') ||
            id.includes('react-router') ||
            id.includes('/scheduler/')
          ) {
            return 'vendor-react'
          }
          return 'vendor'
        }
      }
    }
  },
  server: {
    port: 5173,
    // Trailing slashes are intentional: Vite matches proxy keys by prefix
    // (url.startsWith(key)), so a key like '/user' would also capture the
    // SPA route '/users' and forward it to Express, which 404s. With the
    // slash, only real API paths are proxied and client-side routes fall
    // through to Vite's index.html fallback (React Router takes over).
    proxy: {
      '/user/': {
        target: 'http://localhost:3000',
        changeOrigin: true
      },
      '/class/': {
        target: 'http://localhost:3000',
        changeOrigin: true
      },
      '/offering/': {
        target: 'http://localhost:3000',
        changeOrigin: true
      },
      '/project/': {
        target: 'http://localhost:3000',
        changeOrigin: true
      },
      '/auth/': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    }
  }
})

// NOTE: test configuration lives in vitest.config.js at the project root
// (both the client and server projects) - not here. This file is dev/build only.
