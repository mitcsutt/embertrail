import { randomBytes } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { isMap, parseDocument } from 'yaml'

import composeTemplate from '../../../../compose.yaml?raw'
import manifest from '../../package.json' with { type: 'json' }
import { writePrivateFile } from '../config.ts'
import { CliError } from '../errors.ts'
import type { ExecOptions, Io } from '../io.ts'

/** The Compose project `up` creates, apart from a stack started by hand from a clone. */
export const defaultProject = 'embertrail-local'
export const defaultHubPort = 8787
export const defaultDashboardPort = 8080

/** The image tag this CLI runs: its own version, or `latest` before the first release. */
export const imageTag = manifest.version === '0.0.0' ? 'latest' : manifest.version

/** What the local stack directory's `state.json` holds; everything else is rendered from it. */
export interface StackState {
  project: string
  hubPort: number
  dashboardPort: number
  /** `EMBERTRAIL_VERSION`: the tag both images run. */
  imageTag: string
  /** A checkout to build the images from instead of pulling them, before images are published. */
  buildFrom: string | null
  postgresPassword: string
  /** The Hub's `BOOTSTRAP_TOKEN`, which `up` exchanges for the management Token once. */
  bootstrapToken: string
  managementToken: string | null
  /** The narrower Token the Dashboard's proxy sends. */
  dashboardToken: string | null
  /** The Source Claude Code was connected as, so a later `up` keeps it. */
  source?: string
}

export interface Stack {
  dir: string
  state: StackState
}

/**
 * The local stack directory: `$EMBERTRAIL_LOCAL_DIR`, else `$XDG_DATA_HOME/embertrail/local`, else
 * `~/.local/share/embertrail/local`.
 */
export function stackDir(io: Io): string {
  return (
    io.env.EMBERTRAIL_LOCAL_DIR ??
    join(io.env.XDG_DATA_HOME ?? join(io.home, '.local', 'share'), 'embertrail', 'local')
  )
}

export const hubUrl = (state: StackState) => `http://localhost:${String(state.hubPort)}`
export const dashboardUrl = (state: StackState) => `http://localhost:${String(state.dashboardPort)}`

/** The stack this machine has, or undefined before the first `up`. */
export async function readStack(io: Io): Promise<Stack | undefined> {
  const dir = stackDir(io)
  const path = join(dir, 'state.json')
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  try {
    return { dir, state: JSON.parse(text) as StackState }
  } catch {
    throw new CliError(`${path} is not valid JSON; fix it, or run embertrail reset --yes`)
  }
}

export function newState(options: {
  project: string
  hubPort: number
  dashboardPort: number
  buildFrom: string | null
}): StackState {
  return {
    ...options,
    imageTag,
    postgresPassword: randomBytes(24).toString('hex'),
    bootstrapToken: randomBytes(32).toString('hex'),
    managementToken: null,
    dashboardToken: null,
  }
}

/**
 * The repository's `compose.yaml` as this stack runs it: the images are pulled, so the `build`
 * sections go, unless the stack builds from a checkout, when their contexts point into it.
 */
export function composeFile(buildFrom: string | null): string {
  const document = parseDocument(composeTemplate)
  const services = document.get('services')
  if (!isMap(services)) throw new Error('The bundled compose.yaml has no services')
  for (const { value: service } of services.items) {
    if (!isMap(service)) continue
    const build = service.get('build')
    if (build === undefined) continue
    if (buildFrom === null) {
      service.delete('build')
      continue
    }
    // `build: .` or `build: { context, dockerfile }`.
    const spec = isMap(build)
      ? (build.toJSON() as { context?: string; dockerfile?: string })
      : { context: typeof build === 'string' ? build : '.' }
    service.set(
      'build',
      document.createNode({
        context: resolve(buildFrom, spec.context ?? '.'),
        ...(spec.dockerfile === undefined ? {} : { dockerfile: spec.dockerfile }),
      }),
    )
  }
  return [
    '# Written by `embertrail up` from the compose.yaml bundled with the CLI; edits are overwritten.',
    '# docs/local-stack.md',
    document.toString(),
  ].join('\n')
}

/** What Compose substitutes into the file. Every value is generated or a number, so none needs quoting. */
function envFile(state: StackState): string {
  const values: Record<string, string> = {
    EMBERTRAIL_PORT: String(state.hubPort),
    DASHBOARD_PORT: String(state.dashboardPort),
    EMBERTRAIL_VERSION: state.imageTag,
    POSTGRES_PASSWORD: state.postgresPassword,
    BOOTSTRAP_TOKEN: state.bootstrapToken,
    EMBERTRAIL_DASHBOARD_TOKEN: state.dashboardToken ?? '',
  }
  return Object.entries(values)
    .map(([key, value]) => `${key}=${value}\n`)
    .join('')
}

/** Writes the state and the two files Compose reads, all readable only by the user. */
export async function writeStack(stack: Stack): Promise<void> {
  await mkdir(stack.dir, { recursive: true, mode: 0o700 })
  await writePrivateFile(join(stack.dir, 'state.json'), `${JSON.stringify(stack.state, null, 2)}\n`)
  await writePrivateFile(join(stack.dir, 'compose.yaml'), composeFile(stack.state.buildFrom))
  await writePrivateFile(join(stack.dir, '.env'), envFile(stack.state))
}

/** Runs `docker compose` on this stack, with the Dashboard's profile on. */
export async function compose(
  io: Io,
  stack: Stack,
  args: readonly string[],
  options: ExecOptions = {},
): Promise<string> {
  const result = await io.exec(
    'docker',
    [
      'compose',
      '--project-name',
      stack.state.project,
      '--file',
      join(stack.dir, 'compose.yaml'),
      '--env-file',
      join(stack.dir, '.env'),
      '--profile',
      'dashboard',
      ...args,
    ],
    options,
  )
  if (result.code !== 0) {
    const detail = result.stderr.trim()
    throw new CliError(
      `docker compose ${args[0] ?? ''} failed (exit ${String(result.code)})${detail === '' ? '' : `:\n${detail}`}`,
    )
  }
  return result.stdout
}

/** Fails with a sentence when Docker with Compose v2 is missing or not running. */
export async function requireDocker(io: Io): Promise<void> {
  let version
  try {
    version = await io.exec('docker', ['compose', 'version'])
  } catch {
    throw new CliError(
      'The local stack runs in Docker, and no docker command was found. Install Docker Desktop or Docker Engine with Compose, then run this again.',
    )
  }
  if (version.code !== 0) {
    throw new CliError(
      'docker is installed but has no Compose v2 (docker compose); install the Compose plugin, then run this again.',
    )
  }
  const info = await io.exec('docker', ['info', '--format', '{{.ServerVersion}}'])
  if (info.code !== 0) {
    throw new CliError('Docker is installed but not running; start it, then run this again.')
  }
}

/** This machine's name as a Source name (`^[a-z0-9][a-z0-9-]{0,63}$`), else `laptop`. */
export function sourceName(hostname: string): string {
  const name = hostname
    .split('.')[0]
    ?.toLowerCase()
    .replaceAll(/[^a-z0-9-]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/, '')
  return name === undefined || name === '' ? 'laptop' : name
}
