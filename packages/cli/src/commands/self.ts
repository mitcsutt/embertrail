import { createWriteStream } from 'node:fs'
import { Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import { ProblemError } from '@mitcsutt/embertrail-client'
import type { Problem } from '@mitcsutt/embertrail-client'

import type { Command } from '../command.ts'
import { unreachable } from '../command.ts'
import { CliError, UsageError } from '../errors.ts'
import { dash, listing } from '../output.ts'

const kinds = ['ingest', 'read', 'management'] as const

export const selfCommands: Command[] = [
  {
    path: ['sources', 'list'],
    summary: 'List your Sources',
    async run(ctx) {
      const { items } = await (await ctx.client()).listSources()
      ctx.print(
        items,
        listing(
          'Sources',
          ['ID', 'NAME'],
          items.map((s) => [s.id, s.name]),
        ),
      )
    },
  },
  {
    path: ['sources', 'create'],
    summary: 'Create a Source and its ingest Token',
    description:
      'The Token is bound to the Source, holds every Module :write Scope you hold, and is shown once. ' +
      'For Claude Code, embertrail setup claude-code does this and configures the machine.',
    positionals: [{ name: 'name', description: "The Source's name" }],
    options: {
      'expires-at': {
        type: 'string',
        value: 'time',
        description: 'Expire the Token then (ISO 8601)',
      },
    },
    async run(ctx, args) {
      const expires = args.string('expires-at')
      const { source, token } = await (
        await ctx.client()
      ).createSource({
        body: {
          name: args.positional(0),
          ...(expires === undefined ? {} : { expires_at: expires }),
        },
      })
      ctx.print(
        { source, token },
        `Created Source "${source.name}" (${source.id}).\nIngest Token (shown once): ${token.token}`,
      )
    },
  },
  {
    path: ['sources', 'rename'],
    summary: 'Rename a Source',
    positionals: [
      { name: 'source-id', description: 'The Source' },
      { name: 'name', description: 'Its new name' },
    ],
    async run(ctx, args) {
      const source = await (
        await ctx.client()
      ).renameSource({
        path: { source_id: args.positional(0) },
        body: { name: args.positional(1) },
      })
      ctx.print(source, `Renamed Source ${source.id} to "${source.name}".`)
    },
  },
  {
    path: ['sources', 'delete'],
    summary: 'Delete a Source and every Signal it sent',
    description: 'Hard delete: the Source, its ingest Tokens, and its Signals in every Module.',
    positionals: [{ name: 'source-id', description: 'The Source to delete' }],
    async run(ctx, args) {
      const id = args.positional(0)
      await (await ctx.client()).deleteSource({ path: { source_id: id } })
      ctx.print({ deleted: id }, `Deleted Source ${id}.`)
    },
  },
  {
    path: ['tokens', 'list'],
    summary: 'List your Tokens',
    description: 'Revoked and expired Tokens included. Secrets are never shown again.',
    async run(ctx) {
      const { items } = await (await ctx.client()).listTokens()
      ctx.print(
        items,
        listing(
          'Tokens',
          ['ID', 'KIND', 'NAME', 'SOURCE', 'SCOPES', 'EXPIRES', 'REVOKED'],
          items.map((t) => [
            t.id,
            t.kind,
            dash(t.name),
            dash(t.source_id),
            t.scopes.join(','),
            dash(t.expires_at),
            dash(t.revoked_at),
          ]),
        ),
      )
    },
  },
  {
    path: ['tokens', 'issue'],
    summary: 'Issue yourself a Token',
    description:
      'An ingest Token needs --source and holds only Module :write Scopes. Each Scope must be one you hold, ' +
      'and the Token never outlives the Token you are logged in with. The secret is shown once.',
    options: {
      kind: {
        type: 'string',
        value: kinds.join('|'),
        required: true,
        description: 'What the Token is for',
      },
      scope: {
        type: 'string',
        value: 'scope',
        multiple: true,
        description: 'A Scope, such as otel:read (repeat for several)',
      },
      name: { type: 'string', value: 'name', description: 'A label for the Token' },
      source: {
        type: 'string',
        value: 'source-id',
        description: 'The Source an ingest Token is bound to',
      },
      'expires-at': { type: 'string', value: 'time', description: 'Expire it then (ISO 8601)' },
    },
    async run(ctx, args) {
      const chosen = args.string('kind')
      const kind = kinds.find((k) => k === chosen)
      if (kind === undefined) throw new UsageError('--kind is ingest, read or management')
      const scopes = args.list('scope')
      if (scopes.length === 0) throw new UsageError('Give at least one --scope')
      const name = args.string('name')
      const source = args.string('source')
      const expires = args.string('expires-at')
      const issued = await (
        await ctx.client()
      ).issueToken({
        body: {
          kind,
          scopes,
          ...(name === undefined ? {} : { name }),
          ...(source === undefined ? {} : { source_id: source }),
          ...(expires === undefined ? {} : { expires_at: expires }),
        },
      })
      ctx.print(
        issued,
        `Issued ${issued.record.kind} Token ${issued.record.id}.\nToken (shown once): ${issued.token}`,
      )
    },
  },
  {
    path: ['tokens', 'revoke'],
    summary: 'Revoke a Token for good',
    positionals: [{ name: 'token-id', description: 'The Token to revoke (see tokens list)' }],
    async run(ctx, args) {
      const id = args.positional(0)
      await (await ctx.client()).revokeToken({ path: { token_id: id } })
      ctx.print({ revoked: id }, `Revoked Token ${id}.`)
    },
  },
  {
    path: ['accounts', 'list'],
    summary: 'List the Accounts your Sources have sent as',
    async run(ctx) {
      const { items } = await (await ctx.client()).listAccounts()
      ctx.print(
        items,
        listing(
          'Accounts',
          ['ID', 'LABEL', 'EMAIL', 'ORGANIZATION'],
          items.map((a) => [a.id, a.label, dash(a.email), dash(a.organization_id)]),
        ),
      )
    },
  },
  {
    path: ['accounts', 'label'],
    summary: "Set or clear an Account's label",
    positionals: [
      { name: 'account-id', description: 'The Account' },
      { name: 'label', description: 'The label; omit with --clear', optional: true },
    ],
    options: { clear: { type: 'boolean', description: 'Remove your label' } },
    async run(ctx, args) {
      const label = args.positionals[1]
      if (args.flag('clear') === (label !== undefined)) {
        throw new UsageError('Give a <label>, or --clear and no label')
      }
      const account = await (
        await ctx.client()
      ).setAccountLabel({
        path: { account_id: args.positional(0) },
        body: { label: label ?? null },
      })
      ctx.print(account, `Account ${account.id} is now "${account.label}".`)
    },
  },
  {
    path: ['grants', 'list'],
    summary: 'List the Grants you have made',
    async run(ctx) {
      const { items } = await (await ctx.client()).listGrants()
      ctx.print(
        items,
        listing(
          'Grants',
          ['ID', 'MODULE', 'ACCOUNT', 'USER', 'TEAM'],
          items.map((g) => [g.id, g.module, g.account_id, dash(g.user_id), dash(g.team_id)]),
        ),
      )
    },
  },
  {
    path: ['grants', 'create'],
    summary: 'Let a User or Team read one Account in one Module',
    description:
      "Read access to that Account's rows in that Module and nothing else. Give --user or --team.",
    options: {
      module: {
        type: 'string',
        value: 'module',
        required: true,
        description: 'The Module, such as otel',
      },
      account: { type: 'string', value: 'account-id', required: true, description: 'The Account' },
      user: { type: 'string', value: 'user-id', description: 'The User to grant' },
      team: { type: 'string', value: 'team-id', description: 'The Team to grant' },
    },
    async run(ctx, args) {
      const user = args.string('user')
      const team = args.string('team')
      if ((user === undefined) === (team === undefined)) {
        throw new UsageError('Give --user or --team, not both')
      }
      const grant = await (
        await ctx.client()
      ).createGrant({
        body: {
          module: args.string('module') ?? '',
          account_id: args.string('account') ?? '',
          ...(user === undefined ? {} : { user_id: user }),
          ...(team === undefined ? {} : { team_id: team }),
        },
      })
      ctx.print(grant, `Created Grant ${grant.id}.`)
    },
  },
  {
    path: ['grants', 'revoke'],
    summary: 'Revoke a Grant',
    positionals: [{ name: 'grant-id', description: 'The Grant (see grants list)' }],
    async run(ctx, args) {
      const id = args.positional(0)
      await (await ctx.client()).revokeGrant({ path: { grant_id: id } })
      ctx.print({ revoked: id }, `Revoked Grant ${id}.`)
    },
  },
  {
    path: ['export'],
    summary: 'Export your data in one Module as JSON Lines',
    description:
      'Streams every row you own in the Module to standard output, or to --out (readable only by you). ' +
      'The otel export is OTLP JSON Lines that replay through /v1/logs and /v1/metrics.',
    positionals: [{ name: 'module', description: 'A Module the Hub loads, such as otel' }],
    options: {
      out: {
        type: 'string',
        value: 'file',
        description: 'Write to this file, not standard output',
      },
    },
    async run(ctx, args) {
      const { hub, token } = await ctx.login()
      const url = `${hub}/api/v1/self/export/${encodeURIComponent(args.positional(0))}`
      let response: Response
      try {
        response = await ctx.io.fetch(url, { headers: { authorization: `Bearer ${token}` } })
      } catch (error) {
        throw unreachable(hub, error)
      }
      if (!response.ok) throw await failure(response)
      if (response.body === null) return
      const out = args.string('out')
      const sink =
        out === undefined
          ? new Writable({
              write(chunk: Uint8Array, _encoding, done) {
                ctx.io.stdout(chunk)
                done()
              },
            })
          : createWriteStream(out, { mode: 0o600 })
      await pipeline(response.body, sink)
      if (out !== undefined) ctx.io.stderr(`Wrote ${out}\n`)
    },
  },
]

/** The error for a failed response the client did not make: the export is plain `fetch`. */
async function failure(response: Response): Promise<Error> {
  const text = await response.text()
  try {
    const body = JSON.parse(text) as Partial<Problem>
    if (typeof body.type === 'string' && typeof body.title === 'string') {
      return new ProblemError(body as Problem)
    }
  } catch {
    // Not JSON: fall through to the status.
  }
  return new CliError(`The Hub answered ${String(response.status)}: ${text.slice(0, 200)}`)
}
