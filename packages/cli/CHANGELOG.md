# @mitcsutt/embertrail-cli

## 0.1.0

### Minor Changes

- 64024a2: The `embertrail` CLI (#31): `login` and `bootstrap` store the Hub and a management Token (mode 600); `setup claude-code --source <name>` creates the Source and its ingest Token and writes Claude Code's telemetry `env` into the user settings, keeping every other key and never enabling traces; `sources`, `tokens`, `accounts`, `grants` and `export` manage your own records; `admin users|teams|sources` manage the Hub; `migrate` runs core then Module migrations and the policy sync against `DATABASE_URL`. Problems print their `title`, `detail` and `request_id`.
