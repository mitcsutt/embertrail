// Builds and packs the client as npm would receive it, then lints the tarball
// with publint and attw. pnpm pack applies `publishConfig.exports`, so the
// published package points at dist/ while the workspace imports src/.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const run = (command: string, args: string[]): void => {
  execFileSync(command, args, { stdio: 'inherit' })
}

const destination = mkdtempSync(join(tmpdir(), 'embertrail-client-'))
try {
  run('pnpm', ['run', 'build'])
  run('pnpm', ['pack', '--pack-destination', destination])
  const tarball = readdirSync(destination).find((name) => name.endsWith('.tgz'))
  if (tarball === undefined) throw new Error(`pnpm pack wrote no tarball to ${destination}`)
  run('pnpm', ['exec', 'publint', 'run', '--strict', join(destination, tarball)])
  run('pnpm', ['exec', 'attw', '--profile', 'esm-only', join(destination, tarball)])
} finally {
  rmSync(destination, { recursive: true, force: true })
}
