import { isProblemError, UnexpectedResponseError } from '@mitcsutt/embertrail-client'

/** What a Widget's error state says: the Hub's own `detail` when it sent one. */
export function describeError(error: unknown): string {
  if (isProblemError(error)) return error.detail ?? error.title
  if (error instanceof UnexpectedResponseError) {
    return `The Hub answered ${String(error.status)} without a reason.`
  }
  if (error instanceof TypeError) return "The Hub couldn't be reached."
  return error instanceof Error ? error.message : 'Something went wrong.'
}
