import { defineConfig, devices } from '@playwright/test'

// Chromium only, against the stack in e2e/stack.ts. Its origins are random per run, so the specs
// read them from the environment that e2e/global-setup.ts fills in.
export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: process.env.CI !== undefined,
  retries: process.env.CI === undefined ? 0 : 1,
  reporter: process.env.CI === undefined ? 'list' : [['list'], ['html', { open: 'never' }]],
  outputDir: 'test-results',
  use: { trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
