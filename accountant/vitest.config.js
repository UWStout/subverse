import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Single vitest config for both test suites, split into two projects:
//   - client: jsdom + React plugin + jest-dom matchers (client/test/**)
//   - server: node + Prisma/bcrypt mocks            (server/test/**)
//
// Deliberately does NOT merge vite.config.js: that file sets `root: 'client'`
// (for dev/build) which breaks vitest when run from the project root, and it
// carries no settings tests need beyond the React plugin.

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [react()],
        test: {
          name: 'client',
          environment: 'jsdom',
          globals: true,
          setupFiles: ['./client/test/setup.js'],
          include: ['client/test/**/*.test.{js,jsx}'],
          css: true,
          coverage: {
            provider: 'v8',
            include: ['client/src/**/*.{js,jsx}'],
            exclude: ['client/src/main.jsx']
          }
        }
      },
      {
        test: {
          name: 'server',
          environment: 'node',
          globals: true,
          setupFiles: ['./server/test/setup.js'],
          include: ['server/test/**/*.test.js'],
          coverage: {
            provider: 'v8',
            include: ['server/routes/**/*.js'],
            exclude: ['server/server.js', 'server/db.js']
          }
        }
      }
    ]
  }
})
