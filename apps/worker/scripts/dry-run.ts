// Bundles the Worker the way `wrangler deploy` would, without an account, and logs its size.
// CI runs it (`pnpm --filter @mitcsutt/embertrail-worker dry-run`) so a config that cannot
// deploy fails before an Owner finds out.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'embertrail-worker-dry-run-'))
try {
  // The Dashboard's dist/ is not built in this job, so the assets come from a stand-in.
  const assets = join(root, 'assets')
  const out = join(root, 'out')
  execFileSync('mkdir', ['-p', assets])
  writeFileSync(join(assets, 'index.html'), '<!doctype html>')
  execFileSync('wrangler', ['deploy', '--dry-run', '--outdir', out, '--assets', assets], {
    stdio: 'inherit',
  })
  for (const name of readdirSync(out).filter((file) => file.endsWith('.js'))) {
    console.log(`${name}: ${(statSync(join(out, name)).size / 1024).toFixed(0)} KiB`)
  }
} finally {
  rmSync(root, { recursive: true, force: true })
}
