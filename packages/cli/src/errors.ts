import { isProblemError, UnexpectedResponseError } from '@mitcsutt/embertrail-client'

import { printable } from './output.ts'

/** A failure with a message meant for the person running the command. Exit code 1. */
export class CliError extends Error {
  override readonly name = 'CliError'
}

/** The command line is wrong: an unknown command or option, or a missing argument. Exit code 2. */
export class UsageError extends Error {
  override readonly name = 'UsageError'
}

/**
 * What to print for a failure: a problem's `title`, `detail` and `request_id` (and its field
 * errors), a boot failure's message, or any other error's message.
 */
export function describeError(error: unknown): string {
  if (isProblemError(error)) {
    const lines = [`error: ${printable(error.title)} (${String(error.status)})`]
    if (error.detail !== undefined) lines.push(`  ${printable(error.detail)}`)
    for (const field of error.errors)
      lines.push(`  ${printable(field.pointer)}: ${printable(field.message)}`)
    lines.push(`  request_id: ${error.request_id}`)
    return lines.join('\n')
  }
  if (error instanceof UnexpectedResponseError) {
    return `error: ${error.message}\n  status: ${String(error.status)}`
  }
  if (error instanceof Error && error.name === 'HubBootError') {
    const hint = error.message.includes('migrations ahead')
      ? '\n  The database is newer than this embertrail; upgrade it before migrating.'
      : ''
    return `error: ${error.message}${hint}`
  }
  return `error: ${error instanceof Error ? error.message : String(error)}`
}
