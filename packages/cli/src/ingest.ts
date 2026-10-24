// A Source and an ingest Token for it, as `setup claude-code` and `import` both need them.

import type { EmbertrailClient } from '@mitcsutt/embertrail-client'

import { CliError } from './errors.ts'

/** A Token's id: `et_<id>_<secret>`. */
export function tokenId(token: string): string | undefined {
  return /^et_([a-z0-9]{16})_/.exec(token)?.[1]
}

const writeScope = /^[a-z][a-z0-9_]*:write$/

type Source = Awaited<ReturnType<EmbertrailClient['listSources']>>['items'][number]

/** The caller's Source called `name`, if there is one. */
export async function findSource(
  client: EmbertrailClient,
  name: string,
): Promise<Source | undefined> {
  return (await client.listSources()).items.find((source) => source.name === name)
}

/** A new ingest Token for an existing Source, holding the logged-in Token's `:write` Scopes. */
export async function issueIngestToken(
  client: EmbertrailClient,
  managementToken: string,
  source: Source,
  options: { name: string; expiresAt?: string },
): Promise<{ token: string; id: string }> {
  const caller = (await client.listTokens()).items.find(
    (record) => record.id === tokenId(managementToken),
  )
  const scopes = (caller?.scopes ?? []).filter((scope) => writeScope.test(scope))
  if (scopes.length === 0) {
    throw new CliError(
      `Source "${source.name}" exists, and the logged-in Token holds no Module :write Scope to give its new Token`,
    )
  }
  const issued = await client.issueToken({
    body: {
      kind: 'ingest',
      scopes,
      source_id: source.id,
      name: options.name,
      ...(options.expiresAt === undefined ? {} : { expires_at: options.expiresAt }),
    },
  })
  return { token: issued.token, id: issued.record.id }
}

/**
 * The Source called `name` and a new ingest Token for it: the Source is created when it is
 * missing (its creation Token is the one returned), else a Token is issued for it.
 */
export async function sourceWithToken(
  client: EmbertrailClient,
  managementToken: string,
  name: string,
  options: { tokenName: string; expiresAt?: string },
): Promise<{ source: Source; created: boolean; token: string; tokenId: string }> {
  const existing = await findSource(client, name)
  if (existing === undefined) {
    const created = await client.createSource({
      body: {
        name,
        ...(options.expiresAt === undefined ? {} : { expires_at: options.expiresAt }),
      },
    })
    return {
      source: created.source,
      created: true,
      token: created.token.token,
      tokenId: created.token.record.id,
    }
  }
  const issued = await issueIngestToken(client, managementToken, existing, {
    name: options.tokenName,
    ...(options.expiresAt === undefined ? {} : { expiresAt: options.expiresAt }),
  })
  return { source: existing, created: false, token: issued.token, tokenId: issued.id }
}
