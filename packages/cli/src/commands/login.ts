import { isProblemError } from '@mitcsutt/embertrail-client'

import { hubClient } from '../command.ts'
import type { Command, Context } from '../command.ts'
import { isLocalHub, normaliseHub, writeConfig } from '../config.ts'
import { CliError } from '../errors.ts'

async function store(ctx: Context, hub: string, token: string, who: string) {
  const path = await writeConfig(ctx.io, { hub, token })
  if (new URL(hub).protocol === 'http:' && !isLocalHub(hub)) {
    ctx.io.stderr(
      `warning: ${hub} is plain http, so the Token crosses the network unencrypted; use https\n`,
    )
  }
  ctx.print(
    { hub, config: path },
    `Logged in to ${hub}${who}.\nSaved to ${path} (readable only by you).`,
  )
}

export const login: Command = {
  path: ['login'],
  summary: 'Store the Hub URL and a management Token',
  description:
    'Checks the Token against the Hub, then stores both in your config directory, readable only by you. ' +
    'Set EMBERTRAIL_HUB and EMBERTRAIL_TOKEN instead to skip the stored config (CI, containers).',
  options: {
    hub: { type: 'string', value: 'url', required: true, description: "The Hub's address" },
    token: {
      type: 'string',
      value: 'token',
      description: 'A management Token (default: $EMBERTRAIL_TOKEN)',
    },
  },
  async run(ctx, args) {
    const hub = normaliseHub(args.string('hub') ?? '')
    const token = args.string('token') ?? ctx.io.env.EMBERTRAIL_TOKEN
    if (token === undefined || token === '') {
      throw new CliError('Give the Token with --token or EMBERTRAIL_TOKEN')
    }
    try {
      await hubClient(ctx.io, hub, token).listSources()
    } catch (error) {
      // 403: the Token is real but cannot manage its own Sources, so keep it for what it can do.
      if (!isProblemError(error) || error.status !== 403) throw error
    }
    await store(ctx, hub, token, '')
  },
}

export const bootstrap: Command = {
  path: ['bootstrap'],
  summary: "Create a new Hub's first User and log in as them",
  description:
    "Exchanges the Hub's BOOTSTRAP_TOKEN for its first User, an instance admin, and a management Token, " +
    'then logs in with that Token. Works once. The Docker Hub started without a BOOTSTRAP_TOKEN needs no bootstrap.',
  options: {
    hub: { type: 'string', value: 'url', required: true, description: "The Hub's address" },
    'bootstrap-token': {
      type: 'string',
      value: 'token',
      description: "The Hub's BOOTSTRAP_TOKEN (default: $BOOTSTRAP_TOKEN)",
    },
    name: { type: 'string', value: 'name', description: "The first User's name" },
    email: { type: 'string', value: 'email', description: "The first User's email" },
  },
  async run(ctx, args) {
    const hub = normaliseHub(args.string('hub') ?? '')
    const secret = args.string('bootstrap-token') ?? ctx.io.env.BOOTSTRAP_TOKEN
    if (secret === undefined || secret === '') {
      throw new CliError('Give the secret with --bootstrap-token or BOOTSTRAP_TOKEN')
    }
    const name = args.string('name')
    const email = args.string('email')
    const { user, token } = await hubClient(ctx.io, hub, secret).bootstrap({
      body: { ...(name === undefined ? {} : { name }), ...(email === undefined ? {} : { email }) },
    })
    await store(ctx, hub, token, ` as ${user.name} (${user.id})`)
  },
}
