import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { HubStatus } from './HubStatus'

type Answer = (url: URL, init: RequestInit | undefined) => Response | Promise<Response>

/** Answers fetch by path: `config.json` and the Hub's `/api/v1/...`. Returns the requested URLs. */
function stubFetch(routes: Record<string, Answer>): string[] {
  const requested: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input), 'http://app.test')
      requested.push(url.toString())
      const answer = routes[url.pathname]
      if (answer === undefined) return Promise.resolve(new Response('not found', { status: 404 }))
      return Promise.resolve(answer(url, init))
    }),
  )
  return requested
}

const json = (body: unknown, status = 200, type = 'application/json') =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': type } })
const problem = (status: number, type: string, detail?: string) =>
  json({ type, title: type, status, request_id: 'req', detail }, status, 'application/problem+json')
const config = (hubUrl: string) => () => json({ hubUrl })
const inventory = () =>
  json({ metrics: [], event_names: [], sources: [], accounts: [], owners: [], models: [] })

function renderGate() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <HubStatus>
        <p>The app</p>
      </HubStatus>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('HubStatus', () => {
  it('renders the app once the Hub answers, calling the configured Hub', async () => {
    const requested = stubFetch({
      '/config.json': config('http://hub.test:8787'),
      '/api/v1/inventory': inventory,
    })
    renderGate()

    expect(await screen.findByText('The app')).toBeInTheDocument()
    expect(requested).toContain('http://hub.test:8787/api/v1/inventory')
  })

  it('points the client at whatever config.json says on the next load', async () => {
    const first = stubFetch({
      '/config.json': config('http://first.test'),
      '/api/v1/inventory': inventory,
    })
    const { unmount } = renderGate()
    await screen.findByText('The app')
    unmount()
    const second = stubFetch({
      '/config.json': config('http://second.test/'),
      '/api/v1/inventory': inventory,
    })
    renderGate()

    expect(await screen.findByText('The app')).toBeInTheDocument()
    expect(first).toContain('http://first.test/api/v1/inventory')
    expect(second).toContain('http://second.test/api/v1/inventory')
    expect(second).not.toContain('http://first.test/api/v1/inventory')
  })

  it('reads config.json without the browser cache', async () => {
    const inits: (RequestInit | undefined)[] = []
    stubFetch({
      '/config.json': (_url, init) => {
        inits.push(init)
        return json({ hubUrl: 'http://hub.test' })
      },
      '/api/v1/inventory': inventory,
    })
    renderGate()
    await screen.findByText('The app')

    expect(inits[0]?.cache).toBe('no-store')
  })

  it('names the problem when config.json is not valid', async () => {
    stubFetch({ '/config.json': () => json({ hubUrl: 'ftp://hub.test' }) })
    renderGate()

    expect(await screen.findByText("The Dashboard's config.json can't be used")).toBeInTheDocument()
    expect(screen.getByText(/hubUrl must be/)).toBeInTheDocument()
  })

  it('says when config.json is missing', async () => {
    stubFetch({})
    renderGate()

    expect(await screen.findByText(/the server answered 404/)).toBeInTheDocument()
  })

  it('names the Hub when it cannot be reached', async () => {
    stubFetch({
      '/config.json': config('http://hub.test:8787'),
      '/api/v1/inventory': () => {
        throw new TypeError('Failed to fetch')
      },
    })
    renderGate()

    expect(
      await screen.findByText("Can't reach the Hub at http://hub.test:8787"),
    ).toBeInTheDocument()
  })

  it('names this page and the proxy when the dev proxy cannot reach the Hub', async () => {
    stubFetch({
      '/config.json': config(''),
      '/api/v1/inventory': () =>
        new Response('', { status: 500, headers: { 'content-type': 'text/plain' } }),
    })
    renderGate()

    expect(await screen.findByText(`Can't reach the Hub at ${location.origin}`)).toBeInTheDocument()
    expect(screen.getByText(/EMBERTRAIL_HUB/)).toBeInTheDocument()
  })

  it('names the Hub on a 401 and says how to set a Token', async () => {
    stubFetch({
      '/config.json': config('http://hub.test:8787'),
      '/api/v1/inventory': () => problem(401, 'urn:embertrail:problem:unauthorized'),
    })
    renderGate()

    expect(
      await screen.findByText('The Hub at http://hub.test:8787 rejected the request (401)'),
    ).toBeInTheDocument()
    expect(screen.getByText(/EMBERTRAIL_TOKEN/)).toBeInTheDocument()
  })

  it('names the Hub and the Scope on a 403', async () => {
    stubFetch({
      '/config.json': config('http://hub.test:8787'),
      '/api/v1/inventory': () =>
        problem(403, 'urn:embertrail:problem:forbidden', 'needs otel:read'),
    })
    renderGate()

    expect(
      await screen.findByText(
        "The Hub at http://hub.test:8787 refused the Dashboard's Token (403)",
      ),
    ).toBeInTheDocument()
    expect(screen.getByText(/needs otel:read/)).toBeInTheDocument()
  })

  it('tries again from the error', async () => {
    let up = false
    stubFetch({
      '/config.json': config('http://hub.test'),
      '/api/v1/inventory': () =>
        up ? inventory() : problem(401, 'urn:embertrail:problem:unauthorized'),
    })
    renderGate()
    await screen.findByText(/rejected the request/)

    up = true
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('The app')).toBeInTheDocument()
  })
})
