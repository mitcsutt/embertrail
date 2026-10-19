import base from '@mitcsutt/kiln-eslint-config/base'
import node from '@mitcsutt/kiln-eslint-config/node'
import { defineConfig, globalIgnores } from 'eslint/config'

// One config for the whole workspace. Each package runs `eslint .` from its
// own directory and picks this file up, so lint stays cached per package.
export default defineConfig(
  base,
  globalIgnores(['**/.wrangler/', '**/worker-configuration.d.ts']),
  {
    name: 'embertrail/workspace/type-aware',
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // Everything except the Dashboard and the Worker runs on Node.
    name: 'embertrail/workspace/node',
    files: ['*.{js,ts}', 'apps/server/**', 'packages/**', '**/*.config.{js,ts}'],
    extends: [node],
  },
)
