---
'@mitcsutt/embertrail-hub': minor
---

Core identity: Users, Teams, Sources, Tokens (`et_<id>_<secret>`, SHA-256 hashed, shown once), Accounts recognised from telemetry, and Grants, enforced by row-level security. Callers resolve from the `core` tables in #26's order, `Embertrail-Owner: team:<id>` lets a Team's editor act for it, and `BOOTSTRAP_TOKEN` creates the first User and an admin Token once. `hub.directory` manages the records; `testHub().as()` issues real Tokens.
