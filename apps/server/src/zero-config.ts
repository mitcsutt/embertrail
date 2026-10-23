import type { Hub } from '@mitcsutt/embertrail-hub'

/**
 * The Docker Platform's zero-config solo start (#37): when no `BOOTSTRAP_TOKEN` is set and the Hub
 * has never been bootstrapped, create the one admin User and print their management Token once.
 * `createFirstUser` is the one-time path `POST /api/v1/bootstrap` uses, so a restart (or a second
 * Hub on the same database) finds the first User and prints nothing.
 *
 * Returns whether it created the User.
 */
export async function zeroConfigStart(
  hub: Hub,
  options: { bootstrapToken: string | undefined; hubUrl: string; log: (line: string) => void },
): Promise<boolean> {
  if (options.bootstrapToken !== undefined) return false
  const first = await hub.directory.createFirstUser()
  if (first === null) return false
  const rule = '='.repeat(72)
  for (const line of [
    rule,
    'Embertrail created your admin User and a management Token.',
    'It is shown once. Save it now; this log is the only place it appears.',
    '',
    `  ${first.token}`,
    '',
    'Connect this machine and Claude Code:',
    `  embertrail login --hub ${options.hubUrl} --token ${first.token}`,
    '  embertrail setup claude-code --source laptop',
    rule,
  ]) {
    options.log(line)
  }
  return true
}
