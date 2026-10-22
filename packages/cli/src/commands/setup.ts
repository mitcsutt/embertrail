import {
  applyTelemetry,
  readSettings,
  telemetryEnv,
  userSettingsPath,
  writeSettings,
} from '../claude-code.ts'
import type { Command } from '../command.ts'
import { CliError } from '../errors.ts'

/** A Token's id: `et_<id>_<secret>`. */
function tokenId(token: string): string | undefined {
  return /^et_([a-z0-9]{16})_/.exec(token)?.[1]
}

const writeScope = /^[a-z][a-z0-9_]*:write$/

/** The ingest Token the settings already send to `hub`, if they do. */
function configuredToken(settings: Record<string, unknown>, hub: string): string | undefined {
  const env = settings.env
  if (typeof env !== 'object' || env === null) return undefined
  const { OTEL_EXPORTER_OTLP_ENDPOINT: endpoint, OTEL_EXPORTER_OTLP_HEADERS: headers } =
    env as Record<string, unknown>
  if (endpoint !== hub || typeof headers !== 'string') return undefined
  return /^Authorization=Bearer (et_\S+)$/.exec(headers)?.[1]
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
    const name = args.string('source') ?? ''
    const { hub, token: managementToken } = await ctx.login()
    const client = await ctx.client()
    const path = args.string('settings') ?? userSettingsPath(ctx.io)
    // Read before creating anything, so a settings file that cannot be changed costs nothing.
    const settings = await readSettings(path)

    const existing = (await client.listSources()).items.find((source) => source.name === name)
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
        const callerId = tokenId(managementToken)
        const caller = tokens.find((record) => record.id === callerId)
        const scopes = (caller?.scopes ?? []).filter((scope) => writeScope.test(scope))
        if (scopes.length === 0) {
          throw new CliError(
            `Source "${name}" exists, and the logged-in Token holds no Module :write Scope to give its new Token`,
          )
        }
        const issued = await client.issueToken({
          body: { kind: 'ingest', scopes, source_id: existing.id, name: `claude-code on ${name}` },
        })
        ingestToken = issued.token
      }
    }

    const changed = await writeSettings(
      path,
      applyTelemetry(settings, telemetryEnv(hub, ingestToken)),
    )

    ctx.print(
      { source, settings: path, changed },
      [
        `${existing === undefined ? 'Created' : 'Reusing'} Source "${source.name}" (${source.id}).`,
        `${changed ? 'Wrote' : 'Kept'} the telemetry settings in ${path}.`,
        'Restart Claude Code to start sending. The ingest Token is in that file; keep it private.',
      ].join('\n'),
    )
  },
}
