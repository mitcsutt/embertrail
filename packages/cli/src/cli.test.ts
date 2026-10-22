import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { claudeCode, fixtureText, pathOf, postOtlp } from '@mitcsutt/embertrail-otel/testing'

import { commands } from './commands/index.ts'
import { startHarness } from './testing/harness.ts'
import type { Harness } from './testing/harness.ts'

let h: Harness
beforeAll(async () => {
  h = await startHarness()
})
afterAll(() => h.close())

const configFile = () => join(h.env.EMBERTRAIL_CONFIG_DIR ?? '', 'config.json')
const settingsFile = () => join(h.env.CLAUDE_CONFIG_DIR ?? '', 'settings.json')
const mode = async (path: string) => (await stat(path)).mode & 0o777

describe('help', () => {
  it('lists the commands', async () => {
    const { code, out } = await h.cli('--help')
    expect(code).toBe(0)
    for (const word of [
      'login',
      'setup claude-code',
      'admin users create',
      'sources list',
      'migrate',
    ]) {
      expect(out).toContain(word)
    }
  })

  it.each(commands.map((command) => [command.path.join(' '), command.path] as const))(
    '%s has --help',
    async (_name, path) => {
      const { code, out, err } = await h.cli(...path, '--help')
      expect({ code, err }).toEqual({ code: 0, err: '' })
      expect(out).toMatch(`Usage: embertrail ${path.join(' ')}`)
      expect(out).toContain('--help')
    },
  )

  it('lists a group’s commands', async () => {
    const { code, out } = await h.cli('admin', 'teams', '--help')
    expect(code).toBe(0)
    expect(out).toContain('set-member')
    expect(out).not.toContain('users')
  })

  it('exits 2 on an unknown command, option or missing argument', async () => {
    expect((await h.cli('nope')).code).toBe(2)
    expect((await h.cli('admin', 'nope')).err).toContain('Unknown command "admin nope"')
    expect((await h.cli('sources', 'rename', 'only-one')).err).toContain('Missing <name>')
    expect((await h.cli('login', '--hub', 'http://x', '--wat')).code).toBe(2)
  })
})

describe('login', () => {
  it('stores the Hub and Token readable only by the user', async () => {
    const { code, out } = await h.cli('login', '--hub', 'http://hub.test/', '--token', h.token)
    expect(code).toBe(0)
    expect(out).toContain('Logged in to http://hub.test')
    expect(JSON.parse(await readFile(configFile(), 'utf8'))).toEqual({
      hub: 'http://hub.test',
      token: h.token,
    })
    expect(await mode(configFile())).toBe(0o600)
  })

  it('tightens a config file that was wider', async () => {
    const { chmod } = await import('node:fs/promises')
    await chmod(configFile(), 0o644)
    await h.cli('login', '--hub', 'http://hub.test', '--token', h.token)
    expect(await mode(configFile())).toBe(0o600)
  })

  it('refuses a Token the Hub rejects, keeping the stored one', async () => {
    const before = await readFile(configFile(), 'utf8')
    const bad = `et_${'a'.repeat(16)}_${'B'.repeat(40)}`
    const { code, err } = await h.cli('login', '--hub', 'http://hub.test', '--token', bad)
    expect(code).toBe(1)
    expect(err).toMatch(/error: .+ \(401\)/)
    expect(await readFile(configFile(), 'utf8')).toBe(before)
  })

  it('says when the Hub cannot be reached', async () => {
    const { code, err } = await h.cli('login', '--hub', 'not a url', '--token', h.token)
    expect(code).toBe(1)
    expect(err).toContain('is not a URL')
  })

  it('needs a login for the other commands', async () => {
    const other = await startHarness()
    try {
      const { code, err } = await other.cli('sources', 'list')
      expect(code).toBe(1)
      expect(err).toContain('Not logged in')
    } finally {
      await other.close()
    }
  })
})

describe('errors', () => {
  it('print the problem title, detail and request_id', async () => {
    // alice is an admin: asking for a User that does not exist is a 404 problem.
    const { code, err } = await h.cli('admin', 'users', 'delete', 'nobody')
    expect(code).toBe(1)
    expect(err).toMatch(/^error: .+ \(404\)\n {2}.+\n {2}request_id: \S+\n$/)
  })

  it('print field errors on a validation problem', async () => {
    const { err } = await h.cli('admin', 'teams', 'create', 'x', '--id', 'not valid!')
    expect(err).toMatch(/\(400\)/)
    expect(err).toMatch(/request_id: \S+/)
  })
})

describe('setup claude-code', () => {
  it('creates the Source and writes the settings, which an ingest call then uses', async () => {
    const { code, out } = await h.cli('setup', 'claude-code', '--source', 'laptop')
    expect(code).toBe(0)
    expect(out).toContain('Created Source "laptop"')

    const { env } = JSON.parse(await readFile(settingsFile(), 'utf8')) as {
      env: Record<string, string>
    }
    expect(env).toMatchObject({
      CLAUDE_CODE_ENABLE_TELEMETRY: '1',
      OTEL_METRICS_EXPORTER: 'otlp',
      OTEL_LOGS_EXPORTER: 'otlp',
      OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://hub.test',
    })
    expect(Object.keys(env).filter((key) => key.includes('TRACES'))).toEqual([])
    expect(await mode(settingsFile())).toBe(0o600)

    const authorization = (env.OTEL_EXPORTER_OTLP_HEADERS ?? '').replace('Authorization=', '')
    const sent = await h.t.hub.fetch(
      new Request('http://hub.test/v1/logs', {
        method: 'POST',
        headers: { authorization, 'content-type': 'application/json' },
        body: JSON.stringify({ resourceLogs: [] }),
      }),
    )
    expect(sent.status).toBe(200)
  })

  it('run again, rotates the Token and revokes the old one, leaving the settings shape alone', async () => {
    const first = JSON.parse(await readFile(settingsFile(), 'utf8')) as {
      env: Record<string, string>
    }
    const { code, out } = await h.cli('setup', 'claude-code', '--source', 'laptop')
    expect(code).toBe(0)
    expect(out).toContain('Reusing Source "laptop"')
    expect(out).toContain('Revoked 1 earlier ingest Token')

    const second = JSON.parse(await readFile(settingsFile(), 'utf8')) as {
      env: Record<string, string>
    }
    expect(Object.keys(second.env)).toEqual(Object.keys(first.env))
    expect(second.env.OTEL_EXPORTER_OTLP_HEADERS).not.toBe(first.env.OTEL_EXPORTER_OTLP_HEADERS)

    const old = (first.env.OTEL_EXPORTER_OTLP_HEADERS ?? '').replace('Authorization=', '')
    const post = (authorization: string) =>
      h.t.hub.fetch(
        new Request('http://hub.test/v1/logs', {
          method: 'POST',
          headers: { authorization, 'content-type': 'application/json' },
          body: JSON.stringify({ resourceLogs: [] }),
        }),
      )
    expect((await post(old)).status).toBe(401)
    expect(
      (await post((second.env.OTEL_EXPORTER_OTLP_HEADERS ?? '').replace('Authorization=', '')))
        .status,
    ).toBe(200)
    expect((await h.cli('sources', 'list', '--json')).out).toContain('"laptop"')
  })

  it('fails before creating anything when the settings file is not JSON', async () => {
    const { writeFile } = await import('node:fs/promises')
    const path = join(h.home, 'broken.json')
    await writeFile(path, '{ nope')
    const { code, err } = await h.cli(
      'setup',
      'claude-code',
      '--source',
      'desk',
      '--settings',
      path,
    )
    expect(code).toBe(1)
    expect(err).toContain('not valid JSON')
    const { out } = await h.cli('sources', 'list')
    expect(out).not.toContain('desk')
  })

  it('needs --source', async () => {
    expect((await h.cli('setup', 'claude-code')).err).toContain('Missing --source')
  })
})

describe('admin', () => {
  it('manages Users and Teams', async () => {
    const created = await h.cli(
      'admin',
      'users',
      'create',
      'Bob',
      '--email',
      'bob@example.test',
      '--json',
    )
    expect(created.code).toBe(0)
    const { user, token } = JSON.parse(created.out) as { user: { id: string }; token: string }
    expect(token).toMatch(/^et_/)

    expect((await h.cli('admin', 'users', 'list')).out).toMatch(/Bob\s+bob@example.test/)

    expect((await h.cli('admin', 'teams', 'create', 'The Crew', '--id', 'crew')).out).toContain(
      'crew',
    )
    expect(
      (await h.cli('admin', 'teams', 'set-member', 'crew', user.id, '--role', 'editor')).out,
    ).toContain('editor of crew')
    expect(
      (await h.cli('admin', 'teams', 'set-member', 'crew', user.id, '--role', 'boss')).code,
    ).toBe(2)
    expect((await h.cli('admin', 'teams', 'list')).out).toContain('The Crew')
    expect((await h.cli('admin', 'teams', 'remove-member', 'crew', user.id)).code).toBe(0)
    expect((await h.cli('admin', 'teams', 'delete', 'crew')).code).toBe(0)

    const sources = await h.cli('admin', 'sources', 'list')
    expect(sources.out).toContain('laptop')

    expect((await h.cli('admin', 'users', 'delete', user.id)).out).toContain('Deleted User')
    const noToken = await h.cli('admin', 'users', 'create', 'Carol', '--no-token')
    expect(noToken.out).not.toContain('Token')
  })

  it('is refused for a User who is not an admin', async () => {
    await h.t.user('dave')
    const { token } = await h.t.hub.directory.issueToken('dave', {
      kind: 'management',
      scopes: ['self:manage'],
    })
    const dave = await startAs(token)
    const { code, err } = await dave('admin', 'users', 'list')
    expect(code).toBe(1)
    expect(err).toMatch(/\(403\)/)
    expect(err).toContain('request_id')
  })
})

/** The CLI logged in with another Token, through the environment. */
async function startAs(token: string) {
  const { run } = await import('./cli.ts')
  return async (...argv: string[]) => {
    let out = ''
    let err = ''
    const code = await run(argv, {
      env: { ...h.env, EMBERTRAIL_HUB: 'http://hub.test', EMBERTRAIL_TOKEN: token },
      home: h.home,
      fetch: (input, init) => h.t.hub.fetch(new Request(input, init)),
      stdout: (text) => {
        out += typeof text === 'string' ? text : new TextDecoder().decode(text)
      },
      stderr: (text) => {
        err += text
      },
    })
    return { code, out, err }
  }
}

describe('self-management', () => {
  it('creates, renames and deletes Sources', async () => {
    const created = await h.cli('sources', 'create', 'desk', '--json')
    const { source, token } = JSON.parse(created.out) as {
      source: { id: string }
      token: { token: string }
    }
    expect(token.token).toMatch(/^et_/)
    expect((await h.cli('sources', 'rename', source.id, 'work desk')).out).toContain('work desk')
    expect((await h.cli('sources', 'list')).out).toContain('work desk')
    expect((await h.cli('sources', 'delete', source.id)).out).toContain('Deleted Source')
    expect((await h.cli('sources', 'list')).out).not.toContain('work desk')
  })

  it('issues, lists and revokes Tokens', async () => {
    const issued = await h.cli(
      'tokens',
      'issue',
      '--kind',
      'read',
      '--scope',
      'otel:read',
      '--name',
      'dash',
      '--json',
    )
    expect(issued.code).toBe(0)
    const { record } = JSON.parse(issued.out) as { record: { id: string } }
    expect((await h.cli('tokens', 'list')).out).toMatch(/dash/)
    expect((await h.cli('tokens', 'revoke', record.id)).code).toBe(0)
    expect((await h.cli('tokens', 'issue', '--kind', 'read')).err).toContain('at least one --scope')
    expect((await h.cli('tokens', 'issue', '--kind', 'odd', '--scope', 'x:y')).code).toBe(2)
  })

  it('lists Accounts, labels them, and grants and revokes read access', async () => {
    expect((await h.cli('accounts', 'list')).out).toBe('No Accounts.\n')

    // Telemetry from a Source creates its Account.
    const sender = h.t.as('alice', ['otel:write'], { sourceId: 'sender' })
    const name = claudeCode.logsStartup
    expect((await postOtlp(sender, pathOf(name), fixtureText(name))).status).toBe(200)
    const listed = JSON.parse((await h.cli('accounts', 'list', '--json')).out) as { id: string }[]
    const acct1 = listed[0]?.id ?? ''
    expect(acct1).not.toBe('')
    expect((await h.cli('accounts', 'label', acct1, 'Work')).out).toContain('"Work"')
    expect((await h.cli('accounts', 'label', acct1, '--clear')).code).toBe(0)
    expect((await h.cli('accounts', 'label', acct1)).code).toBe(2)

    await h.t.user('erin')
    const grant = await h.cli(
      'grants',
      'create',
      '--module',
      'otel',
      '--account',
      acct1,
      '--user',
      'erin',
      '--json',
    )
    expect(grant.code).toBe(0)
    const { id: grantId } = JSON.parse(grant.out) as { id: string }
    expect((await h.cli('grants', 'list')).out).toContain('erin')
    expect((await h.cli('grants', 'revoke', grantId)).code).toBe(0)
    expect((await h.cli('grants', 'create', '--module', 'otel', '--account', acct1)).code).toBe(2)
  })

  it('exports a Module as JSON Lines to standard output or a file', async () => {
    const { out, code } = await h.cli('export', 'otel')
    expect(code).toBe(0)
    const lines = out.trim().split('\n')
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) expect(JSON.parse(line)).toHaveProperty('resourceLogs')

    const path = join(h.home, 'otel.jsonl')
    const toFile = await h.cli('export', 'otel', '--out', path)
    expect(toFile.err).toContain(`Wrote ${path}`)
    expect(await readFile(path, 'utf8')).toBe(out)
    expect(await mode(path)).toBe(0o600)

    const missing = await h.cli('export', 'nope')
    expect(missing.code).toBe(1)
    expect(missing.err).toMatch(/\(404\)/)
  })
})
