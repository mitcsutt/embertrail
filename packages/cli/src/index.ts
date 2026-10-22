// The `embertrail` command-line tool. `bin.ts` runs it; tests call `run` with their own `Io`.

export { run } from './cli.ts'
export { processIo } from './io.ts'
export type { Io } from './io.ts'
export { applyTelemetry, telemetryEnv } from './claude-code.ts'
