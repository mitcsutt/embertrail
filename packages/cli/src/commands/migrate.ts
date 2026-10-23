import type { Command } from '../command.ts'
import { UsageError } from '../errors.ts'
import { table } from '../output.ts'

export const migrate: Command = {
  path: ['migrate'],
  summary: 'Migrate the database: core, then each Module, then the policy sync',
  description:
    "Runs the core migrations, then each Module's, then syncs row-level security, in one transaction against DATABASE_URL. " +
    'Safe to run again. Fails, changing nothing, when the database holds migrations this version does not know. ' +
    'The Docker image runs it on start, and run it before wrangler deploy.',
  options: {
    'database-url': {
      type: 'string',
      value: 'url',
      description: 'The Postgres connection string (default: $DATABASE_URL)',
    },
  },
  async run(ctx, args) {
    const url = args.string('database-url') ?? ctx.io.env.DATABASE_URL
    if (url === undefined || url === '') {
      throw new UsageError('Give the database with --database-url or DATABASE_URL')
    }
    // Loaded here: the Hub, its Modules and the Postgres driver are only for this command.
    const [{ dockerDb }, { migrateDatabase }] = await Promise.all([
      import('@mitcsutt/embertrail-server'),
      import('@mitcsutt/embertrail-modules'),
    ])
    const db = dockerDb({ url, poolSize: 1 })
    try {
      const { applied } = await migrateDatabase(db)
      ctx.print(
        { applied },
        applied.length === 0
          ? 'The database is up to date.'
          : `Applied ${String(applied.length)} migration(s):\n${table(
              ['SCHEMA', 'MIGRATION'],
              applied.map((m) => [m.schema, m.id]),
            )}`,
      )
    } finally {
      await db.close()
    }
  },
}
