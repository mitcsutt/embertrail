import base from '@mitcsutt/kiln-eslint-config/base'
import node from '@mitcsutt/kiln-eslint-config/node'
import react from '@mitcsutt/kiln-eslint-config/react'
import kilnStructure from '@mitcsutt/kiln-structure/eslint'
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
    // Written by the TanStack Router plugin on every dev or build run.
    'apps/dashboard/src/routeTree.gen.ts',
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
    // The CLI bundles its workspace packages into dist/bin.js (packages/cli/scripts/build.ts), so
    // they are devDependencies; only pg is a runtime dependency.
    name: 'embertrail/cli/bundled-dependencies',
    files: ['packages/cli/src/**'],
    rules: {
      'import-x/no-extraneous-dependencies': ['error', { devDependencies: true }],
    },
  },
  {
    // ADR-0004: the Hub's core and its Modules reach a database only through the Db Port, so
    // they import no driver, and test support (pglite, `@mitcsutt/embertrail-hub/testing`)
    // stays out of code that ships. Adapters live in the apps; tests may use both.
    name: 'embertrail/core/no-drivers-or-test-support',
    files: ['packages/{hub,modules,otel,store}/src/**'],
    ignores: [
      '**/*.test.ts',
      'packages/hub/src/testing/**',
      'packages/otel/src/testing.ts',
      'packages/otel/src/query/testing/**',
    ],
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
    name: 'embertrail/dashboard/react',
    files: ['apps/dashboard/**'],
    extends: [react],
  },
  // Kiln's app structure (ADR 0037) for the Dashboard's src/. The feature graph is the one in
  // docs/dashboard.md; a new feature folder must be declared here first.
  ...kilnStructure({
    features: {
      boards: ['widgets', 'filters'],
      widgets: ['filters'],
      sessions: ['filters'],
      filters: [],
    },
    router: 'tanstack',
    srcDir: 'apps/dashboard/src',
    rootDir: import.meta.dirname,
  }),
  {
    // The Dashboard reaches the Hub only through @mitcsutt/embertrail-client, which is generated
    // from spec/query-api.yaml (#27): no other workspace package, no hand-written requests.
    name: 'embertrail/dashboard/client-only',
    files: ['apps/dashboard/src/**'],
    ignores: ['**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@mitcsutt/embertrail-hub',
                '@mitcsutt/embertrail-hub/*',
                '@mitcsutt/embertrail-otel',
                '@mitcsutt/embertrail-otel/*',
                '@mitcsutt/embertrail-store',
                '@mitcsutt/embertrail-store/*',
                '@mitcsutt/embertrail-server',
                '@mitcsutt/embertrail-worker',
              ],
              message: 'The Dashboard reaches the Hub only through @mitcsutt/embertrail-client.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        {
          name: 'fetch',
          message: 'Call the Hub through @mitcsutt/embertrail-client, not fetch.',
        },
        {
          name: 'XMLHttpRequest',
          message: 'Call the Hub through @mitcsutt/embertrail-client, not XMLHttpRequest.',
        },
        {
          name: 'EventSource',
          message: 'Call the Hub through @mitcsutt/embertrail-client.',
        },
        {
          name: 'WebSocket',
          message: 'Call the Hub through @mitcsutt/embertrail-client.',
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
