import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // Test files boot a PGLite Hub in beforeAll; a loaded CI runner needs more than the 10s default.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    setupFiles: ['./test/vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
  },
})
