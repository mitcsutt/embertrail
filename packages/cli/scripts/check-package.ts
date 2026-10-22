// Builds and packs the CLI as npm would receive it, installs the tarball into an empty directory
// outside the repository, and runs the installed binary: `--help`, and `migrate` against a
// scratch database when DATABASE_URL names a Postgres server.

import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import pg from 'pg'

const run = (command: string, args: string[], options: { env?: NodeJS.ProcessEnv } = {}): string =>
  execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    ...options,
  })

async function inScratchDatabase(serverUrl: string, use: (url: string) => void): Promise<void> {
  const name = `embertrail_cli_pack_${randomUUID().replaceAll('-', '')}`
  const admin = new pg.Client({ connectionString: serverUrl })
  await admin.connect()
  try {
    await admin.query(`create database ${name}`)
    const url = new URL(serverUrl)
    url.pathname = `/${name}`
    try {
      use(url.toString())
    } finally {
      await admin.query(`drop database if exists ${name} with (force)`)
    }
  } finally {
    await admin.end()
  }
}

const directory = mkdtempSync(join(tmpdir(), 'embertrail-cli-pack-'))
try {
  run('pnpm', ['run', 'build'])
  run('pnpm', ['pack', '--pack-destination', directory])
  const tarball = readdirSync(directory).find((name) => name.endsWith('.tgz'))
  if (tarball === undefined) throw new Error(`pnpm pack wrote no tarball to ${directory}`)

  const install = join(directory, 'install')
  run('npm', ['init', '-y', '--prefix', install])
  run('npm', ['install', '--no-audit', '--no-fund', '--prefix', install, join(directory, tarball)])
  const bin = join(install, 'node_modules', '.bin', 'embertrail')

  const help = run(bin, ['--help'])
  if (!help.includes('migrate'))
    throw new Error(`the installed embertrail --help lists no migrate:\n${help}`)

  const serverUrl = process.env.DATABASE_URL ?? ''
  if (serverUrl === '') {
    console.log('DATABASE_URL is not set: skipped migrate from the installed package')
  } else {
    await inScratchDatabase(serverUrl, (url) => {
      const migrate = (): string =>
        run(bin, ['migrate'], { env: { ...process.env, DATABASE_URL: url } })
      if (!migrate().includes('Applied'))
        throw new Error('migrate applied nothing to an empty database')
      if (!migrate().includes('up to date')) throw new Error('a second migrate was not a no-op')
    })
  }
  console.log('The packed CLI installs and runs.')
} finally {
  rmSync(directory, { recursive: true, force: true })
}
