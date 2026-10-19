import type { components } from './generated/schema.ts'

export {
  createClient,
  type CallOptions,
  type ClientOptions,
  type EmbertrailClient,
  type OperationId,
  type OperationInput,
  type OperationOutput,
} from './client.ts'
export {
  isProblemError,
  ProblemError,
  UnexpectedResponseError,
  type FieldError,
  type Problem,
  type ProblemType,
} from './errors.ts'
export { problemTypes, type Operations } from './generated/operations.ts'
export type { components, operations, paths } from './generated/schema.ts'
export { items, pages, type Page } from './pages.ts'

/** The spec's named schemas, such as `Schemas['SessionSummary']`. */
export type Schemas = components['schemas']
