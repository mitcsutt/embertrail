import { startStack } from './stack.ts'

/** Boots the stack once for the run and hands the origins to the specs through the environment. */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const stack = await startStack()
  process.env.E2E_ORIGIN = stack.origins.working
  process.env.E2E_ORIGIN_UNAUTHORIZED = stack.origins.unauthorized
  process.env.E2E_ORIGIN_UNREACHABLE = stack.origins.unreachable
  return () => stack.close()
}
