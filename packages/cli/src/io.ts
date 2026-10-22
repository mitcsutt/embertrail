import { homedir } from 'node:os'

/** Everything a command touches outside its own arguments, so tests can swap each piece. */
export interface Io {
  env: Record<string, string | undefined>
  home: string
  fetch: typeof globalThis.fetch
  stdout(text: string | Uint8Array): void
  stderr(text: string): void
}

/** The real process: its environment, home directory, `fetch` and standard streams. */
export function processIo(): Io {
  return {
    env: process.env,
    home: homedir(),
    fetch: (input, init) => globalThis.fetch(input, init),
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  }
}
