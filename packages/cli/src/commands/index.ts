import type { Command } from '../command.ts'

import { adminCommands } from './admin.ts'
import { bootstrap, login } from './login.ts'
import { migrate } from './migrate.ts'
import { selfCommands } from './self.ts'
import { setupClaudeCode } from './setup.ts'

/** Every command, in the order `embertrail --help` lists them. */
export const commands: readonly Command[] = [
  login,
  bootstrap,
  setupClaudeCode,
  ...selfCommands,
  ...adminCommands,
  migrate,
]
