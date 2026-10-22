import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // The integration test starts an in-process PGLite database, which takes a second or two on a
    // busy CI runner: well past the 5 s default once several packages test in parallel.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
