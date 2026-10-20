// The ingest CPU benchmark (#32): parse + map of a request body, excluding the database. The
// spike measured 0.37 ms mean for the 73 KB Claude Code startup batch; the target is < 2 ms.

import { mapLogs } from './map'

export interface BenchmarkResult {
  bytes: number
  iterations: number
  /** CPU time per iteration, median round: what a Worker is billed, and steadier under load. */
  cpuMeanMs: number
  /** Wall-clock time per iteration, which other processes on the machine inflate. */
  meanMs: number
  p95Ms: number
}

/**
 * Times `JSON.parse` + `mapLogs` over `body`, after a warm-up long enough for V8 to optimise.
 * The CPU mean is the median of `rounds` rounds' means, so one noisy round can't fail it.
 */
export async function benchmarkLogs(
  body: string,
  {
    warmup = 500,
    rounds = 5,
    iterations = 200,
  }: { warmup?: number; rounds?: number; iterations?: number } = {},
): Promise<BenchmarkResult> {
  const now = new Date()
  // No database: every Signal maps to one Account.
  const account = () => Promise.resolve('account')
  for (let i = 0; i < warmup; i += 1) await mapLogs(JSON.parse(body), now, account)
  const times: number[] = []
  const cpuMeans: number[] = []
  for (let round = 0; round < rounds; round += 1) {
    const cpu = process.cpuUsage()
    for (let i = 0; i < iterations; i += 1) {
      const start = performance.now()
      await mapLogs(JSON.parse(body), now, account)
      times.push(performance.now() - start)
    }
    const used = process.cpuUsage(cpu)
    cpuMeans.push((used.user + used.system) / 1000 / iterations)
  }
  const sorted = (values: number[]) => values.sort((a, b) => a - b)
  sorted(times)
  return {
    bytes: new TextEncoder().encode(body).byteLength,
    iterations: rounds * iterations,
    cpuMeanMs: sorted(cpuMeans)[Math.floor(rounds / 2)] ?? Number.NaN,
    meanMs: times.reduce((sum, t) => sum + t, 0) / times.length,
    p95Ms: times[Math.floor(times.length * 0.95)] ?? Number.NaN,
  }
}
