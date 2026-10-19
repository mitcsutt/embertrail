// The Hub's core. Modules import only from here; Platforms import the Ports and createHub.
// Tests use `@mitcsutt/embertrail-hub/testing`; Adapter suites `@mitcsutt/embertrail-hub/contract`.

export { contractVersion, defineModule, moduleSchema, op } from './module/define'
export type {
  Caller,
  Ctx,
  Exporter,
  HttpMethod,
  Migration,
  Module,
  ModuleDef,
  Op,
  OpDef,
  OwnedTable,
  RawDef,
  Scope,
} from './module/define'
export { HubBootError, HubError } from './module/errors'
export type { BootRule, FieldError, ProblemSlug } from './module/errors'

export { createHub } from './hub/create-hub'
export type { Hub, HubOptions, Ports } from './hub/create-hub'
export type { HubConfig } from './hub/boot'
export type { OpenApiDocument } from './hub/openapi'

export { drizzleDbPort } from './db/port'
export type { DbPort, DbSession, ScopedDb } from './db/port'
export type { AppliedMigration, MigrationReport } from './db/migrate'

export { cloudflareAccess, EdgeIdentityError, noEdgeIdentity } from './identity/edge'
export type { CloudflareAccessOptions, EdgeIdentity, EdgeIdentityPort } from './identity/edge'
export type { Directory, Principal } from './identity/resolve'
