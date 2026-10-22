import type { OpenApiDocument } from './openapi'

type Json = Record<string, unknown>

const methods = ['get', 'put', 'post', 'delete', 'patch']

interface Endpoint {
  method: string
  path: string
  summary: string
  scope: string | undefined
}

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function endpoints(document: OpenApiDocument): Endpoint[] {
  const found: Endpoint[] = []
  for (const [path, item] of Object.entries(document.paths)) {
    for (const method of methods) {
      const operation: unknown = item[method]
      if (!isRecord(operation)) continue
      const scope = operation['x-embertrail-scope']
      found.push({
        method: method.toUpperCase(),
        path,
        summary: typeof operation.summary === 'string' ? operation.summary : '',
        scope: typeof scope === 'string' ? scope : undefined,
      })
    }
  }
  return found.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method))
}

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (c) => `&#${String(c.charCodeAt(0))};`)
}

/** `/llms.txt`: a plain-text pointer to the API for AI agents, in the llms.txt convention. */
export function llmsTxt(document: OpenApiDocument, origin: string): string {
  const lines = [
    `# ${document.info.title}`,
    '',
    '> A Hub that stores telemetry from coding agents and serves it back over a JSON HTTP API. Every `/api/v1` error is RFC 9457 `application/problem+json`; send a Token as `Authorization: Bearer et_<id>_<secret>`.',
    '',
    '## Reference',
    '',
    `- [OpenAPI document](${origin}/api/v1/openapi.json): every endpoint with its Scope, parameters and schemas`,
    `- [API reference](${origin}/api/v1/docs): the same endpoints as a web page`,
    '',
    '## Endpoints',
    '',
    ...endpoints(document).map(
      (e) =>
        `- \`${e.method} ${e.path}\`${e.summary === '' ? '' : `: ${e.summary}`}${e.scope === undefined ? '' : ` (Scope \`${e.scope}\`)`}`,
    ),
  ]
  return `${lines.join('\n')}\n`
}

/** `/api/v1/docs`: the served document's endpoints as one self-contained page. */
export function docsPage(document: OpenApiDocument): string {
  const rows = endpoints(document).map(
    (e) =>
      `<tr><td>${e.method}</td><td><code>${escapeHtml(e.path)}</code></td><td>${escapeHtml(e.scope ?? 'public')}</td><td>${escapeHtml(e.summary)}</td></tr>`,
  )
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(document.info.title)}</title>
<style>
body { font: 16px/1.5 system-ui, sans-serif; margin: 2rem auto; max-width: 60rem; padding: 0 1rem; color-scheme: light dark; }
table { border-collapse: collapse; width: 100%; }
th, td { border-bottom: 1px solid #8884; padding: 0.4rem 0.6rem; text-align: left; vertical-align: top; }
</style>
</head>
<body>
<h1>${escapeHtml(document.info.title)}</h1>
<p>Every endpoint of this Hub. The full schemas are in <a href="/api/v1/openapi.json">openapi.json</a>.</p>
<table>
<thead><tr><th>Method</th><th>Path</th><th>Scope</th><th>Summary</th></tr></thead>
<tbody>
${rows.join('\n')}
</tbody>
</table>
</body>
</html>
`
}
