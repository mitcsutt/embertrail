// The stack the browser specs run against: a real Hub on PGLite seeded with the demo dataset and
// served over HTTP, and the built Dashboard served by `vite preview` in front of it. Three
// previews share the Hub so each failure state is real: the working one, one whose proxy holds a
// bad Token (the Hub answers 401) and one whose proxy points at a port nothing listens on.

import type { AddressInfo } from 'node:net'

import { serve } from '@hono/node-server'
import { build, preview } from 'vite'
import type { PreviewServer } from 'vite'

import { dashboardTestHub } from '../test/hub.ts'

export interface Stack {
  /** Origins of the three previews, in the order described above. */
  origins: { working: string; unauthorized: string; unreachable: string }
  close(): Promise<void>
}

const dashboardRoot = new URL('..', import.meta.url).pathname

/** Opens a port and releases it again, to point a proxy at an address nothing listens on. */
async function unusedPort(): Promise<number> {
  const { createServer } = await import('node:net')
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  await new Promise((resolve) => server.close(resolve))
  return port
}

/** Starts one preview whose proxy sends /api to `hub` with `token` (the proxy reads its env). */
async function startPreview(hub: string, token: string): Promise<PreviewServer> {
  process.env.EMBERTRAIL_HUB = hub
  process.env.EMBERTRAIL_TOKEN = token
  return preview({
    root: dashboardRoot,
    logLevel: 'warn',
    preview: { host: '127.0.0.1', port: 0, strictPort: false },
  })
}

const originOf = (server: PreviewServer): string => {
  const [url] = server.resolvedUrls?.local ?? []
  if (url === undefined) throw new Error('The preview server has no URL')
  return url.replace(/\/$/, '')
}

export async function startStack(): Promise<Stack> {
  const hub = await dashboardTestHub({ now: new Date() })
  const hubServer = serve({
    fetch: (request) => hub.t.hub.fetch(request),
    hostname: '127.0.0.1',
    port: 0,
  })
  await new Promise<void>((resolve) => hubServer.once('listening', resolve))
  const hubUrl = `http://127.0.0.1:${String((hubServer.address() as AddressInfo).port)}`

  await build({ root: dashboardRoot, logLevel: 'warn' })
  const previews = [
    await startPreview(hubUrl, hub.token),
    await startPreview(hubUrl, 'et_not-a-token'),
    await startPreview(`http://127.0.0.1:${String(await unusedPort())}`, hub.token),
  ] as const
  const [working, unauthorized, unreachable] = previews

  return {
    origins: {
      working: originOf(working),
      unauthorized: originOf(unauthorized),
      unreachable: originOf(unreachable),
    },
    async close() {
      await Promise.all(previews.map((server) => server.close()))
      await new Promise((resolve) => hubServer.close(resolve))
      await hub.close()
    },
  }
}
