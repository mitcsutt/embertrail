import { mkdir, readdir, readFile, rename, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { isProblemError } from '@mitcsutt/embertrail-client'

import type { Args } from '../args.ts'
import {
  applyTelemetry,
  readSettings,
  removeTelemetry,
  telemetryEndpoint,
  telemetryOf,
  userSettingsPath,
  writeSettings,
} from '../claude-code.ts'
import { hubClient } from '../command.ts'
import type { Command, Context } from '../command.ts'
import {
  configPath,
  readStoredConfig,
  resolveTarget,
  writePrivateFile,
  writeConfig,
} from '../config.ts'
import { CliError, UsageError } from '../errors.ts'
import type { Io } from '../io.ts'
import {
  compose,
  dashboardUrl,
  defaultDashboardPort,
  defaultHubPort,
  defaultProject,
  hubUrl,
  imageTag,
  newState,
  readStack,
  requireDocker,
  sourceName,
  stackDir,
  writeStack,
} from '../local/stack.ts'
import type { Stack, StackState } from '../local/stack.ts'
import { columns } from '../output.ts'
import { connectClaudeCode } from './setup.ts'

/** The Scopes the Dashboard reads and writes with (docs/dashboard.md). */
const dashboardScopes = ['otel:read', 'store:read', 'store:write']

function port(args: Args, name: string): number | undefined {
  const text = args.string(name)
  if (text === undefined) return undefined
  const value = Number(text)
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new UsageError(`--${name} ${text} is not a port`)
  }
  return value
}

/** Compose's progress goes to the terminal, unless the output is JSON. */
const progress = (ctx: Context) => (ctx.json ? {} : { output: 'inherit' as const })

async function requireStack(io: Io): Promise<Stack> {
  const stack = await readStack(io)
  if (stack === undefined) {
    throw new CliError('There is no local stack on this machine; run embertrail up')
  }
  return stack
}

/** The stack `up` runs: the stored one with any new ports or checkout, or a new one. */
async function prepare(ctx: Context, args: Args): Promise<Stack> {
  const hubPort = port(args, 'hub-port')
  const dashboardPort = port(args, 'dashboard-port')
  const buildFrom = args.string('build-from')
  const project = args.string('project')
  const stored = await readStack(ctx.io)
  if (stored !== undefined && project !== undefined && project !== stored.state.project) {
    throw new CliError(
      `The local stack is the Compose project "${stored.state.project}"; run embertrail reset --yes before starting another`,
    )
  }
  if (stored === undefined) {
    const name = project ?? defaultProject
    // A volume without its state holds a database whose password and admin Token are gone.
    const volumes = await ctx.io.exec('docker', [
      'volume',
      'ls',
      '--quiet',
      '--filter',
      `label=com.docker.compose.project=${name}`,
    ])
    const volume = volumes.stdout.trim().split('\n')[0] ?? ''
    if (volume !== '') {
      throw new CliError(
        `The Docker volume ${volume} holds an earlier local stack's database, but this machine's state for it is gone (${stackDir(ctx.io)}). ` +
          `To start over, delete it with docker volume rm ${volume} and run embertrail up again.`,
      )
    }
  }
  const state: StackState = {
    ...(stored?.state ??
      newState({
        project: project ?? defaultProject,
        hubPort: defaultHubPort,
        dashboardPort: defaultDashboardPort,
        buildFrom: null,
      })),
    ...(hubPort === undefined ? {} : { hubPort }),
    ...(dashboardPort === undefined ? {} : { dashboardPort }),
    ...(buildFrom === undefined ? {} : { buildFrom: resolve(buildFrom) }),
  }
  // A port the stack does not hold yet must be free, or Compose fails halfway through.
  for (const [name, wanted, held] of [
    ['hub-port', state.hubPort, stored?.state.hubPort],
    ['dashboard-port', state.dashboardPort, stored?.state.dashboardPort],
  ] as const) {
    if (wanted !== held && !(await ctx.io.portFree(wanted))) {
      throw new CliError(
        `Port ${String(wanted)} is in use on this machine; choose another with --${name} <port>`,
      )
    }
  }
  return { dir: stored?.dir ?? stackDir(ctx.io), state }
}

const configBackup = (io: Io) => `${configPath(io)}.backup`
const settingsBackup = (settingsPath: string) => `${settingsPath}.embertrail-backup`

async function readIfThere(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/** A backup to write: its path and text, or undefined when the same one is already there. */
interface Backup {
  path: string
  text: string
}

/** Refuses an earlier, different backup, so a refusal costs nothing. */
async function planBackup(path: string, text: string): Promise<Backup | undefined> {
  const earlier = await readIfThere(path)
  if (earlier === text) return undefined
  if (earlier !== undefined) {
    throw new CliError(
      `${path} is an earlier backup; restore it or delete it, then run embertrail up --switch again. Nothing was changed.`,
    )
  }
  return { path, text }
}

const writeBackup = async (backup: Backup | undefined) => {
  if (backup !== undefined) await writePrivateFile(backup.path, backup.text)
}

/** The management Token, from bootstrapping the Hub the first time. */
async function bootstrap(ctx: Context, stack: Stack): Promise<string> {
  if (stack.state.managementToken !== null) return stack.state.managementToken
  const hub = hubUrl(stack.state)
  try {
    const { token } = await hubClient(ctx.io, hub, stack.state.bootstrapToken).bootstrap({
      body: {},
    })
    return token
  } catch (error) {
    if (isProblemError(error) && error.status === 401) {
      throw new CliError(
        `The Hub at ${hub} already has its admin, and this machine lost the Token for them. ` +
          'Run embertrail login with a Token you kept, or embertrail reset --yes to delete the stack and its data and start over.',
      )
    }
    throw error
  }
}

const up: Command = {
  path: ['up'],
  summary: 'Start a Hub and Dashboard on this machine and connect Claude Code',
  description:
    'The first run creates the local stack (Docker Compose: the Hub, Postgres and the Dashboard, on 127.0.0.1), ' +
    "bootstraps the Hub, logs this CLI in, gives the Dashboard its own Token and points this machine's Claude Code at the Hub. " +
    'Later runs start what is stopped and change nothing else. Everything it creates is in the local stack directory ' +
    '($EMBERTRAIL_LOCAL_DIR, else ~/.local/share/embertrail/local). ' +
    'A login or Claude Code target for another Hub is kept as it is; --switch backs it up and replaces it, and reset restores it.',
  options: {
    switch: {
      type: 'boolean',
      description:
        "Replace this CLI's login and Claude Code's telemetry target when they are for another Hub, backing them up first",
    },
    source: {
      type: 'string',
      value: 'name',
      description: "The Source Claude Code sends as (default: this machine's name)",
    },
    'no-claude-code': {
      type: 'boolean',
      description: "Leave Claude Code's settings alone",
    },
    'hub-port': {
      type: 'string',
      value: 'port',
      description: `The Hub's port on 127.0.0.1 (default ${String(defaultHubPort)})`,
    },
    'dashboard-port': {
      type: 'string',
      value: 'port',
      description: `The Dashboard's port on 127.0.0.1 (default ${String(defaultDashboardPort)})`,
    },
    'build-from': {
      type: 'string',
      value: 'dir',
      description: 'Build the images from this checkout instead of pulling them (remembered)',
    },
    project: {
      type: 'string',
      value: 'name',
      description: `The Compose project, chosen at the first run (default ${defaultProject})`,
    },
  },
  async run(ctx, args) {
    await requireDocker(ctx.io)
    const earlier = await readStack(ctx.io)
    const stack = await prepare(ctx, args)
    const hub = hubUrl(stack.state)

    // What belongs to another Hub is decided before anything starts, so a refusal costs nothing.
    const switching = args.flag('switch')
    const connect = !args.flag('no-claude-code')
    const settingsPath = userSettingsPath(ctx.io)
    const settings = connect ? await readSettings(settingsPath) : {}
    const stored = await readStoredConfig(ctx.io)
    // Only what this stack wrote is its own: its management Token, and settings of a connected stack.
    const otherLogin =
      stored !== undefined &&
      (earlier?.state.managementToken === undefined ||
        earlier.state.managementToken === null ||
        stored.token !== earlier.state.managementToken)
    const target = telemetryEndpoint(settings)
    const otherTarget =
      target !== undefined &&
      (earlier?.state.source === undefined || target !== hubUrl(earlier.state))
    const loginBackup =
      switching && otherLogin
        ? await planBackup(configBackup(ctx.io), `${JSON.stringify(stored, null, 2)}\n`)
        : undefined
    const targetBackup =
      switching && otherTarget
        ? await planBackup(
            settingsBackup(settingsPath),
            `${JSON.stringify(telemetryOf(settings), null, 2)}\n`,
          )
        : undefined

    await writeStack(stack)
    const build = stack.state.buildFrom === null ? [] : ['--build']

    // The Hub first: the Dashboard's Token comes from it.
    await compose(ctx.io, stack, ['up', '--detach', '--wait', ...build, 'hub'], progress(ctx))
    const managementToken = await bootstrap(ctx, stack)
    stack.state.managementToken = managementToken
    await writeStack(stack)

    const client = hubClient(ctx.io, hub, managementToken)
    if (stack.state.dashboardToken === null) {
      const issued = await client.issueToken({
        body: { kind: 'management', scopes: dashboardScopes, name: 'dashboard' },
      })
      stack.state.dashboardToken = issued.token
      await writeStack(stack)
    }
    await compose(ctx.io, stack, ['up', '--detach', '--wait', ...build], progress(ctx))

    const keepLogin = otherLogin && !switching
    if (!keepLogin) await writeBackup(loginBackup)
    const config = keepLogin
      ? configPath(ctx.io)
      : await writeConfig(ctx.io, { hub, token: managementToken })
    const overridden = keepLogin ? undefined : await overrideNote(ctx.io, hub, managementToken)

    const keepTarget = connect && otherTarget && !switching
    let claudeCode = null
    if (connect && !keepTarget) {
      const source = args.string('source') ?? stack.state.source ?? sourceName(ctx.io.hostname)
      await writeBackup(targetBackup)
      claudeCode = await connectClaudeCode({
        hub,
        managementToken,
        client,
        name: source,
        path: settingsPath,
      })
      stack.state.source = source
      await writeStack(stack)
    }

    const kept = [
      ...(keepLogin ? [`this CLI's login to ${stored.hub}`] : []),
      ...(keepTarget ? [`Claude Code's target ${target}`] : []),
    ]

    const dashboard = dashboardUrl(stack.state)
    ctx.print(
      {
        running: true,
        dashboard,
        hub,
        config,
        dir: stack.dir,
        kept_login: keepLogin,
        kept_claude_code: keepTarget,
        claude_code:
          claudeCode === null
            ? null
            : {
                source: claudeCode.source,
                settings: claudeCode.settings,
                changed: claudeCode.changed,
              },
      },
      [
        'Embertrail is running.',
        '',
        columns([
          ['  Dashboard', dashboard],
          ['  Hub', `${hub}  (API reference: ${hub}/api/v1/docs)`],
        ]),
        '',
        ...(claudeCode === null
          ? connect
            ? []
            : ["Claude Code's settings were left alone (--no-claude-code)."]
          : [
              `Claude Code on this machine sends to the Hub as Source "${claudeCode.source.name}" (${claudeCode.settings}).`,
              claudeCode.changed
                ? 'Start a new Claude Code session; its first Metrics and Events show on the Dashboard.'
                : 'Its settings already pointed here, so they were kept.',
            ]),
        ...(kept.length === 0
          ? []
          : [
              `Kept ${kept.join(' and ')}, which ${kept.length === 1 ? 'is' : 'are'} for another Hub. embertrail up --switch points ${kept.length === 1 ? 'it' : 'them'} here, backing up the old ${kept.length === 1 ? 'one' : 'ones'} beside ${kept.length === 1 ? 'it' : 'them'}.`,
            ]),
        ...(overridden === undefined
          ? []
          : [overridden]),
        '',
        columns([
          ['  embertrail status', 'what is running, and where'],
          ['  embertrail down', 'stop it (your data stays)'],
        ]),
      ].join('\n'),
    )
  },
}

/** What `up` tells the user when the environment keeps this CLI off the login it just stored. */
async function overrideNote(io: Io, hub: string, token: string): Promise<string | undefined> {
  let effective
  try {
    effective = await resolveTarget(io)
  } catch (error) {
    return `EMBERTRAIL_HUB is set but unusable (${error instanceof Error ? error.message : String(error)}), so this CLI will not reach this Hub until you fix or unset it.`
  }
  if (effective.hub !== undefined && effective.hub !== hub) {
    return `EMBERTRAIL_HUB is set, so this CLI keeps using ${effective.hub} until you unset it${effective.token === undefined ? ', and it has no Token for that Hub (embertrail login --hub <url> --token <token>)' : ''}.`
  }
  return effective.token === token
    ? undefined
    : 'EMBERTRAIL_TOKEN is set, so this CLI uses it instead of the Token up just stored, until you unset it.'
}

interface ServiceState {
  service: string
  state: string
  health: string
}

/** `docker compose ps --format json`: one JSON object per line, or one array on older Compose. */
function services(text: string): ServiceState[] {
  const trimmed = text.trim()
  if (trimmed === '') return []
  const rows = (
    trimmed.startsWith('[')
      ? (JSON.parse(trimmed) as unknown[])
      : trimmed.split('\n').map((line) => JSON.parse(line) as unknown)
  ) as { Service?: string; State?: string; Health?: string }[]
  return rows.map((row) => ({
    service: row.Service ?? '?',
    state: row.State ?? '?',
    health: row.Health ?? '',
  }))
}

async function answers(io: Io, url: string): Promise<boolean> {
  try {
    const response = await io.fetch(url, { signal: AbortSignal.timeout(3000) })
    return response.ok
  } catch {
    return false
  }
}

const status: Command = {
  path: ['status'],
  summary: "The local stack's services, health and URLs",
  description:
    "Shows each service of the local stack, whether the Hub and the Dashboard answer, and whether this machine's Claude Code sends to the Hub.",
  async run(ctx) {
    const stack = await readStack(ctx.io)
    if (stack === undefined) {
      ctx.print({ exists: false }, 'There is no local stack on this machine; run embertrail up')
      return
    }
    const hub = hubUrl(stack.state)
    const dashboard = dashboardUrl(stack.state)
    const [listed, hubUp, dashboardUp, settings] = await Promise.all([
      compose(ctx.io, stack, ['ps', '--all', '--format', 'json']).then(services),
      answers(ctx.io, `${hub}/api/v1/openapi.json`),
      answers(ctx.io, `${dashboard}/config.json`),
      readSettings(userSettingsPath(ctx.io)).catch(() => ({})),
    ])
    const claudeCode = telemetryEndpoint(settings) === hub
    const running = hubUp && dashboardUp
    ctx.print(
      {
        exists: true,
        running,
        hub: { url: hub, healthy: hubUp },
        dashboard: { url: dashboard, healthy: dashboardUp },
        claude_code: claudeCode,
        images: stack.state.imageTag,
        services: listed,
        dir: stack.dir,
      },
      [
        running
          ? 'Embertrail is running.'
          : listed.length === 0
            ? 'Embertrail is stopped; embertrail up starts it.'
            : 'Embertrail is not healthy; embertrail logs shows why, embertrail up restarts it.',
        '',
        columns([
          ['  Dashboard', dashboard, dashboardUp ? 'ok' : 'not answering'],
          ['  Hub', hub, hubUp ? 'ok' : 'not answering'],
        ]),
        '',
        columns(
          listed.map((row) => [
            `  ${row.service}`,
            row.health === '' ? row.state : `${row.state} (${row.health})`,
          ]),
        ),
        ...(listed.length === 0 ? [] : ['']),
        claudeCode
          ? 'Claude Code on this machine sends to this Hub.'
          : 'Claude Code on this machine does not send to this Hub; embertrail up connects it.',
        `Images: ${stack.state.imageTag}${stack.state.buildFrom === null ? '' : ` (built from ${stack.state.buildFrom})`}. Files: ${stack.dir}`,
      ].join('\n'),
    )
  },
}

const down: Command = {
  path: ['down'],
  summary: 'Stop the local stack; its data stays',
  description:
    'Stops and removes the containers of the local stack. The database volume and the local stack directory stay, so embertrail up brings back the same Hub.',
  async run(ctx) {
    await requireDocker(ctx.io)
    const stack = await requireStack(ctx.io)
    await compose(ctx.io, stack, ['down'], progress(ctx))
    ctx.print({ running: false }, 'Stopped. Your data stays; embertrail up starts it again.')
  },
}

const upgrade: Command = {
  path: ['upgrade'],
  summary: "Snapshot the database, then move the stack to this CLI's version",
  description:
    "Takes a pg_dump snapshot into the local stack directory's backups/, then runs the images this CLI belongs to " +
    '(or --version), pulling them, or rebuilding them from the checkout given to --build-from. ' +
    'Migrations only go forward: to go back, restore the snapshot into an older version.',
  options: {
    version: {
      type: 'string',
      value: 'tag',
      description: `The image tag to run (default: this CLI's, ${imageTag})`,
    },
  },
  async run(ctx, args) {
    await requireDocker(ctx.io)
    const stack = await requireStack(ctx.io)
    const from = stack.state.imageTag
    const backups = join(stack.dir, 'backups')
    await mkdir(backups, { recursive: true, mode: 0o700 })
    const snapshot = join(
      backups,
      `embertrail-${new Date().toISOString().replaceAll(':', '-')}.sql`,
    )
    // `up --wait` on Postgres alone, so a stopped stack can be snapshotted too.
    await compose(ctx.io, stack, ['up', '--detach', '--wait', 'postgres'], progress(ctx))
    await compose(
      ctx.io,
      stack,
      ['exec', '-T', 'postgres', 'pg_dump', '-U', 'embertrail', 'embertrail'],
      { stdoutFile: snapshot },
    )

    stack.state.imageTag = args.string('version') ?? imageTag
    await writeStack(stack)
    if (stack.state.buildFrom === null) {
      try {
        await compose(ctx.io, stack, ['pull'], progress(ctx))
      } catch (error) {
        stack.state.imageTag = from
        await writeStack(stack)
        throw error
      }
    }
    try {
      await compose(
        ctx.io,
        stack,
        ['up', '--detach', '--wait', ...(stack.state.buildFrom === null ? [] : ['--build'])],
        progress(ctx),
      )
    } catch (error) {
      throw new CliError(
        `${error instanceof Error ? error.message : String(error)}\n` +
          `The stack stays on ${stack.state.imageTag}, because its Hub may already have migrated the database and migrations only go forward. ` +
          `The database before the upgrade is in ${snapshot}.`,
      )
    }
    ctx.print(
      { from, to: stack.state.imageTag, snapshot },
      [
        `Upgraded the local stack from ${from} to ${stack.state.imageTag}.`,
        `The database before the upgrade is in ${snapshot}.`,
      ].join('\n'),
    )
  },
}

const reset: Command = {
  path: ['reset'],
  summary: 'Delete the local stack, its data and its Tokens',
  description:
    'Removes the containers and the database volume, the local stack directory (keeping backups/), ' +
    "the CLI's login when it is to this Hub, and Claude Code's telemetry settings when they send here. " +
    'There is no undo, so it needs --yes.',
  options: {
    yes: { type: 'boolean', description: 'Delete it: the Hub and every row it holds' },
  },
  async run(ctx, args) {
    const stack = await requireStack(ctx.io)
    const hub = hubUrl(stack.state)
    if (!args.flag('yes')) {
      throw new CliError(
        `This deletes the local Hub at ${hub} and every row it holds; run embertrail reset --yes to go ahead`,
      )
    }
    await requireDocker(ctx.io)
    await compose(ctx.io, stack, ['down', '--volumes', '--remove-orphans'], progress(ctx))

    const settingsPath = userSettingsPath(ctx.io)
    const settings = await readSettings(settingsPath).catch(() => undefined)
    const unhooked =
      settings !== undefined &&
      stack.state.source !== undefined &&
      telemetryEndpoint(settings) === hub
    const savedTarget = await readIfThere(settingsBackup(settingsPath))
    if (unhooked) {
      const bare = removeTelemetry(settings)
      await writeSettings(
        settingsPath,
        savedTarget === undefined
          ? bare
          : applyTelemetry(bare, JSON.parse(savedTarget) as Record<string, string>),
      )
      await rm(settingsBackup(settingsPath), { force: true })
    }

    const config = await readStoredConfig(ctx.io).catch(() => undefined)
    const loggedOut = config?.token === stack.state.managementToken
    const savedLogin = loggedOut && (await readIfThere(configBackup(ctx.io))) !== undefined
    if (loggedOut) {
      if (savedLogin) await rename(configBackup(ctx.io), configPath(ctx.io))
      else await rm(configPath(ctx.io), { force: true })
    }

    for (const entry of await readdir(stack.dir)) {
      if (entry !== 'backups') await rm(join(stack.dir, entry), { recursive: true, force: true })
    }

    ctx.print(
      {
        deleted: true,
        claude_code_unhooked: unhooked,
        logged_out: loggedOut,
        restored_login: savedLogin,
        restored_claude_code: unhooked && savedTarget !== undefined,
      },
      [
        'Deleted the local stack and its data.',
        ...(unhooked
          ? [
              savedTarget === undefined
                ? `Removed the telemetry settings from ${settingsPath}.`
                : `Restored the earlier telemetry settings in ${settingsPath}.`,
            ]
          : []),
        ...(loggedOut
          ? [
              savedLogin
                ? `Restored this CLI's earlier login in place of the one to ${hub}.`
                : `Removed this CLI's login to ${hub}.`,
            ]
          : []),
        'embertrail up starts a new one.',
      ].join('\n'),
    )
  },
}

const logs: Command = {
  path: ['logs'],
  summary: "The local stack's logs",
  description: 'Prints the logs of every service of the local stack, or of one.',
  options: {
    follow: { type: 'boolean', short: 'f', description: 'Keep printing new lines' },
  },
  positionals: [
    { name: 'service', description: 'hub, dashboard or postgres (default: all)', optional: true },
  ],
  async run(ctx, args) {
    const stack = await requireStack(ctx.io)
    await compose(
      ctx.io,
      stack,
      ['logs', ...(args.flag('follow') ? ['--follow'] : []), ...args.positionals],
      { output: 'inherit' },
    )
  },
}

/** The local stack: one Hub and Dashboard on this machine, run by the CLI (docs/local-stack.md). */
export const localCommands: readonly Command[] = [up, status, down, upgrade, reset, logs]
