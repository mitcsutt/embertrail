import { boolean, pgSchema, text, timestamp } from 'drizzle-orm/pg-core'

import { dbRoles } from '../db/port'
import type { Migration } from '../module/define'

// Core identity (#29) in schema `core`: Users, Teams, Sources, Tokens, Accounts and Grants.
// Only the core reads these, through `privileged`, and through the security-definer functions
// below that row-level security calls; the app and readonly roles get no table grants.

const core = pgSchema('core')

export const users = core.table('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email'),
  admin: boolean('admin').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const teams = core.table('teams', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const teamMembers = core.table('team_members', {
  teamId: text('team_id').notNull(),
  userId: text('user_id').notNull(),
  role: text('role', { enum: ['member', 'editor'] }).notNull(),
})

export const sources = core.table('sources', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const tokens = core.table('tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  kind: text('kind', { enum: ['ingest', 'read', 'management'] }).notNull(),
  sourceId: text('source_id'),
  scopes: text('scopes').array().notNull(),
  name: text('name').notNull(),
  secretHash: text('secret_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
})

export const accounts = core.table('accounts', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  key: text('key').notNull(),
  organizationId: text('organization_id'),
  accountUuid: text('account_uuid'),
  email: text('email'),
  sourceId: text('source_id'),
  label: text('label'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const grants = core.table('grants', {
  id: text('id').primaryKey(),
  module: text('module').notNull(),
  accountId: text('account_id').notNull(),
  userId: text('user_id'),
  teamId: text('team_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const bootstrap = core.table('bootstrap', {
  id: boolean('id').primaryKey(),
  userId: text('user_id').notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }).notNull().defaultNow(),
})

const callerUser = `nullif(current_setting('embertrail.user_id', true), '')`
const definer = 'stable security definer set search_path = pg_catalog, pg_temp'

/** The identity tables and the functions the policy sync's row-level security calls. */
export const identityMigration: Migration = {
  id: '0001_identity',
  sql: [
    `create table core.users (
      id text primary key,
      name text not null,
      email text unique check (email = lower(email)),
      admin boolean not null default false,
      created_at timestamptz not null default now()
    )`,
    `create table core.teams (
      id text primary key check (id ~ '^[A-Za-z0-9_-]{1,64}$'),
      name text not null unique,
      created_at timestamptz not null default now()
    )`,
    `create table core.team_members (
      team_id text not null references core.teams (id) on delete cascade,
      user_id text not null references core.users (id) on delete cascade,
      role text not null check (role in ('member', 'editor')),
      primary key (team_id, user_id)
    )`,
    'create index team_members_user_id_idx on core.team_members (user_id)',
    `create table core.sources (
      id text primary key,
      owner_id text not null references core.users (id) on delete cascade,
      name text not null,
      created_at timestamptz not null default now(),
      unique (owner_id, name),
      unique (id, owner_id)
    )`,
    // An ingest Token is bound to exactly one Source, of its own User; no other kind is.
    `create table core.tokens (
      id text primary key,
      user_id text not null references core.users (id) on delete cascade,
      kind text not null check (kind in ('ingest', 'read', 'management')),
      source_id text,
      scopes text[] not null,
      name text not null default '',
      secret_hash text not null,
      created_at timestamptz not null default now(),
      expires_at timestamptz,
      revoked_at timestamptz,
      constraint tokens_source_binding check ((kind = 'ingest') = (source_id is not null)),
      foreign key (source_id, user_id) references core.sources (id, owner_id) on delete cascade
    )`,
    'create index tokens_user_id_idx on core.tokens (user_id)',
    `create table core.accounts (
      id text primary key,
      owner_id text not null references core.users (id) on delete cascade,
      key text not null,
      organization_id text,
      account_uuid text,
      email text,
      source_id text references core.sources (id) on delete cascade,
      label text,
      created_at timestamptz not null default now(),
      unique (owner_id, key)
    )`,
    `create table core.grants (
      id text primary key,
      module text not null,
      account_id text not null references core.accounts (id) on delete cascade,
      user_id text references core.users (id) on delete cascade,
      team_id text references core.teams (id) on delete cascade,
      created_at timestamptz not null default now(),
      constraint grants_one_grantee check (num_nonnulls(user_id, team_id) = 1)
    )`,
    'create unique index grants_user_key on core.grants (module, account_id, user_id) where user_id is not null',
    'create unique index grants_team_key on core.grants (module, account_id, team_id) where team_id is not null',
    // One row once a first User exists, so BOOTSTRAP_TOKEN never works twice.
    `create table core.bootstrap (
      id boolean primary key default true check (id),
      user_id text not null,
      used_at timestamptz not null default now()
    )`,
    // The Owners whose rows the caller reads: their User, the Owner they act for, their Teams.
    `create function core.readable_owners() returns text[] language sql ${definer} as $$
      select array[${callerUser}, nullif(current_setting('embertrail.owner_id', true), '')]
        || array(select m.team_id from core.team_members m where m.user_id = ${callerUser})
    $$`,
    // The Accounts a Grant lets the caller, or one of their Teams, read in one Module.
    `create function core.granted_accounts(module_name text) returns text[] language sql ${definer} as $$
      select array(
        select g.account_id from core.grants g
        where g.module = $1
          and (g.user_id = ${callerUser}
            or g.team_id in (select m.team_id from core.team_members m where m.user_id = ${callerUser})))
    $$`,
    // ctx.ownerOf: an Owner id that names a Team is a Team's; any other is a User's.
    `create function core.owner_kind(owner text) returns text language sql ${definer} as $$
      select case when exists (select 1 from core.teams t where t.id = $1) then 'team' else 'user' end
    $$`,
    `create function core.account_owner(account text) returns text language sql ${definer} as $$
      select a.owner_id from core.accounts a where a.id = $1
    $$`,
    // Account recognition (#29): organization.id + user.account_uuid, else user.email, else
    // one Unknown Account per Source. Always the caller's own User's Account.
    `create function core.recognise_account(in_org text, in_uuid text, in_email text) returns text
    language plpgsql volatile security definer set search_path = pg_catalog, pg_temp as $$
    declare
      v_caller text := ${callerUser};
      v_source text := nullif(current_setting('embertrail.source_id', true), '');
      v_org text := nullif(btrim(in_org), '');
      v_uuid text := nullif(btrim(in_uuid), '');
      v_email text := lower(nullif(btrim(in_email), ''));
      v_key text;
      v_id text;
      v_known text;
    begin
      if v_caller is null then
        raise exception 'core.recognise_account needs a caller';
      end if;
      if v_org is not null and v_uuid is not null then
        v_key := 'account:' || v_org || '/' || v_uuid;
      elsif v_email is not null then
        v_key := 'email:' || v_email;
      elsif v_source is not null then
        v_key := 'unknown:' || v_source;
      else
        raise exception 'core.recognise_account: telemetry naming no Account needs a Source-bound caller';
      end if;
      select a.id, a.email into v_id, v_known from core.accounts a
        where a.owner_id = v_caller and a.key = v_key;
      if v_id is not null then
        if v_known is null and v_email is not null then
          update core.accounts set email = v_email where id = v_id;
        end if;
        return v_id;
      end if;
      insert into core.accounts (id, owner_id, key, organization_id, account_uuid, email, source_id)
        values (gen_random_uuid()::text, v_caller, v_key, v_org, v_uuid, v_email,
          case when v_key like 'unknown:%' then v_source end)
        on conflict (owner_id, key) do update set email = coalesce(core.accounts.email, excluded.email)
        returning id into v_id;
      return v_id;
    end
    $$`,
    `grant usage on schema core to ${dbRoles.app}, ${dbRoles.readonly}`,
    // Only writes call these, so the readonly (SQL endpoint) role can't.
    'revoke execute on function core.owner_kind(text) from public',
    `grant execute on function core.owner_kind(text) to ${dbRoles.app}`,
    'revoke execute on function core.account_owner(text) from public',
    `grant execute on function core.account_owner(text) to ${dbRoles.app}`,
    'revoke execute on function core.recognise_account(text, text, text) from public',
    `grant execute on function core.recognise_account(text, text, text) to ${dbRoles.app}`,
  ].join('\n--> statement-breakpoint\n'),
}
