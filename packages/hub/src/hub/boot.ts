import { getTableConfig } from 'drizzle-orm/pg-core'
import { z } from 'zod'

import { contractVersion, ownedTableInfo } from '../module/define'
import type { HttpMethod, Module } from '../module/define'
import { HubBootError } from '../module/errors'
import { routeKey } from './router'

/** The Hub's config, built by each Platform's entry file and validated at boot. */
export const hubConfigSchema = z.strictObject({
  /** Days a Module's `retention` column keeps rows. Unset keeps them forever. */
  retentionDays: z.number().int().positive().optional(),
  /**
   * `BOOTSTRAP_TOKEN`: a one-time secret that `POST /api/v1/bootstrap` exchanges for the
   * first User and an admin Token (#29). Unset, that route always answers 401.
   */
  bootstrapToken: z.string().min(32, 'bootstrapToken must be at least 32 characters').optional(),
  /** `ALLOWED_EMAILS`: Edge Identity emails that become a User on first sight. */
  allowedEmails: z.array(z.email().toLowerCase()).default([]),
  /** `ALLOWED_DOMAINS`: email domains (exact match, no subdomains) that do the same. */
  allowedDomains: z
    .array(
      z
        .string()
        .toLowerCase()
        .regex(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/, 'a domain such as example.com'),
    )
    .default([]),
})

export type HubConfig = z.input<typeof hubConfigSchema>

export function parseConfig(config: HubConfig) {
  const result = hubConfigSchema.safeParse(config)
  if (!result.success) {
    throw new HubBootError('Hub config', 'invalid config', z.prettifyError(result.error))
  }
  return result.data
}

/** Routes the core serves itself; no op may take them. */
export const coreRoutes: readonly { method: HttpMethod; path: string }[] = [
  { method: 'GET', path: '/api/v1/openapi.json' },
  { method: 'GET', path: '/api/v1/docs' },
  { method: 'GET', path: '/llms.txt' },
  { method: 'POST', path: '/api/v1/bootstrap' },
  { method: 'POST', path: '/api/v1/sql' },
]

const namePattern = /^[a-z][a-z0-9_]{0,62}$/
const reservedNames = new Set(['core', 'public', 'information_schema'])
const pathPattern = /^(\/([A-Za-z0-9._~-]+|\{[A-Za-z_][A-Za-z0-9_]*\}))+$/

function checkModule(module: Module) {
  const subject = `Module "${module.name}"`
  if ((module.contract as number) !== contractVersion) {
    throw new HubBootError(
      subject,
      'unknown contract',
      `contract ${String(module.contract)} is not supported; this Hub implements contract ${contractVersion}`,
    )
  }
  if (
    !namePattern.test(module.name) ||
    reservedNames.has(module.name) ||
    module.name.startsWith('pg_')
  ) {
    throw new HubBootError(
      subject,
      'invalid name',
      'a Module name is lowercase letters, digits and _, starts with a letter, and is not core, public or pg_*',
    )
  }
  for (const [key, table] of Object.entries(module.tables)) {
    if (ownedTableInfo(table) === undefined) {
      throw new HubBootError(
        subject,
        'not an owned table',
        `table "${key}" was not built with moduleSchema("${module.name}").ownedTable`,
      )
    }
    const { schema, name } = getTableConfig(table)
    if (schema !== module.name) {
      throw new HubBootError(
        subject,
        'table outside schema',
        `table ${String(schema)}.${name} must live in schema "${module.name}"`,
      )
    }
  }
  for (const [key, op] of Object.entries(module.ops)) {
    if (
      op.scope !== undefined &&
      op.scope !== 'admin' &&
      !(op.scope.startsWith(`${module.name}:`) && op.scope.length > module.name.length + 1)
    ) {
      throw new HubBootError(
        subject,
        'scope outside prefix',
        `op "${key}" claims Scope "${op.scope}"; a Module may only use "${module.name}:<verb>" or "admin"`,
      )
    }
    if (!pathPattern.test(op.path)) {
      throw new HubBootError(
        subject,
        'invalid path',
        `op "${key}" has path "${op.path}"; use /segments and {params}`,
      )
    }
  }
  if (module.retention !== undefined) {
    const { column } = module.retention
    const swept = Object.values(module.tables).filter((t) =>
      getTableConfig(t).columns.some((c) => c.name === column),
    )
    if (swept.length === 0) {
      throw new HubBootError(
        subject,
        'retention column',
        `no table has the retention column "${column}"`,
      )
    }
  }
}

function checkPaths(modules: readonly Module[]) {
  const taken = new Map<string, string>(coreRoutes.map((r) => [routeKey(r.method, r.path), 'core']))
  for (const module of modules) {
    for (const [key, op] of Object.entries(module.ops)) {
      const route = routeKey(op.method, op.path)
      const owner = taken.get(route)
      if (owner !== undefined) {
        throw new HubBootError(
          `Module "${module.name}"`,
          'duplicate path',
          `op "${key}" (${op.method} ${op.path}) collides with a route of ${owner === 'core' ? 'the core' : `Module "${owner}"`}`,
        )
      }
      taken.set(route, module.name)
    }
  }
}

/** Orders Modules so each comes after the Modules it `dependsOn`. */
function order(modules: readonly Module[]) {
  const byName = new Map(modules.map((m) => [m.name, m]))
  const ordered: Module[] = []
  const state = new Map<string, 'visiting' | 'done'>()
  const visit = (module: Module, path: readonly string[]) => {
    const seen = state.get(module.name)
    if (seen === 'done') return
    if (seen === 'visiting') {
      const cycle = [...path.slice(path.indexOf(module.name)), module.name]
      throw new HubBootError(
        `Module "${module.name}"`,
        'dependsOn cycle',
        `dependsOn forms a cycle: ${cycle.join(' -> ')}`,
      )
    }
    state.set(module.name, 'visiting')
    for (const name of module.dependsOn ?? []) {
      const dependency = byName.get(name)
      if (dependency === undefined) {
        throw new HubBootError(
          `Module "${module.name}"`,
          'unknown dependency',
          `dependsOn names "${name}", which this Hub doesn't load`,
        )
      }
      visit(dependency, [...path, module.name])
    }
    state.set(module.name, 'done')
    ordered.push(module)
  }
  for (const module of modules) visit(module, [])
  return ordered
}

/** Boot's static checks. Returns the Modules in migration order. */
export function checkModules(modules: readonly Module[]): Module[] {
  const names = new Set<string>()
  for (const module of modules) {
    checkModule(module)
    if (names.has(module.name)) {
      throw new HubBootError(
        `Module "${module.name}"`,
        'duplicate name',
        'two Modules share this name',
      )
    }
    names.add(module.name)
  }
  checkPaths(modules)
  return order(modules)
}
