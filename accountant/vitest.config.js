import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./test/setup.js'],
    include: ['test/**/*.test.js'],
    coverage: {
      provider: 'v8',
      include: ['server/routes/**/*.js'],
      exclude: ['server/server.js', 'server/db.js']
    }
  }
})
