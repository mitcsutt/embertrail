---
'@mitcsutt/embertrail-otel': minor
'@mitcsutt/embertrail-hub': minor
'@mitcsutt/embertrail-client': patch
---

The otel Query API: `POST /api/v1/metrics/query` and `/events/query` (filters and `group_by` on any attribute, zone-aware buckets, `too-many-rows` over 10,000 rows, Event lists with cursors, `count_distinct` and percentiles), `GET /api/v1/sessions` and `/sessions/{id}` with cost, tokens, Event counts and Session links, `PUT /api/v1/sessions/{id}/labels` with reserved `embertrail.*` Labels that override attributes, and `GET /api/v1/inventory`. Labels are exported with the OTLP JSON Lines. The Hub adds `HubError.tooManyRows`. In the spec, an Event's `account_id` may be `null`, and the Labels endpoint names the `otel` Module.
