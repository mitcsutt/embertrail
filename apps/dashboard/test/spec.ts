// Validates a Widget's request against `spec/query-api.yaml` itself, so a request that passes is
// one the documented Query API accepts, and a hand-written shape can't drift from it (#42).
// The Hub's own `assertSpecResponse` checks responses; this checks requests.

import { readFileSync } from 'node:fs'

import { Ajv2020 } from 'ajv/dist/2020.js'
import { parse } from 'yaml'

import type { WidgetRequest } from '#features/widgets/types/widget'

const spec = parse(
  readFileSync(new URL('../../../spec/query-api.yaml', import.meta.url), 'utf8'),
) as Spec

interface Spec {
  paths: Record<string, Record<string, { parameters?: Parameter[] }>>
  components: { parameters: Record<string, Parameter> }
}
interface Parameter {
  $ref?: string
  name?: string
  in?: string
  required?: boolean
  schema?: object
}

const ajv = new Ajv2020({ strict: false, validateSchema: false, allErrors: true })
ajv.addFormat('date-time', (value: string) =>
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(value),
)
ajv.addFormat('uri', (value: string) => /^[a-z][a-z0-9+.-]*:/i.test(value))
ajv.addSchema(spec, 'spec')

const pointer = (path: string) => path.replaceAll('~', '~0').replaceAll('/', '~1')

/** Fails unless `body` matches the request body schema of a POST operation. */
function assertBody(path: string, body: unknown): void {
  const ref = `spec#/paths/${pointer(path)}/post/requestBody/content/application~1json/schema`
  const validate = ajv.compile({ $ref: ref })
  if (!validate(body)) {
    throw new Error(`POST ${path} body does not match the spec: ${ajv.errorsText(validate.errors)}`)
  }
}

/** Fails unless `query` only uses the GET operation's query parameters, with valid values. */
function assertQuery(path: string, query: Record<string, unknown>): void {
  const parameters = (spec.paths[path]?.get?.parameters ?? []).map((parameter) =>
    parameter.$ref === undefined
      ? parameter
      : (spec.components.parameters[parameter.$ref.split('/').pop() ?? ''] ?? parameter),
  )
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: parameters.filter((p) => p.required === true).flatMap((p) => p.name ?? []),
    properties: Object.fromEntries(
      parameters.flatMap((p) =>
        p.in === 'query' && p.name !== undefined ? [[p.name, p.schema]] : [],
      ),
    ),
  }
  // The parameters' own refs (`#/components/...`) point into the spec, not into this schema.
  const validate = ajv.compile(JSON.parse(JSON.stringify(schema).replaceAll('"#/', '"spec#/')))
  const defined = Object.fromEntries(Object.entries(query).filter(([, v]) => v !== undefined))
  if (!validate(defined)) {
    throw new Error(`GET ${path} query does not match the spec: ${ajv.errorsText(validate.errors)}`)
  }
}

/** Throws, saying what is wrong, unless the Query API's spec accepts this request. */
export function assertSpecRequest(request: WidgetRequest): void {
  switch (request.op) {
    case 'queryMetrics':
      assertBody('/api/v1/metrics/query', request.body)
      break
    case 'queryMetricsEach':
      for (const body of request.bodies) assertBody('/api/v1/metrics/query', body)
      break
    case 'queryEvents':
      assertBody('/api/v1/events/query', request.body)
      break
    case 'listSessions':
      assertQuery('/api/v1/sessions', request.query ?? {})
      break
  }
}
