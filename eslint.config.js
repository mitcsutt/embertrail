import base from '@mitcsutt/kiln-eslint-config/base'
import node from '@mitcsutt/kiln-eslint-config/node'
import { defineConfig, globalIgnores } from 'eslint/config'

// One config for the whole workspace. Each package runs `eslint .` from its
// own directory and picks this file up, so lint stays cached per package.
export default defineConfig(
  base,
  globalIgnores([
    '**/.wrangler/',
    '**/worker-configuration.d.ts',
    // Generated from spec/query-api.yaml; typecheck and the drift test cover them.
    'packages/client/src/generated/',
  ]),
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
  {
    // ADR-0004: the Hub's core and its Modules reach a database only through the Db Port, so
    // they import no driver, and test support (pglite, `@mitcsutt/embertrail-hub/testing`)
    // stays out of code that ships. Adapters live in the apps; tests may use both.
    name: 'embertrail/core/no-drivers-or-test-support',
    files: ['packages/{hub,otel,store}/src/**'],
    ignores: ['**/*.test.ts', 'packages/hub/src/testing/**', 'packages/otel/src/testing.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'pg',
                'drizzle-orm/node-postgres',
                '@electric-sql/pglite',
                'drizzle-orm/pglite',
              ],
              message: 'The core and Modules use the Db Port, not a driver (ADR-0004).',
            },
            {
              group: ['@mitcsutt/embertrail-hub/testing'],
              message: 'Test support must not be imported by code that ships.',
            },
          ],
        },
      ],
    },
  },
  {
    // The database tests read DATABASE_URL through one helper so they skip locally and fail in
    // CI the same way (docs/development.md).
    name: 'embertrail/server/database-url',
    files: ['apps/server/src/**/*.test.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.property.name='env'][property.name='DATABASE_URL']",
          message: "Import databaseUrl and skipWithoutPostgres from './testing/postgres'.",
        },
      ],
    },
  },
)
