import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { createServer } from 'node:net'
import { homedir, hostname } from 'node:os'

/** How `Io.exec` treats a program's output. */
export interface ExecOptions {
  /** `capture` (the default) collects stdout and stderr; `inherit` shows them as they come. */
  output?: 'capture' | 'inherit'
  /** Writes stdout to this file, mode 600, instead of collecting it. */
  stdoutFile?: string
}

export interface ExecResult {
  code: number
  stdout: string
  stderr: string
}

/** Everything a command touches outside its own arguments, so tests can swap each piece. */
export interface Io {
  env: Record<string, string | undefined>
  home: string
  /** This machine's name, which the local stack names its Source after. */
  hostname: string
  fetch: typeof globalThis.fetch
  stdout(text: string | Uint8Array): void
  stderr(text: string): void
  /** Runs a program (only `docker` today). Rejects when it cannot start, such as ENOENT. */
  exec(program: string, args: readonly string[], options?: ExecOptions): Promise<ExecResult>
  /** Whether nothing listens on `port` on 127.0.0.1. */
  portFree(port: number): Promise<boolean>
}

function exec(
  program: string,
  args: readonly string[],
  options: ExecOptions = {},
): Promise<ExecResult> {
  const inherit = options.output === 'inherit'
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, {
      stdio: [
        'ignore',
        inherit && options.stdoutFile === undefined ? 'inherit' : 'pipe',
        inherit ? 'inherit' : 'pipe',
      ],
    })
    let stdout = ''
    let stderr = ''
    // With a file, the result waits for the file to be flushed as well as for the program.
    let written: Promise<void> = Promise.resolve()
    if (options.stdoutFile !== undefined) {
      const file = createWriteStream(options.stdoutFile, { mode: 0o600 })
      written = new Promise((done, failed) => {
        file.once('finish', done)
        file.once('error', failed)
      })
      child.stdout?.pipe(file)
    } else {
      child.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
    }
    child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    child.once('error', reject)
    child.once('close', (code) => {
      written.then(() => {
        resolve({ code: code ?? 1, stdout, stderr })
      }, reject)
    })
  })
}

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', () => {
      resolve(false)
    })
    server.listen(port, '127.0.0.1', () => {
      server.close(() => {
        resolve(true)
      })
    })
  })
}

/** The real process: its environment, home directory, `fetch`, standard streams and programs. */
export function processIo(): Io {
  return {
    env: process.env,
    home: homedir(),
    hostname: hostname(),
    fetch: (input, init) => globalThis.fetch(input, init),
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    exec,
    portFree,
  }
}
