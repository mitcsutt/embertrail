import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { serve } from '@hono/node-server'
import { createHub, noEdgeIdentity } from '@mitcsutt/embertrail-hub'
import type { Hub } from '@mitcsutt/embertrail-hub'

import { readConfig } from './config'
import { dockerDb } from './db'
import { hubModules } from './modules'
import { zeroConfigStart } from './zero-config'

const retentionIntervalMs = 60 * 60 * 1000

export interface RunningServer {
  hub: Hub
  /** The port it listens on (useful when the config asked for 0). */
  port: number
  close(): Promise<void>
}

export interface StartOptions {
  env: Record<string, string | undefined>
  log?: (line: string) => void
}

/**
 * Builds the Hub from env with the Docker Db Adapter and no Edge Identity, then listens. The
 * database must already be migrated (`embertrail migrate`): `boot()` fails the start otherwise.
 */
export async function startServer({
  env,
  log = (line) => {
    console.log(line)
  },
}: StartOptions): Promise<RunningServer> {
  const config = readConfig(env)
  const db = dockerDb({ url: config.databaseUrl, poolSize: config.poolSize })
  let listener: Server | undefined
  let timer: NodeJS.Timeout | undefined
  const close = async () => {
    if (timer !== undefined) clearInterval(timer)
    const closing = listener
    if (closing !== undefined) {
      await new Promise<void>((resolve) => {
        closing.close(() => {
          resolve()
        })
        closing.closeAllConnections()
      })
    }
    await db.close()
  }
  try {
    const hub = createHub({
      config: config.hub,
      ports: { db, edgeIdentity: noEdgeIdentity() },
      modules: hubModules,
    })
    await hub.boot()

    // Plain HTTP/1, so `serve` returns a `node:http` server, though its type allows HTTP/2 too.
    const listening = serve({
      fetch: (request) => hub.fetch(request),
      port: config.port,
      hostname: config.host,
    }) as Server
    listener = listening
    await new Promise<void>((resolve, reject) => {
      listening.once('listening', resolve)
      listening.once('error', reject)
    })
    const port = (listening.address() as AddressInfo).port
    // The URL the person's own machine uses: the container's port mapping is outside our view.
    const hubUrl = config.publicUrl ?? `http://localhost:${String(port)}`
    log(`[embertrail] listening on ${config.host}:${String(port)}`)

    await zeroConfigStart(hub, { bootstrapToken: config.hub.bootstrapToken, hubUrl, log })

    if (config.hub.retentionDays !== undefined) {
      const sweep = () => {
        hub.runRetention().then(
          ({ deleted }) => {
            if (deleted > 0) log(`[embertrail] retention deleted ${String(deleted)} rows`)
          },
          (error: unknown) => {
            console.error('[embertrail] retention failed:', error)
          },
        )
      }
      sweep()
      timer = setInterval(sweep, retentionIntervalMs)
      timer.unref()
    }
    return { hub, port, close }
  } catch (error) {
    await close()
    throw error
  }
}
