import { sql } from 'drizzle-orm'

import { rows } from '../db/port'
import type { ScopedDb } from '../db/port'

/** The telemetry attributes Account recognition reads (#29). */
export const accountAttributeKeys = {
  organizationId: 'organization.id',
  accountUuid: 'user.account_uuid',
  email: 'user.email',
} as const

function text(value: unknown) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/**
 * The Account a set of telemetry attributes names, for the caller's own User: by
 * `organization.id` + `user.account_uuid`, else `user.email`, else the Source's Unknown
 * Account. Created on first sight. Runs on the op's transaction (`core.recognise_account`).
 */
export async function recogniseAccount(
  db: ScopedDb,
  attributes: Readonly<Record<string, unknown>>,
) {
  const organizationId = text(attributes[accountAttributeKeys.organizationId])
  const accountUuid = text(attributes[accountAttributeKeys.accountUuid])
  const email = text(attributes[accountAttributeKeys.email])
  const [found] = await rows<{ id: string }>(
    db,
    sql`select core.recognise_account(${organizationId}, ${accountUuid}, ${email}) as id`,
  )
  if (found === undefined) throw new Error('core.recognise_account returned no row')
  return found.id
}

/** One recogniser per op: each distinct set of attributes is looked up once. */
export function accountRecogniser(db: ScopedDb) {
  const seen = new Map<string, Promise<string>>()
  return (attributes: Readonly<Record<string, unknown>>) => {
    const key = JSON.stringify(
      Object.values(accountAttributeKeys).map((name) => text(attributes[name])),
    )
    let found = seen.get(key)
    if (found === undefined) {
      found = recogniseAccount(db, attributes)
      seen.set(key, found)
    }
    return found
  }
}

/** An Account's label: the User's own, else its email's domain, else `Unknown`. */
export function accountLabel(account: { label: string | null; email: string | null }) {
  if (account.label !== null) return account.label
  const domain = account.email?.split('@').at(-1)
  return domain === undefined || domain === '' ? 'Unknown' : domain
}
