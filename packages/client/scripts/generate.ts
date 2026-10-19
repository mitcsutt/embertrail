// Generates the client's types and operation table from spec/query-api.yaml.
// `pnpm generate` writes them; generate.test.ts fails when the committed files
// differ from a fresh run, so the client cannot drift from the spec.

import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import openapiTS, { astToString } from 'openapi-typescript'
import { format, resolveConfig } from 'prettier'
import { parse } from 'yaml'

export const specUrl = new URL('../../../spec/query-api.yaml', import.meta.url)

const schemaUrl = new URL('../src/generated/schema.ts', import.meta.url)
const operationsUrl = new URL('../src/generated/operations.ts', import.meta.url)

const methods = ['get', 'put', 'post', 'delete', 'patch'] as const

const banner = [
  '// Generated from spec/query-api.yaml by scripts/generate.ts. Do not edit:',
  '// change the spec, then run `pnpm --filter @mitcsutt/embertrail-client generate`.',
  '',
].join('\n')

interface Reference {
  $ref: string
}

interface Parameter {
  name: string
  in: 'path' | 'query' | 'header' | 'cookie'
  required?: boolean
}

interface MediaTypes {
  content?: Record<string, unknown>
}

interface Response extends MediaTypes {
  headers?: Record<string, unknown>
}

interface Operation {
  operationId: string
  summary?: string
  parameters?: (Parameter | Reference)[]
  requestBody?: MediaTypes & { required?: boolean }
  responses: Record<string, Response | Reference>
}

interface Spec {
  paths: Record<string, Partial<Record<(typeof methods)[number], Operation>>>
  components: {
    parameters: Record<string, Parameter>
    responses: Record<string, Response>
    schemas: { Problem: { properties: { type: { enum: string[] } } } }
  }
}

/** Generated file contents, keyed by absolute path. */
export async function generate(): Promise<Map<string, string>> {
  const spec = parse(await readFile(specUrl, 'utf8')) as Spec
  const schema =
    banner +
    astToString(await openapiTS(specUrl, { defaultNonNullable: false, emptyObjectsUnknown: true }))
  return new Map([
    [fileURLToPath(schemaUrl), await formatted(schemaUrl, schema)],
    [fileURLToPath(operationsUrl), await formatted(operationsUrl, operationsModule(spec))],
  ])
}

async function formatted(url: URL, source: string): Promise<string> {
  const filepath = fileURLToPath(url)
  const config = await resolveConfig(filepath)
  return format(source, { ...config, filepath })
}

function isReference(value: object): value is Reference {
  return '$ref' in value
}

function resolve<T>(spec: Spec, value: T | Reference): T {
  if (!isReference(value as object)) return value as T
  const [, , section, name] = (value as Reference).$ref.split('/')
  const target = (spec.components as unknown as Record<string, Record<string, T>>)[section ?? '']?.[
    name ?? ''
  ]
  if (target === undefined) throw new Error(`Unresolved $ref ${(value as Reference).$ref}`)
  return target
}

const json = 'application/json'

/**
 * The client covers the Query API, `store` and session labels: operations
 * under `/api/v1` that answer JSON or nothing. OTLP ingest belongs to
 * exporters, and the HTML and Markdown pages to browsers and agents.
 */
function included(spec: Spec, path: string, operation: Operation): boolean {
  if (!path.startsWith('/api/v1/')) return false
  return successes(spec, operation).every(([, response]) => {
    const types = Object.keys(response.content ?? {})
    return types.length === 0 || (types.length === 1 && types[0] === json)
  })
}

function successes(spec: Spec, operation: Operation): [string, Response][] {
  return Object.entries(operation.responses)
    .filter(([status]) => status.startsWith('2'))
    .map(([status, response]) => [status, resolve(spec, response)])
}

function operationsModule(spec: Spec): string {
  const table: string[] = []
  const types: string[] = []

  for (const [path, item] of Object.entries(spec.paths)) {
    for (const method of methods) {
      const operation = item[method]
      if (operation === undefined || !included(spec, path, operation)) continue
      const id = operation.operationId
      const op = `operations['${id}']`
      const parameters = (operation.parameters ?? []).map((parameter) => resolve(spec, parameter))
      const responseHeaders = [
        ...new Set(
          successes(spec, operation).flatMap(([, response]) => Object.keys(response.headers ?? {})),
        ),
      ]

      const input: string[] = []
      let required = false
      for (const location of ['path', 'query', 'header'] as const) {
        const inLocation = parameters.filter((parameter) => parameter.in === location)
        if (inLocation.length === 0) continue
        const locationRequired = inLocation.some((parameter) => parameter.required === true)
        required ||= locationRequired
        input.push(
          `${location}${locationRequired ? '' : '?'}: NonNullable<${op}['parameters']['${location}']>`,
        )
      }
      if (operation.requestBody !== undefined) {
        const bodyRequired = operation.requestBody.required === true
        required ||= bodyRequired
        input.push(
          `body${bodyRequired ? '' : '?'}: NonNullable<${op}['requestBody']>['content']['${json}']`,
        )
      }

      const bodies = [
        ...new Set(
          successes(spec, operation).map(([status, response]) =>
            response.content === undefined
              ? 'undefined'
              : `${op}['responses'][${status}]['content']['${json}']`,
          ),
        ),
      ].join(' | ')
      const output =
        responseHeaders.length === 0
          ? bodies
          : `{ data: ${bodies}; headers: { ${responseHeaders
              .map((name) => `'${name}': string | null`)
              .join('; ')} } }`

      table.push(
        `${id}: { method: '${method.toUpperCase()}', path: '${path}', responseHeaders: [${responseHeaders
          .map((name) => `'${name}'`)
          .join(', ')}] },`,
      )
      types.push(
        [
          '/**',
          ` * ${operation.summary ?? id}`,
          ' *',
          ` * \`${method.toUpperCase()} ${path}\``,
          ' */',
          `${id}: {`,
          // Optional when nothing in it is required, so the method can be called bare.
          `  input${required ? '' : '?'}: ${input.length === 0 ? 'Record<never, never>' : `{ ${input.join('; ')} }`}`,
          `  output: ${output}`,
          '}',
        ].join('\n'),
      )
    }
  }

  const problemTypes = spec.components.schemas.Problem.properties.type.enum
  return [
    banner,
    "import type { operations } from './schema.ts'",
    '',
    '/** Every problem `type` the spec lists. New types may be added within v1. */',
    `export const problemTypes = [${problemTypes.map((type) => `'${type}'`).join(', ')}] as const`,
    '',
    '/** How to call each operation: method, path template and the response headers it returns. */',
    `export const operationTable = {\n${table.join('\n')}\n} as const`,
    '',
    "/** Each operation's input (path, query, header, body) and resolved output. */",
    `export interface Operations {\n${types.join('\n')}\n}`,
    '',
  ].join('\n')
}

if (import.meta.main) {
  for (const [path, contents] of await generate()) {
    await writeFile(path, contents)
    console.log(`wrote ${path}`)
  }
}
