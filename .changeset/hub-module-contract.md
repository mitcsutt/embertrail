---
'@mitcsutt/embertrail-hub': minor
'@mitcsutt/embertrail-server': minor
---

The Hub's core: the Module contract (`defineModule`, `moduleSchema().ownedTable`, `op.*`) with ownership enforced by row-level security, the Db and Edge Identity Ports, `createHub`, and `testHub` on PGLite. The Docker Platform gains its Db Adapter, a `pg` pool.
