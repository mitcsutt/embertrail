import { describe, expect, it } from 'vitest'

import type { Io } from '../io.ts'

import { Replay } from './replay.ts'

/** A resource entry holding `n` log records with a body of `pad` characters each. */
function logs(n: number, pad = 10) {
  return {
    resource: { attributes: [] },
    scopeLogs: [
      {
        scope: {},
        logRecords: Array.from({ length: n }, () => ({ body: { stringValue: 'x'.repeat(pad) } })),
      },
    ],
  }
}

function hub(answer: (body: { resourceLogs: unknown[] }) => Response) {
  const requests: number[] = []
  const io = {
    fetch: (_input, init) => {
      const body = JSON.parse(init?.body as string) as { resourceLogs: unknown[] }
      requests.push(body.resourceLogs.length)
      return Promise.resolve(answer(body))
    },
  } as Io
  const replay = (batchBytes: number) =>
    new Replay({ io, hub: 'http://hub.test', token: 'et_x', batchBytes, backoff: () => 0 })
  return { requests, replay }
}

describe('Replay', () => {
  it('merges entries into requests under the byte budget, never splitting one', async () => {
    const { requests, replay } = hub(() => Response.json({}))
    const r = replay(600)
    for (let i = 0; i < 6; i += 1) await r.add('logs', logs(2, 100))
    const totals = await r.finish()
    expect(totals.logs).toEqual({ sent: 12, refused: 0, requests: requests.length })
    expect(requests.length).toBeGreaterThan(1)
    expect(requests.reduce((a, b) => a + b, 0)).toBe(6)
  })

  it('halves a batch the Hub calls too large, and counts an entry that alone is', async () => {
    const { requests, replay } = hub((body) =>
      body.resourceLogs.length > 1 || JSON.stringify(body).length > 5000
        ? new Response('too large', { status: 413 })
        : Response.json({}),
    )
    const r = replay(1_000_000)
    for (let i = 0; i < 4; i += 1) await r.add('logs', logs(1))
    await r.add('logs', logs(1, 6000))
    const totals = await r.finish()
    expect(totals.logs).toMatchObject({ sent: 4, refused: 1 })
    expect(requests[0]).toBe(5)
  })

  it('splits on Cloudflare’s 1102 and retries a busy Hub', async () => {
    let busy = 1
    const { replay } = hub((body) => {
      if (body.resourceLogs.length > 2) return new Response('error code: 1102', { status: 500 })
      if (busy-- > 0) return new Response('slow down', { status: 429 })
      return Response.json({})
    })
    const r = replay(1_000_000)
    for (let i = 0; i < 4; i += 1) await r.add('logs', logs(1))
    expect((await r.finish()).logs).toMatchObject({ sent: 4, refused: 0 })
  })

  it('counts what partialSuccess refuses', async () => {
    const { replay } = hub(() =>
      Response.json({ partialSuccess: { rejectedLogRecords: '2', errorMessage: 'no' } }),
    )
    const r = replay(1_000_000)
    await r.add('logs', logs(3))
    expect((await r.finish()).logs).toMatchObject({ sent: 3, refused: 2 })
  })

  it('fails on an answer it cannot retry', async () => {
    const { replay } = hub(() => new Response('nope', { status: 401 }))
    const r = replay(1_000_000)
    await r.add('logs', logs(1))
    await expect(r.finish()).rejects.toThrow(/answered 401/)
  })
})
