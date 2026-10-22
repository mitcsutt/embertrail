import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Most tests start a Hub on PGLite, which takes a second or two on a busy CI runner.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
