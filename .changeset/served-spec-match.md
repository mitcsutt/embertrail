---
'@mitcsutt/embertrail-client': patch
'@mitcsutt/embertrail-hub': patch
'@mitcsutt/embertrail-otel': patch
---

The Query API spec now matches what the Hub serves: fields the Hub always returns are required in the generated types (such as `meta.unit` and the Event keys). The Hub serves `/api/v1/docs` and `/llms.txt`, lists `Embertrail-Owner` on writes, and documents the `events/query` request body.
