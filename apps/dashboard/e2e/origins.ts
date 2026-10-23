/** The origin e2e/global-setup.ts exported under `name`; a spec run without the setup fails here. */
export function origin(
  name: 'E2E_ORIGIN' | 'E2E_ORIGIN_UNAUTHORIZED' | 'E2E_ORIGIN_UNREACHABLE',
): string {
  const value = process.env[name]
  if (value === undefined) throw new Error(`${name} is not set: run the specs through Playwright`)
  return value
}
