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

export const setupClaudeCode: Command = {
  path: ['setup', 'claude-code'],
  summary: "Send this machine's Claude Code telemetry to the Hub",
  description:
    'Creates the Source and its ingest Token, then writes the telemetry env block into your user ' +
    'Claude Code settings (~/.claude/settings.json, or $CLAUDE_CONFIG_DIR/settings.json): ' +
    'Metrics and Events on, over http/json, authenticated by the Token. Your other settings are kept, ' +
    'and traces are never enabled. Running it again for the same Source rotates its Token and revokes the old ones.',
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
    const rotated: string[] = []
    if (existing === undefined) {
      const created = await client.createSource({ body: { name } })
      source = created.source
      ingestToken = created.token.token
    } else {
      source = existing
      // The old ingest Tokens stop working once the new one is in the settings file.
      const tokens = (await client.listTokens()).items
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
      rotated.push(
        ...tokens
          .filter(
            (record) =>
              record.kind === 'ingest' &&
              record.source_id === existing.id &&
              record.revoked_at === null,
          )
          .map((record) => record.id),
      )
    }

    const changed = await writeSettings(
      path,
      applyTelemetry(settings, telemetryEnv(hub, ingestToken)),
    )
    for (const id of rotated) await client.revokeToken({ path: { token_id: id } })

    ctx.print(
      { source, settings: path, changed, revoked_tokens: rotated },
      [
        `${existing === undefined ? 'Created' : 'Reusing'} Source "${source.name}" (${source.id}).`,
        `${changed ? 'Wrote' : 'Kept'} the telemetry settings in ${path}.`,
        ...(rotated.length > 0
          ? [`Revoked ${String(rotated.length)} earlier ingest Token(s) for this Source.`]
          : []),
        'Restart Claude Code to start sending. The ingest Token is in that file; keep it private.',
      ].join('\n'),
    )
  },
}
