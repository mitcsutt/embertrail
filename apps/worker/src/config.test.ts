import { createHub } from '@mitcsutt/embertrail-hub'
import type { Ports } from '@mitcsutt/embertrail-hub'
import { describe, expect, it } from 'vitest'

import { readWorkerConfig } from './config'
import type { WorkerEnv } from './env'

const bindings = { HYPERDRIVE: {}, ASSETS: {} } as Pick<WorkerEnv, 'HYPERDRIVE' | 'ASSETS'>
const read = (vars: Partial<WorkerEnv> = {}) => readWorkerConfig({ ...bindings, ...vars })

describe('readWorkerConfig', () => {
  it('gives Tokens only when nothing is set', () => {
    expect(read()).toEqual({ hub: { allowedEmails: [], allowedDomains: [] }, access: null })
  })

  it('treats an empty binding as unset', () => {
    const config = read({
      BOOTSTRAP_TOKEN: '',
      ACCESS_TEAM_DOMAIN: '',
      ACCESS_AUD: '',
      ALLOWED_EMAILS: '',
      RETENTION_DAYS: '',
    })
    expect(config.access).toBeNull()
    expect(config.hub).toEqual({ allowedEmails: [], allowedDomains: [] })
  })

  it('sets access from a full Access pair', () => {
    const config = read({ ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com', ACCESS_AUD: 'aud-tag' })
    expect(config.access).toEqual({ teamDomain: 'team.cloudflareaccess.com', audience: 'aud-tag' })
  })

  it.each([{ ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com' }, { ACCESS_AUD: 'aud-tag' }])(
    'names both Access bindings when only one is set (%o)',
    (vars) => {
      expect(() => read(vars)).toThrow(/ACCESS_TEAM_DOMAIN and ACCESS_AUD/)
    },
  )

  it('splits and trims the lists, and passes the rest to the Hub config', () => {
    const token = 'x'.repeat(32)
    const config = read({
      ALLOWED_EMAILS: ' a@example.com, ,b@example.com ',
      ALLOWED_DOMAINS: 'example.com',
      BOOTSTRAP_TOKEN: token,
      RETENTION_DAYS: '30',
    })
    expect(config.hub).toEqual({
      allowedEmails: ['a@example.com', 'b@example.com'],
      allowedDomains: ['example.com'],
      bootstrapToken: token,
      retentionDays: 30,
    })
  })

  it('reports every bad binding in one error', () => {
    expect(() => read({ RETENTION_DAYS: 'soon', ACCESS_AUD: 'aud-tag' })).toThrow(
      /RETENTION_DAYS[^]*ACCESS_TEAM_DOMAIN and ACCESS_AUD/,
    )
  })

  it('leaves a short BOOTSTRAP_TOKEN to the core schema', () => {
    const { hub } = read({ BOOTSTRAP_TOKEN: 'short' })
    const ports = { db: {}, edgeIdentity: {} } as Ports
    expect(() => createHub({ config: hub, ports, modules: [] })).toThrow(/at least 32 characters/)
  })
})
