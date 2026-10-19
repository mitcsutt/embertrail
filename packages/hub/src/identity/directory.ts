import { and, asc, eq, sql } from 'drizzle-orm'

import { rows } from '../db/port'
import type { DbPort, ScopedDb } from '../db/port'
import type { Scope } from '../module/define'
import { HubError } from '../module/errors'
import { accountLabel } from './accounts'
import { accounts, bootstrap, grants, sources, teamMembers, teams, tokens, users } from './tables'
import { generateToken, hashSecret, sameHash } from './tokens'
import type { ParsedToken } from './tokens'

export type TeamRole = 'member' | 'editor'

/** `ingest` Tokens are bound to exactly one Source; `read` and `management` Tokens never are. */
export type TokenKind = 'ingest' | 'read' | 'management'

export interface User {
  id: string
  name: string
  /** Lowercased. What an Edge Identity is matched on; null for a Token-only User. */
  email: string | null
  /** Instance admin: may hold the `admin` Scope. */
  admin: boolean
}

export interface Team {
  id: string
  name: string
}

export interface Source {
  id: string
  /** The User who owns the Source and every Signal it sends. */
  ownerId: string
  name: string
}

/** A Token as stored: everything but the secret, which only `issueToken` ever returns. */
export interface TokenRecord {
  id: string
  userId: string
  kind: TokenKind
  sourceId: string | null
  scopes: Scope[]
  name: string
  createdAt: Date
  expiresAt: Date | null
  revokedAt: Date | null
}

export interface IssuedToken {
  /** `et_<id>_<secret>`. Shown once: the Hub keeps only the secret's hash. */
  token: string
  record: TokenRecord
}

export interface Account {
  id: string
  /** The User the Account belongs to. */
  ownerId: string
  /** The User's label, else a suggestion from the email domain, else `Unknown`. */
  label: string
  /** True once the User has set a label. */
  labelled: boolean
  organizationId: string | null
  accountUuid: string | null
  email: string | null
  /** Set only on a Source's Unknown Account. */
  sourceId: string | null
}

/** Read access to one Account's rows in one Module, for a User or a Team. */
export interface Grant {
  id: string
  module: string
  accountId: string
  userId: string | null
  teamId: string | null
}

export interface IssueTokenInput {
  kind: TokenKind
  scopes: readonly Scope[]
  /** Required for an `ingest` Token, refused for any other kind. */
  sourceId?: string | undefined
  name?: string | undefined
  /** No expiry by default. */
  expiresAt?: Date | undefined
}

/**
 * The core's identity records (#29). Every call is privileged: it checks the records'
 * own rules (an ingest Token needs a Source, `admin` needs an admin User) but not who is
 * asking. The Admin and self-management API (#30) decides that.
 */
export interface Directory {
  createUser(input: {
    name: string
    email?: string | undefined
    admin?: boolean | undefined
    id?: string | undefined
  }): Promise<User>
  createTeam(input: { name: string; id?: string | undefined }): Promise<Team>
  /** Adds the User to the Team, or changes their role. */
  setTeamMember(teamId: string, userId: string, role: TeamRole): Promise<void>
  removeTeamMember(teamId: string, userId: string): Promise<void>
  createSource(userId: string, input: { name: string; id?: string | undefined }): Promise<Source>
  issueToken(userId: string, input: IssueTokenInput): Promise<IssuedToken>
  /** Revoking is permanent; rotate by issuing a new Token and revoking the old one. */
  revokeToken(tokenId: string): Promise<void>
  /** A User's Accounts, as recognised from their telemetry. */
  accounts(userId: string): Promise<Account[]>
  /** Sets the Account's label; null goes back to the suggestion. */
  setAccountLabel(accountId: string, label: string | null): Promise<void>
  grant(input: {
    module: string
    accountId: string
    userId?: string | undefined
    teamId?: string | undefined
  }): Promise<Grant>
  revokeGrant(grantId: string): Promise<void>
  /**
   * Creates the first User, an instance admin, with a management Token holding every Scope.
   * Null once any admin User exists or a first User was ever created: `BOOTSTRAP_TOKEN` and
   * the Docker zero-config start both go through here, and each works once. A non-admin User
   * who already has `email` (signed up by Edge Identity) is promoted instead of duplicated.
   */
  createFirstUser(input?: {
    name?: string | undefined
    email?: string | undefined
  }): Promise<{ user: User; token: string } | null>
}

/** A User as caller resolution sees them. */
export interface Principal {
  userId: string
  scopes: readonly Scope[]
  /** Set for a Source-bound (ingest) Token. */
  sourceId?: string | undefined
}

/** What caller resolution looks up. */
export interface Resolver {
  /** The Token's User, or null when it is unknown, revoked, expired or its secret is wrong. */
  token(token: ParsedToken): Promise<Principal | null>
  /**
   * The User an Edge Identity email names. With `provision`, creates one when the email is
   * allowlisted. Null when there is no such User (or it may not be created).
   */
  edgeUser(email: string, options: { provision: boolean }): Promise<Principal | null>
  teamRole(teamId: string, userId: string): Promise<TeamRole | null>
  /** Whether an Owner id is a Team's (it names a row in `core.teams`) or a User's. */
  ownerKind(ownerId: string): Promise<'user' | 'team'>
}

export interface DirectoryOptions {
  db: DbPort
  /** Every Scope a Token may hold: the Modules' and the core's. */
  scopes: readonly Scope[]
  /** Module names a Grant may name. */
  modules: readonly string[]
  allowedEmails: readonly string[]
  allowedDomains: readonly string[]
  clock: () => Date
}

/**
 * Whether an Owner id is a Team's (it names a row in `core.teams`) or a User's. Runs on the
 * given transaction (`core.owner_kind`), so an op can ask without a second connection.
 */
export async function ownerKind(db: ScopedDb, ownerId: string): Promise<'user' | 'team'> {
  const [found] = await rows<{ kind: 'user' | 'team' }>(
    db,
    sql`select core.owner_kind(${ownerId}) as kind`,
  )
  return found?.kind ?? 'user'
}

/** A Postgres error code anywhere in the cause chain (drivers and Drizzle wrap them). */
function pgCode(error: unknown): string | undefined {
  for (let e = error; typeof e === 'object' && e !== null; e = (e as { cause?: unknown }).cause) {
    const code = (e as { code?: unknown }).code
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code
  }
  return undefined
}

const uniqueViolation = '23505'
const foreignKeyViolation = '23503'

/** Runs a write, mapping the constraint errors a caller can cause to problems. */
async function guarded<T>(
  work: Promise<T>,
  messages: { conflict?: string; missing?: string },
): Promise<T> {
  try {
    return await work
  } catch (error) {
    const code = pgCode(error)
    if (code === uniqueViolation && messages.conflict !== undefined) {
      throw HubError.conflict(messages.conflict)
    }
    if (code === foreignKeyViolation && messages.missing !== undefined) {
      throw HubError.notFound(messages.missing)
    }
    throw error
  }
}

const normaliseEmail = (email: string) => email.trim().toLowerCase()

function toUser(row: typeof users.$inferSelect): User {
  return { id: row.id, name: row.name, email: row.email, admin: row.admin }
}

function toToken(row: typeof tokens.$inferSelect): TokenRecord {
  return {
    id: row.id,
    userId: row.userId,
    kind: row.kind,
    sourceId: row.sourceId,
    scopes: row.scopes as Scope[],
    name: row.name,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
  }
}

function toGrant(row: typeof grants.$inferSelect): Grant {
  return {
    id: row.id,
    module: row.module,
    accountId: row.accountId,
    userId: row.userId,
    teamId: row.teamId,
  }
}

/** The core Directory over the `core` tables, and the Resolver caller resolution uses. */
export function coreDirectory(options: DirectoryOptions): Directory & Resolver {
  const { db, clock } = options
  const known = new Set(options.scopes)
  const allowedEmails = new Set(options.allowedEmails.map(normaliseEmail))
  const allowedDomains = new Set(options.allowedDomains.map((d) => d.trim().toLowerCase()))

  /** An Edge-identified User acts as themselves: every Scope, `admin` only for an admin. */
  const userScopes = (admin: boolean) => options.scopes.filter((s) => admin || s !== 'admin')

  const allowlisted = (email: string) =>
    allowedEmails.has(email) || allowedDomains.has(email.split('@').at(-1) ?? '')

  async function issue(tx: ScopedDb, userId: string, input: IssueTokenInput) {
    const scopes = [...new Set(input.scopes)]
    if (scopes.length === 0) throw HubError.invalid('A Token needs at least one Scope')
    const unknown = scopes.find((s) => !known.has(s))
    if (unknown !== undefined) throw HubError.invalid(`Unknown Scope ${unknown}`)
    if (input.kind === 'ingest' && input.sourceId === undefined) {
      throw HubError.invalid('An ingest Token must be bound to a Source')
    }
    if (input.kind !== 'ingest' && input.sourceId !== undefined) {
      throw HubError.invalid(`A ${input.kind} Token cannot be bound to a Source`)
    }
    const [user] = await tx.select().from(users).where(eq(users.id, userId))
    if (user === undefined) throw HubError.notFound(`No User ${userId}`)
    if (scopes.includes('admin') && !user.admin) {
      throw HubError.invalid('Only an admin User may hold the admin Scope')
    }
    const generated = generateToken()
    const [row] = await guarded(
      tx
        .insert(tokens)
        .values({
          id: generated.id,
          userId,
          kind: input.kind,
          sourceId: input.sourceId ?? null,
          scopes,
          name: input.name ?? '',
          secretHash: await hashSecret(generated.secret),
          expiresAt: input.expiresAt ?? null,
        })
        .returning(),
      { missing: `No Source ${String(input.sourceId)} owned by User ${userId}` },
    )
    if (row === undefined) throw new Error('insert into core.tokens returned no row')
    return { token: generated.token, record: toToken(row) }
  }

  return {
    async createUser(input) {
      const [row] = await db.privileged((tx) =>
        guarded(
          tx
            .insert(users)
            .values({
              id: input.id ?? crypto.randomUUID(),
              name: input.name,
              email: input.email === undefined ? null : normaliseEmail(input.email),
              admin: input.admin ?? false,
            })
            .returning(),
          { conflict: 'A User with that id or email already exists' },
        ),
      )
      if (row === undefined) throw new Error('insert into core.users returned no row')
      return toUser(row)
    },

    async createTeam(input) {
      const id = input.id ?? crypto.randomUUID()
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
        throw HubError.invalid('A Team id is 1 to 64 letters, digits, _ or -')
      }
      const [row] = await db.privileged((tx) =>
        guarded(tx.insert(teams).values({ id, name: input.name }).returning(), {
          conflict: 'A Team with that id or name already exists',
        }),
      )
      if (row === undefined) throw new Error('insert into core.teams returned no row')
      return { id: row.id, name: row.name }
    },

    async setTeamMember(teamId, userId, role) {
      await db.privileged((tx) =>
        guarded(
          tx
            .insert(teamMembers)
            .values({ teamId, userId, role })
            .onConflictDoUpdate({
              target: [teamMembers.teamId, teamMembers.userId],
              set: { role },
            }),
          { missing: `No Team ${teamId} or no User ${userId}` },
        ),
      )
    },

    async removeTeamMember(teamId, userId) {
      await db.privileged((tx) =>
        tx
          .delete(teamMembers)
          .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId))),
      )
    },

    async createSource(userId, input) {
      const [row] = await db.privileged((tx) =>
        guarded(
          tx
            .insert(sources)
            .values({ id: input.id ?? crypto.randomUUID(), ownerId: userId, name: input.name })
            .returning(),
          {
            conflict: `A Source with that id, or named "${input.name}", already exists`,
            missing: `No User ${userId}`,
          },
        ),
      )
      if (row === undefined) throw new Error('insert into core.sources returned no row')
      return { id: row.id, ownerId: row.ownerId, name: row.name }
    },

    issueToken: (userId, input) => db.privileged((tx) => issue(tx, userId, input)),

    async revokeToken(tokenId) {
      await db.privileged((tx) =>
        tx
          .update(tokens)
          .set({ revokedAt: clock() })
          .where(and(eq(tokens.id, tokenId), sql`${tokens.revokedAt} is null`)),
      )
    },

    async accounts(userId) {
      const found = await db.privileged((tx) =>
        tx
          .select()
          .from(accounts)
          .where(eq(accounts.ownerId, userId))
          .orderBy(asc(accounts.createdAt), asc(accounts.id)),
      )
      return found.map((row) => ({
        id: row.id,
        ownerId: row.ownerId,
        label: accountLabel(row),
        labelled: row.label !== null,
        organizationId: row.organizationId,
        accountUuid: row.accountUuid,
        email: row.email,
        sourceId: row.sourceId,
      }))
    },

    async setAccountLabel(accountId, label) {
      const updated = await db.privileged((tx) =>
        tx
          .update(accounts)
          .set({ label: label === null || label.trim() === '' ? null : label.trim() })
          .where(eq(accounts.id, accountId))
          .returning({ id: accounts.id }),
      )
      if (updated.length === 0) throw HubError.notFound(`No Account ${accountId}`)
    },

    async grant(input) {
      if (!options.modules.includes(input.module)) {
        throw HubError.invalid(`No Module "${input.module}"`)
      }
      if ((input.userId === undefined) === (input.teamId === undefined)) {
        throw HubError.invalid('A Grant is to exactly one User or one Team')
      }
      const [row] = await db.privileged((tx) =>
        guarded(
          tx
            .insert(grants)
            .values({
              id: crypto.randomUUID(),
              module: input.module,
              accountId: input.accountId,
              userId: input.userId ?? null,
              teamId: input.teamId ?? null,
            })
            .returning(),
          {
            conflict: 'That Grant already exists',
            missing: 'No such Account, User or Team',
          },
        ),
      )
      if (row === undefined) throw new Error('insert into core.grants returned no row')
      return toGrant(row)
    },

    async revokeGrant(grantId) {
      await db.privileged((tx) => tx.delete(grants).where(eq(grants.id, grantId)))
    },

    createFirstUser: (input = {}) =>
      db.privileged(async (tx) => {
        // Two first starts at once: the second waits, then sees the first admin.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('embertrail.bootstrap'))`)
        const [used] = await tx.select({ id: bootstrap.id }).from(bootstrap)
        const [admin] = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.admin, true))
          .limit(1)
        if (used !== undefined || admin !== undefined) return null
        const email = input.email === undefined ? null : normaliseEmail(input.email)
        // An Edge Identity may have signed this person up before bootstrap ran.
        const [promoted] =
          email === null
            ? []
            : await tx.update(users).set({ admin: true }).where(eq(users.email, email)).returning()
        const [row] =
          promoted === undefined
            ? await tx
                .insert(users)
                .values({
                  id: crypto.randomUUID(),
                  name: input.name ?? 'admin',
                  email,
                  admin: true,
                })
                .returning()
            : [promoted]
        if (row === undefined) throw new Error('insert into core.users returned no row')
        await tx.insert(bootstrap).values({ id: true, userId: row.id })
        const issued = await issue(tx, row.id, {
          kind: 'management',
          scopes: options.scopes,
          name: 'bootstrap',
        })
        return { user: toUser(row), token: issued.token }
      }),

    async token(parsed) {
      const hash = await hashSecret(parsed.secret)
      const [row] = await db.privileged((tx) =>
        tx
          .select({ token: tokens, admin: users.admin })
          .from(tokens)
          .innerJoin(users, eq(users.id, tokens.userId))
          .where(eq(tokens.id, parsed.id)),
      )
      if (row === undefined || !sameHash(hash, row.token.secretHash)) return null
      const { token } = row
      if (token.revokedAt !== null) return null
      if (token.expiresAt !== null && token.expiresAt.getTime() <= clock().getTime()) return null
      // A User who is no longer an admin loses `admin` from Tokens issued while they were.
      const scopes = (token.scopes as Scope[]).filter((s) => row.admin || s !== 'admin')
      return { userId: token.userId, scopes, sourceId: token.sourceId ?? undefined }
    },

    edgeUser(email, { provision }) {
      const normalised = normaliseEmail(email)
      return db.privileged(async (tx) => {
        const byEmail = () => tx.select().from(users).where(eq(users.email, normalised))
        let [user] = await byEmail()
        if (user === undefined) {
          if (!provision || !allowlisted(normalised)) return null
          await tx
            .insert(users)
            .values({ id: crypto.randomUUID(), name: normalised, email: normalised, admin: false })
            .onConflictDoNothing()
          ;[user] = await byEmail()
        }
        return user === undefined ? null : { userId: user.id, scopes: userScopes(user.admin) }
      })
    },

    async teamRole(teamId, userId) {
      const [row] = await db.privileged((tx) =>
        tx
          .select({ role: teamMembers.role })
          .from(teamMembers)
          .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId))),
      )
      return row?.role ?? null
    },

    ownerKind: (ownerId) => db.privileged((tx) => ownerKind(tx, ownerId)),
  }
}
