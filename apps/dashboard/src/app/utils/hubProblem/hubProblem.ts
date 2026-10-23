import { ProblemError, UnexpectedResponseError } from '@mitcsutt/embertrail-client'

export interface HubProblem {
  title: string
  /** What happened and what to do, always naming the address. */
  body: string
}

const gateway = new Set([502, 503, 504])

/** The message for a failed first call to the Hub (#72 A3), naming `display`, the address in use. */
export function describeHubProblem(
  error: unknown,
  display: string,
  sameOrigin: boolean,
): HubProblem {
  const status =
    error instanceof ProblemError || error instanceof UnexpectedResponseError
      ? error.status
      : undefined
  const detail = error instanceof ProblemError ? error.detail : undefined

  if (status === undefined || gateway.has(status)) {
    return {
      title: `Can't reach the Hub at ${display}`,
      body: sameOrigin
        ? `The Dashboard sends /api requests to ${display}, which should forward them to the Hub. Start the Hub, and check that the proxy points at it (EMBERTRAIL_HUB under pnpm dev, the hub service under Docker).`
        : `Check that the Hub is running and reachable from this browser. The Hub allows no cross-origin requests: serve the Dashboard from the Hub's own origin, or set hubUrl in config.json to "".`,
    }
  }
  if (status === 401) {
    return {
      title: `The Hub at ${display} rejected the request (401)`,
      body: 'The Dashboard has no valid Token. Under pnpm dev, run `embertrail login` or set EMBERTRAIL_TOKEN; under Docker, set EMBERTRAIL_DASHBOARD_TOKEN. If the Hub sits behind an access proxy, add its header to "headers" in config.json.',
    }
  }
  if (status === 403) {
    return {
      title: `The Hub at ${display} refused the Dashboard's Token (403)`,
      body: `The Token needs the otel:read, store:read and store:write Scopes${detail === undefined ? '' : ` (${detail})`}, and must not be bound to one Source.`,
    }
  }
  return {
    title: `The Hub at ${display} answered with an error (${String(status)})`,
    body: detail ?? (error instanceof Error ? error.message : 'No further detail.'),
  }
}
