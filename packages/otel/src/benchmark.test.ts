import { expect, it } from 'vitest'

import { benchmarkLogs } from './benchmark'
import { claudeCode, fixtureText } from './testing'

it('parses and maps the 73 KB startup batch in under 2 ms of CPU, mean', async () => {
  const result = await benchmarkLogs(fixtureText(claudeCode.logsStartup))
  // `pnpm --filter @mitcsutt/embertrail-otel bench` prints this line.
  console.info(
    `parse + map, ${String(result.bytes)} bytes: CPU mean ${result.cpuMeanMs.toFixed(3)} ms; wall mean ${result.meanMs.toFixed(3)} ms, p95 ${result.p95Ms.toFixed(3)} ms`,
  )
  expect(result.bytes).toBeGreaterThan(72_000)
  // CPU, not wall-clock: `pnpm test` runs every package's suites at once, which stretches
  // wall-clock time several-fold on a busy runner without the parse getting any slower.
  expect(result.cpuMeanMs).toBeLessThan(2)
})
