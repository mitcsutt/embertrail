import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Each test starts its own in-process PGLite database, which takes a second or two on a
    // busy CI runner: well past the 5 s default once several run in parallel.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // One process per test file, so the benchmark's process.cpuUsage() is its own.
    pool: 'forks',
  },
})
