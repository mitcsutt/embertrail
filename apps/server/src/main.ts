import { startServer } from './server'

// The Docker image's entry (`node server.js`), after `embertrail migrate` (docker-entrypoint.sh).
try {
  const server = await startServer({ env: process.env })
  const stop = () => {
    server.close().then(
      () => process.exit(0),
      () => process.exit(1),
    )
  }
  process.once('SIGTERM', stop)
  process.once('SIGINT', stop)
} catch (error) {
  console.error('[embertrail] could not start:', error instanceof Error ? error.message : error)
  process.exit(1)
}
