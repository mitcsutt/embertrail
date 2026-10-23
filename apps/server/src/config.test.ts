import { describe, expect, it } from 'vitest'

import { readConfig } from './config'

const url = 'postgres://u:p@db:5432/embertrail'

describe('readConfig', () => {
  it('needs only DATABASE_URL and defaults the rest', () => {
    expect(readConfig({ DATABASE_URL: url })).toEqual({
      databaseUrl: url,
      poolSize: 10,
      port: 8787,
      host: '0.0.0.0',
      publicUrl: undefined,
      hub: { allowedEmails: [], allowedDomains: [] },
    })
  })

  it('reads every variable, splitting the allowlists on commas', () => {
    const config = readConfig({
      DATABASE_URL: url,
      DATABASE_POOL_SIZE: '4',
      PORT: '9000',
      HOST: '127.0.0.1',
      PUBLIC_URL: 'https://hub.example.com',
      BOOTSTRAP_TOKEN: 'x'.repeat(32),
      ALLOWED_EMAILS: 'a@example.com, b@example.com',
      ALLOWED_DOMAINS: 'example.com',
      RETENTION_DAYS: '90',
    })
    expect(config).toMatchObject({ poolSize: 4, port: 9000, host: '127.0.0.1' })
    expect(config.hub).toEqual({
      bootstrapToken: 'x'.repeat(32),
      allowedEmails: ['a@example.com', 'b@example.com'],
      allowedDomains: ['example.com'],
      retentionDays: 90,
    })
  })

  it('treats an empty variable as unset, as Compose passes it', () => {
    const config = readConfig({
      DATABASE_URL: url,
      BOOTSTRAP_TOKEN: '',
      RETENTION_DAYS: '',
      PORT: '',
    })
    expect(config.port).toBe(8787)
    expect(config.hub).not.toHaveProperty('bootstrapToken')
    expect(config.hub).not.toHaveProperty('retentionDays')
  })

  it('names every bad variable in one error', () => {
    expect(() => readConfig({ PORT: 'eighty', RETENTION_DAYS: '-1' })).toThrow(
      /DATABASE_URL.*\n.*PORT.*\n.*RETENTION_DAYS/,
    )
  })
})
