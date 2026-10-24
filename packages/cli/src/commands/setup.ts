import {
  applyTelemetry,
  readSettings,
  telemetryEnv,
  userSettingsPath,
  writeSettings,
} from '../claude-code.ts'
import type { EmbertrailClient, Schemas } from '@mitcsutt/embertrail-client'

import type { Command } from '../command.ts'
import { findSource, issueIngestToken, tokenId } from '../ingest.ts'
import { printable } from '../output.ts'

/** The ingest Token the settings already send to `hub`, if they do. */
function configuredToken(settings: Record<string, unknown>, hub: string): string | undefined {
  const env = settings.env
  if (typeof env !== 'object' || env === null) return undefined
  const { OTEL_EXPORTER_OTLP_ENDPOINT: endpoint, OTEL_EXPORTER_OTLP_HEADERS: headers } =
    env as Record<string, unknown>
  if (endpoint !== hub || typeof headers !== 'string') return undefined
  return /^Authorization=Bearer (et_\S+)$/.exec(headers)?.[1]
}

export interface ClaudeCodeResult {
  source: Schemas['Source']
  /** Whether the Source was created now, rather than found. */
  created: boolean
  settings: string
  /** Whether the settings file was written. */
  changed: boolean
}

/**
 * Points Claude Code's settings in `path` at `hub` as the Source `name`: the logic of
 * `setup claude-code`, which `up` runs too. `client` is logged in with `managementToken`.
 */
export async function connectClaudeCode(options: {
  hub: string
  managementToken: string
  client: EmbertrailClient
  name: string
  path: string
}): Promise<ClaudeCodeResult> {
  const { hub, managementToken, client, name, path } = options
  // Read before creating anything, so a settings file that cannot be changed costs nothing.
  const settings = await readSettings(path)

  const existing = await findSource(client, name)
  let source
  let ingestToken: string
  if (existing === undefined) {
    const created = await client.createSource({ body: { name } })
    source = created.source
    ingestToken = created.token.token
  } else {
    source = existing
    const tokens = (await client.listTokens()).items
    const configured = configuredToken(settings, hub)
    const kept = tokens.find(
      (record) =>
        record.id === (configured === undefined ? undefined : tokenId(configured)) &&
        record.kind === 'ingest' &&
        record.source_id === existing.id &&
        record.revoked_at === null &&
        (record.expires_at === null || Date.parse(record.expires_at) > Date.now()),
    )
    if (configured !== undefined && kept !== undefined) {
      ingestToken = configured
    } else {
      ingestToken = (
        await issueIngestToken(client, managementToken, existing, {
          name: `claude-code on ${name}`,
        })
      ).token
    }
  }

  const changed = await writeSettings(
    path,
    applyTelemetry(settings, telemetryEnv(hub, ingestToken)),
  )
  return { source, created: existing === undefined, settings: path, changed }
}

export const setupClaudeCode: Command = {
  path: ['setup', 'claude-code'],
  summary: "Send this machine's Claude Code telemetry to the Hub",
  description:
    'Creates the Source and its ingest Token, then writes the telemetry env block into your user ' +
    'Claude Code settings (~/.claude/settings.json, or $CLAUDE_CONFIG_DIR/settings.json): ' +
    'Metrics and Events on, over http/json, authenticated by the Token. Your other settings are kept, ' +
    "and traces are never enabled. Running it again keeps the Source's Token already in the file while it is active, so nothing changes; " +
    'a file with no active Token for the Source gets a new one.',
  options: {
    source: {
      type: 'string',
      value: 'name',
      required: true,
      description: 'The Source to send as, usually this machine (created if new)',
    },
    settings: {
      type: 'string',
      value: 'path',
      description: 'Write to this settings file instead of your user settings',
    },
  },
  async run(ctx, args) {
    const { hub, token: managementToken } = await ctx.login()
    const { source, created, settings, changed } = await connectClaudeCode({
      hub,
      managementToken,
      client: await ctx.client(),
      name: args.string('source') ?? '',
      path: args.string('settings') ?? userSettingsPath(ctx.io),
    })

    ctx.print(
      { source, settings, changed },
      [
        `${created ? 'Created' : 'Reusing'} Source "${printable(source.name)}" (${source.id}).`,
        `${changed ? 'Wrote' : 'Kept'} the telemetry settings in ${settings}.`,
        'Restart Claude Code to start sending. The ingest Token is in that file; keep it private.',
      ].join('\n'),
    )
  },
}
