import { z } from 'zod'

import type { Account, Grant, Source, TokenRecord, User } from '../identity/directory'
import { coreScopes, reply } from '../module/define'
import type { Scope } from '../module/define'
import { HubError } from '../module/errors'
import { coreOp } from './core-op'
import type { CoreCtx, CoreOp } from './core-op'

// The Admin and self-management API (#30). `admin` ops manage the instance's Users, Teams and
// Sources; `self:manage` ops manage the caller's own Sources, Tokens, Accounts and Grants, and
// export their data. Every self op reads the caller's records first and answers 404 for
// anyone else's, so another User's ids look exactly like ids that don't exist.

const id = z.string().min(1).max(64)
const name = z.string().trim().min(1).max(200)
const timestamp = z.iso.datetime({ offset: true })
const scope = z
  .string()
  .regex(/^([a-z][a-z0-9_]*:[a-z][a-z0-9_]*|admin)$/, 'a Scope such as otel:read')
const role = z.enum(['member', 'editor'])

const userOut = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().nullable(),
  admin: z.boolean(),
})
const teamOut = z.object({ id: z.string(), name: z.string() })
const memberOut = z.object({ team_id: z.string(), user_id: z.string(), role })
const sourceOut = z.object({ id: z.string(), owner_id: z.string(), name: z.string() })
const tokenOut = z.object({
  id: z.string(),
  kind: z.enum(['ingest', 'read', 'management']),
  source_id: z.string().nullable(),
  scopes: z.array(z.string()),
  name: z.string(),
  created_at: z.string(),
  expires_at: z.string().nullable(),
  revoked_at: z.string().nullable(),
})
const issuedOut = z.object({
  token: z.string().describe('`et_<id>_<secret>`, shown once: the Hub keeps only its hash.'),
  record: tokenOut,
})
const accountOut = z.object({
  id: z.string(),
  label: z.string(),
  labelled: z.boolean(),
  organization_id: z.string().nullable(),
  account_uuid: z.string().nullable(),
  email: z.string().nullable(),
  source_id: z.string().nullable(),
})
const grantOut = z.object({
  id: z.string(),
  module: z.string(),
  account_id: z.string(),
  user_id: z.string().nullable(),
  team_id: z.string().nullable(),
})
const list = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item) })
const none = z.object({})
const empty = z.null()

const toUser = (u: User) => ({ id: u.id, name: u.name, email: u.email, admin: u.admin })
const toSource = (s: Source) => ({ id: s.id, owner_id: s.ownerId, name: s.name })
const toToken = (t: TokenRecord) => ({
  id: t.id,
  kind: t.kind,
  source_id: t.sourceId,
  scopes: t.scopes,
  name: t.name,
  created_at: t.createdAt.toISOString(),
  expires_at: t.expiresAt?.toISOString() ?? null,
  revoked_at: t.revokedAt?.toISOString() ?? null,
})
const toAccount = (a: Account) => ({
  id: a.id,
  label: a.label,
  labelled: a.labelled,
  organization_id: a.organizationId,
  account_uuid: a.accountUuid,
  email: a.email,
  source_id: a.sourceId,
})
const toGrant = (g: Grant) => ({
  id: g.id,
  module: g.module,
  account_id: g.accountId,
  user_id: g.userId,
  team_id: g.teamId,
})

/** A Token never carries a Scope its issuer lacks, so self-management can't escalate. */
function checkScopes(ctx: CoreCtx, scopes: readonly string[]): Scope[] {
  const unknown = scopes.find((s) => !ctx.scopes.includes(s as Scope))
  if (unknown !== undefined) throw HubError.invalid(`Unknown Scope ${unknown}`)
  const lacking = scopes.find((s) => !ctx.caller.scopes.includes(s as Scope))
  if (lacking !== undefined) {
    throw HubError.forbidden(`Can't issue a Token with Scope ${lacking}, which the caller lacks`)
  }
  return scopes as Scope[]
}

function expiry(ctx: CoreCtx, value: string | undefined) {
  if (value === undefined) return undefined
  const at = new Date(value)
  if (at.getTime() <= ctx.now().getTime())
    throw HubError.invalid('expires_at must be in the future')
  return at
}

async function ownSource(ctx: CoreCtx, sourceId: string) {
  const found = (await ctx.directory.sources(ctx.caller.userId)).find((s) => s.id === sourceId)
  if (found === undefined) throw HubError.notFound(`No Source ${sourceId}`)
  return found
}

async function ownAccount(ctx: CoreCtx, accountId: string) {
  const found = (await ctx.directory.accounts(ctx.caller.userId)).find((a) => a.id === accountId)
  if (found === undefined) throw HubError.notFound(`No Account ${accountId}`)
  return found
}

const admin = { tag: 'admin', scope: 'admin' } as const
const self = { tag: 'self', scope: 'self:manage' } as const

const adminOps = [
  coreOp({
    ...admin,
    key: 'listUsers',
    method: 'GET',
    path: '/api/v1/admin/users',
    summary: 'List every User',
    input: none,
    output: list(userOut),
    async run(_, ctx) {
      return { items: (await ctx.directory.users()).map(toUser) }
    },
  }),
  coreOp({
    ...admin,
    key: 'createUser',
    method: 'POST',
    path: '/api/v1/admin/users',
    summary: 'Create a User',
    description:
      'With `token` (the default), also issues the User a management Token holding every Scope (`admin` only for an admin), shown once. A User with an `email` can sign in through Edge Identity instead.',
    input: z.strictObject({
      name,
      email: z.email().optional(),
      admin: z.boolean().default(false),
      token: z.boolean().default(true),
    }),
    output: z.object({ user: userOut, token: z.string().nullable() }),
    statuses: [201],
    async run(input, ctx) {
      const user = await ctx.directory.createUser({
        name: input.name,
        email: input.email,
        admin: input.admin,
      })
      const issued = input.token
        ? await ctx.directory.issueToken(user.id, {
            kind: 'management',
            scopes: ctx.scopes.filter((s) => user.admin || s !== 'admin'),
            name: 'created by an admin',
          })
        : undefined
      return reply({ user: toUser(user), token: issued?.token ?? null }, { status: 201 })
    },
  }),
  coreOp({
    ...admin,
    key: 'deleteUser',
    method: 'DELETE',
    path: '/api/v1/admin/users/{user_id}',
    summary: 'Delete a User and everything they own',
    description:
      'Hard delete: the User, their Sources, Tokens, Accounts and Grants, and every row they own in every Module. Team-owned rows stay with the Team. An admin cannot delete their own User.',
    input: z.object({ user_id: id }),
    output: empty,
    statuses: [204],
    async run({ user_id: userId }, ctx) {
      if (userId === ctx.caller.userId) {
        throw HubError.invalid('An admin cannot delete their own User; ask another admin')
      }
      if (!(await ctx.remove.user(userId))) throw HubError.notFound(`No User ${userId}`)
      return reply.noContent()
    },
  }),
  coreOp({
    ...admin,
    key: 'listTeams',
    method: 'GET',
    path: '/api/v1/admin/teams',
    summary: 'List every Team with its members',
    input: none,
    output: list(teamOut.extend({ members: z.array(z.object({ user_id: z.string(), role })) })),
    async run(_, ctx) {
      const teams = await ctx.directory.teams()
      return {
        items: teams.map((t) => ({
          id: t.id,
          name: t.name,
          members: t.members.map((m) => ({ user_id: m.userId, role: m.role })),
        })),
      }
    },
  }),
  coreOp({
    ...admin,
    key: 'createTeam',
    method: 'POST',
    path: '/api/v1/admin/teams',
    summary: 'Create a Team',
    description:
      'The id is 1 to 64 letters, digits, `_` or `-` (callers name it in `Embertrail-Owner: team:<id>`), and never a User’s id. Omitted, it is generated.',
    input: z.strictObject({
      id: z
        .string()
        .regex(/^[A-Za-z0-9_-]{1,64}$/, '1 to 64 letters, digits, _ or -')
        .optional(),
      name,
    }),
    output: teamOut,
    statuses: [201],
    async run(input, ctx) {
      const team = await ctx.directory.createTeam(input)
      return reply({ id: team.id, name: team.name }, { status: 201 })
    },
  }),
  coreOp({
    ...admin,
    key: 'deleteTeam',
    method: 'DELETE',
    path: '/api/v1/admin/teams/{team_id}',
    summary: 'Delete a Team and everything it owns',
    description: 'Hard delete: the Team, its memberships and Grants, and every row it owns.',
    input: z.object({ team_id: id }),
    output: empty,
    statuses: [204],
    async run({ team_id: teamId }, ctx) {
      if (!(await ctx.remove.team(teamId))) throw HubError.notFound(`No Team ${teamId}`)
      return reply.noContent()
    },
  }),
  coreOp({
    ...admin,
    key: 'setTeamMember',
    method: 'PUT',
    path: '/api/v1/admin/teams/{team_id}/members/{user_id}',
    summary: 'Add a User to a Team, or change their role',
    description: 'Members read the Team’s data; editors also act for the Team.',
    input: z.strictObject({ team_id: id, user_id: id, role }),
    output: memberOut,
    async run({ team_id: teamId, user_id: userId, role: given }, ctx) {
      await ctx.directory.setTeamMember(teamId, userId, given)
      return { team_id: teamId, user_id: userId, role: given }
    },
  }),
  coreOp({
    ...admin,
    key: 'removeTeamMember',
    method: 'DELETE',
    path: '/api/v1/admin/teams/{team_id}/members/{user_id}',
    summary: 'Remove a User from a Team',
    input: z.object({ team_id: id, user_id: id }),
    output: empty,
    statuses: [204],
    async run({ team_id: teamId, user_id: userId }, ctx) {
      const team = (await ctx.directory.teams()).find((t) => t.id === teamId)
      if (team?.members.some((m) => m.userId === userId) !== true) {
        throw HubError.notFound(`User ${userId} is not a member of Team ${teamId}`)
      }
      await ctx.directory.removeTeamMember(teamId, userId)
      return reply.noContent()
    },
  }),
  coreOp({
    ...admin,
    key: 'listAllSources',
    method: 'GET',
    path: '/api/v1/admin/sources',
    summary: 'List every User’s Sources',
    input: none,
    output: list(sourceOut),
    async run(_, ctx) {
      return { items: (await ctx.directory.sources()).map(toSource) }
    },
  }),
  coreOp({
    ...admin,
    key: 'deleteAnySource',
    method: 'DELETE',
    path: '/api/v1/admin/sources/{source_id}',
    summary: 'Delete any Source and every Signal it sent',
    description: 'Hard delete: the Source, its ingest Tokens, and its Signals in every Module.',
    input: z.object({ source_id: id }),
    output: empty,
    statuses: [204],
    async run({ source_id: sourceId }, ctx) {
      if (!(await ctx.remove.source(sourceId))) throw HubError.notFound(`No Source ${sourceId}`)
      return reply.noContent()
    },
  }),
]

const selfOps = [
  coreOp({
    ...self,
    key: 'listSources',
    method: 'GET',
    path: '/api/v1/self/sources',
    summary: 'List your Sources',
    input: none,
    output: list(sourceOut),
    async run(_, ctx) {
      return { items: (await ctx.directory.sources(ctx.caller.userId)).map(toSource) }
    },
  }),
  coreOp({
    ...self,
    key: 'createSource',
    method: 'POST',
    path: '/api/v1/self/sources',
    summary: 'Create a Source and its ingest Token',
    description:
      'The Token is bound to the new Source and shown once. `scopes` defaults to every Module `:write` Scope the caller holds, which is what ingest needs.',
    input: z.strictObject({
      name,
      scopes: z.array(scope).min(1).optional(),
      expires_at: timestamp.optional(),
    }),
    output: z.object({ source: sourceOut, token: issuedOut }),
    statuses: [201],
    async run(input, ctx) {
      const scopes = checkScopes(
        ctx,
        input.scopes ??
          ctx.caller.scopes.filter((s) => s.endsWith(':write') && !coreScopes.includes(s)),
      )
      if (scopes.length === 0) {
        throw HubError.invalid('The caller holds no Module write Scope to give an ingest Token')
      }
      const expiresAt = expiry(ctx, input.expires_at)
      const source = await ctx.directory.createSource(ctx.caller.userId, { name: input.name })
      try {
        const issued = await ctx.directory.issueToken(ctx.caller.userId, {
          kind: 'ingest',
          scopes,
          sourceId: source.id,
          name: input.name,
          expiresAt,
        })
        return reply(
          {
            source: toSource(source),
            token: { token: issued.token, record: toToken(issued.record) },
          },
          { status: 201 },
        )
      } catch (error) {
        await ctx.remove.source(source.id)
        throw error
      }
    },
  }),
  coreOp({
    ...self,
    key: 'renameSource',
    method: 'PUT',
    path: '/api/v1/self/sources/{source_id}',
    summary: 'Rename one of your Sources',
    input: z.strictObject({ source_id: id, name }),
    output: sourceOut,
    async run(input, ctx) {
      await ownSource(ctx, input.source_id)
      return toSource(await ctx.directory.renameSource(input.source_id, input.name))
    },
  }),
  coreOp({
    ...self,
    key: 'deleteSource',
    method: 'DELETE',
    path: '/api/v1/self/sources/{source_id}',
    summary: 'Delete one of your Sources and every Signal it sent',
    description: 'Hard delete: the Source, its ingest Tokens, and its Signals in every Module.',
    input: z.object({ source_id: id }),
    output: empty,
    statuses: [204],
    async run({ source_id: sourceId }, ctx) {
      await ownSource(ctx, sourceId)
      await ctx.remove.source(sourceId)
      return reply.noContent()
    },
  }),
  coreOp({
    ...self,
    key: 'listTokens',
    method: 'GET',
    path: '/api/v1/self/tokens',
    summary: 'List your Tokens',
    description: 'Revoked and expired Tokens included. Secrets are never shown again.',
    input: none,
    output: list(tokenOut),
    async run(_, ctx) {
      return { items: (await ctx.directory.tokens(ctx.caller.userId)).map(toToken) }
    },
  }),
  coreOp({
    ...self,
    key: 'issueToken',
    method: 'POST',
    path: '/api/v1/self/tokens',
    summary: 'Issue yourself a Token',
    description:
      'An `ingest` Token needs `source_id`, one of your Sources; `read` and `management` Tokens take none. Each Scope must be one the caller holds. No expiry unless `expires_at` is set.',
    input: z.strictObject({
      kind: z.enum(['ingest', 'read', 'management']),
      scopes: z.array(scope).min(1),
      name: z.string().trim().max(200).optional(),
      source_id: id.optional(),
      expires_at: timestamp.optional(),
    }),
    output: issuedOut,
    statuses: [201],
    async run(input, ctx) {
      const scopes = checkScopes(ctx, input.scopes)
      const issued = await ctx.directory.issueToken(ctx.caller.userId, {
        kind: input.kind,
        scopes,
        sourceId: input.source_id,
        name: input.name,
        expiresAt: expiry(ctx, input.expires_at),
      })
      return reply({ token: issued.token, record: toToken(issued.record) }, { status: 201 })
    },
  }),
  coreOp({
    ...self,
    key: 'revokeToken',
    method: 'DELETE',
    path: '/api/v1/self/tokens/{token_id}',
    summary: 'Revoke one of your Tokens',
    description: 'Permanent. Revoking a revoked Token changes nothing.',
    input: z.object({ token_id: id }),
    output: empty,
    statuses: [204],
    async run({ token_id: tokenId }, ctx) {
      const tokens = await ctx.directory.tokens(ctx.caller.userId)
      if (!tokens.some((t) => t.id === tokenId)) throw HubError.notFound(`No Token ${tokenId}`)
      await ctx.directory.revokeToken(tokenId)
      return reply.noContent()
    },
  }),
  coreOp({
    ...self,
    key: 'listAccounts',
    method: 'GET',
    path: '/api/v1/self/accounts',
    summary: 'List your Accounts',
    description: 'Recognised from your telemetry; they are never created by hand.',
    input: none,
    output: list(accountOut),
    async run(_, ctx) {
      return { items: (await ctx.directory.accounts(ctx.caller.userId)).map(toAccount) }
    },
  }),
  coreOp({
    ...self,
    key: 'setAccountLabel',
    method: 'PUT',
    path: '/api/v1/self/accounts/{account_id}',
    summary: 'Label one of your Accounts',
    description: '`null` or an empty label goes back to the suggestion from the email domain.',
    input: z.strictObject({ account_id: id, label: z.string().max(200).nullable() }),
    output: accountOut,
    async run({ account_id: accountId, label }, ctx) {
      await ownAccount(ctx, accountId)
      await ctx.directory.setAccountLabel(accountId, label)
      return toAccount(await ownAccount(ctx, accountId))
    },
  }),
  coreOp({
    ...self,
    key: 'listGrants',
    method: 'GET',
    path: '/api/v1/self/grants',
    summary: 'List the Grants on your Accounts',
    input: none,
    output: list(grantOut),
    async run(_, ctx) {
      return { items: (await ctx.directory.grants(ctx.caller.userId)).map(toGrant) }
    },
  }),
  coreOp({
    ...self,
    key: 'createGrant',
    method: 'POST',
    path: '/api/v1/self/grants',
    summary: 'Let a User or a Team read one of your Accounts in one Module',
    description: 'Read access only, to exactly one User (`user_id`) or one Team (`team_id`).',
    input: z.strictObject({
      module: z.string().min(1).max(63),
      account_id: id,
      user_id: id.optional(),
      team_id: id.optional(),
    }),
    output: grantOut,
    statuses: [201],
    async run(input, ctx) {
      await ownAccount(ctx, input.account_id)
      const grant = await ctx.directory.grant({
        module: input.module,
        accountId: input.account_id,
        userId: input.user_id,
        teamId: input.team_id,
      })
      return reply(toGrant(grant), { status: 201 })
    },
  }),
  coreOp({
    ...self,
    key: 'revokeGrant',
    method: 'DELETE',
    path: '/api/v1/self/grants/{grant_id}',
    summary: 'Revoke a Grant on one of your Accounts',
    description: 'Takes effect on the next request.',
    input: z.object({ grant_id: id }),
    output: empty,
    statuses: [204],
    async run({ grant_id: grantId }, ctx) {
      const grants = await ctx.directory.grants(ctx.caller.userId)
      if (!grants.some((g) => g.id === grantId)) throw HubError.notFound(`No Grant ${grantId}`)
      await ctx.directory.revokeGrant(grantId)
      return reply.noContent()
    },
  }),
  coreOp({
    ...self,
    key: 'exportModule',
    method: 'GET',
    path: '/api/v1/self/export/{module}',
    summary: 'Export your data in one Module, as JSON Lines',
    description:
      'Every row you own in the Module, in its native format: `otel` answers OTLP JSON Lines that replay through `/v1/logs` and `/v1/metrics`; other Modules answer one `{"table", "row"}` object per line.',
    input: z.object({ module: z.string().min(1).max(63) }),
    output: z.string(),
    responses: {
      '200': {
        description: 'JSON Lines, one entry per line.',
        content: { 'application/jsonl': { schema: { type: 'string' } } },
      },
    },
    async run({ module }, ctx) {
      if (!ctx.modules.includes(module)) throw HubError.notFound(`No Module "${module}"`)
      const body = await ctx.exportOwner(module, ctx.caller.userId)
      return new Response(body, {
        headers: {
          'content-type': 'application/jsonl; charset=utf-8',
          'content-disposition': `attachment; filename="${module}.jsonl"`,
        },
      })
    },
  }),
]

/** Every op the core serves for #30, in the order the OpenAPI document lists them. */
export const coreOps: readonly CoreOp[] = [...adminOps, ...selfOps]
