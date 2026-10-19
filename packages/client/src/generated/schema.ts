// Generated from spec/query-api.yaml by scripts/generate.ts. Do not edit:
// change the spec, then run `pnpm --filter @mitcsutt/embertrail-client generate`.
export interface paths {
  '/api/v1/metrics/query': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    /**
     * Aggregate one Metric, optionally grouped and bucketed
     * @description Aggregates the data points of one Metric over a time range. Sums are
     *     stored as delta increments (ADR-0003), so `sum` over a range is the
     *     total for that range. Without `bucket`, each group yields one row.
     */
    post: operations['queryMetrics']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/v1/events/query': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    /**
     * List Events, or aggregate them
     * @description `mode: list` returns Events one by one, newest first by default, with
     *     cursor pagination. `mode: aggregate` counts Events or aggregates a
     *     numeric attribute (such as `duration_ms` or `cost_usd`), grouped and
     *     bucketed like `/metrics/query`.
     */
    post: operations['queryEvents']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/v1/sessions': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /**
     * List Sessions
     * @description Sessions with at least one Signal in the time range, plus Sessions that
     *     only have labels when no range is given. Group and tree views are built
     *     from `group_id` and `parent_session_id`; totals per group come from
     *     `/metrics/query` grouped by `embertrail.group.id`.
     */
    get: operations['listSessions']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/v1/sessions/{session_id}': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Get one Session with its direct children */
    get: operations['getSession']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/v1/sessions/{session_id}/labels': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    /**
     * Replace a Session's labels
     * @description Replaces the full label set (an empty object clears it). Labels may be
     *     written before the Session's first Signal arrives, since exporters
     *     often flush only on exit, so an unknown `session_id` is accepted, not
     *     404. Labels belong to the caller's Owner.
     *
     *     The reserved keys `embertrail.group.id`, `embertrail.group.kind`,
     *     `embertrail.parent.session_id` and `embertrail.role` link a Session
     *     after the fact. Where a reserved label and the same resource attribute
     *     disagree, the label wins, in this Session's summary and in every
     *     query that filters or groups on that dimension.
     *
     *     Accepted from Source-bound ingest Tokens, so a Source plugin on the
     *     User's machine can label the Session it runs in.
     */
    put: operations['putSessionLabels']
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/v1/inventory': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /**
     * List what exists in the visible data
     * @description Owners, Sources, Accounts, services, models, Metric and Event names,
     *     and attribute keys seen in the caller's visible data. Clients use it
     *     to fill filter pickers and to label ids. Without a range it covers all
     *     stored data.
     */
    get: operations['getInventory']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/v1/sql': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    /**
     * Run one read-only SQL statement
     * @description Runs a single `SELECT` as the read-only database role, with the
     *     caller's row-level security applied: it sees exactly the rows the
     *     caller could read through the other endpoints. 10 s statement
     *     timeout; at most 10,000 rows are returned, and `truncated` says
     *     whether more existed. Tables are those of every Module, under the
     *     Module's schema (`otel.otel_logs`, `store.documents`, …); their
     *     columns are documented per Module, not here, and may grow additively.
     */
    post: operations['runSql']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/v1/store/{namespace}': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /**
     * List documents in a namespace
     * @description Every document in the namespace the caller can read, most recently updated first.
     */
    get: operations['listStoreDocuments']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/v1/store/{namespace}/{id}': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Get one document */
    get: operations['getStoreDocument']
    /**
     * Create or replace a document
     * @description Creates the document if `id` is free in this namespace, otherwise
     *     replaces its `data`. The client chooses `id`. Send `If-Match` with the
     *     last seen `ETag` to replace only an unchanged document, or
     *     `If-None-Match: *` to create only. A new document belongs to the
     *     caller, or to the Team named in `Embertrail-Owner`; an existing
     *     document keeps its Owner.
     */
    put: operations['putStoreDocument']
    post?: never
    /**
     * Delete a document
     * @description Hard delete. `If-Match` is honoured as on `PUT`.
     */
    delete: operations['deleteStoreDocument']
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/v1/logs': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    /**
     * Ingest Events (OTLP logs)
     * @description OTLP/HTTP with a JSON-encoded `ExportLogsServiceRequest`. Each log
     *     record becomes one Event. The Token must be bound to one Source; the
     *     Hub stamps Owner and Source, and ignores any sent in attributes.
     *     The body is parsed by the Module (`op.raw`), so `intValue` is accepted
     *     as a JSON number or string, and records missing `session.id` or
     *     `event.sequence` are de-duplicated on a content hash. A duplicate of
     *     a stored record is skipped and not counted as rejected. The response
     *     is sent only after the batch is stored, so retries are safe.
     */
    post: operations['ingestLogs']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/v1/metrics': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    /**
     * Ingest Metrics (OTLP metrics)
     * @description OTLP/HTTP with a JSON-encoded `ExportMetricsServiceRequest`. Delta sums
     *     and gauges are stored. Cumulative sums, histograms and summaries are
     *     rejected through `partialSuccess`, with a message that names the
     *     metric and, for cumulative sums, tells the sender to set delta
     *     temporality (`OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=delta`).
     *     Ownership, de-duplication and retry behaviour are as for `/v1/logs`.
     */
    post: operations['ingestMetrics']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/v1/traces': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    /**
     * Refuse traces politely (out of v1)
     * @description Traces are not stored in v1. A well-formed request gets 200 with a
     *     `partialSuccess` that rejects every span and says why, so exporters
     *     don't retry. Nothing is stored.
     */
    post: operations['ingestTraces']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/v1/openapi.json': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** This document, as assembled from the running Hub's Modules */
    get: operations['getOpenApi']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/v1/docs': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Human-readable API reference rendered from `openapi.json` */
    get: operations['getDocs']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/llms.txt': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /**
     * Plain-text pointer to the API for AI agents
     * @description Follows the llms.txt convention; links `openapi.json` and the ingest reference.
     */
    get: operations['getLlmsTxt']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
}
export type webhooks = Record<string, never>
export interface components {
  schemas: {
    /**
     * Format: date-time
     * @description RFC 3339 with an offset or `Z`.
     */
    Timestamp: string
    /**
     * @description IANA time zone name, such as `UTC` or `Europe/Berlin`. An unknown zone is `invalid` (422).
     * @example UTC
     */
    Tz: string
    /** @description Opaque Hub id. */
    Id: string
    Slug: string
    /** @description Pass back as `cursor` for the next page; `null` on the last page. */
    NextCursor: string | null
    /** @description An attribute key as the sender spelled it. */
    AttributeKey: string
    /**
     * @description A key to filter or group on. These are promoted to columns:
     *
     *     | Key | Signals | Meaning |
     *     | --- | --- | --- |
     *     | `embertrail.owner_id` | all | Owner of the row |
     *     | `embertrail.source_id` | all | Source that sent it |
     *     | `embertrail.account_id` | all | Account recognised from the telemetry |
     *     | `service.name` | all | Sender, such as `claude-code` |
     *     | `session.id` | all | Session |
     *     | `embertrail.group.id`, `embertrail.group.kind`, `embertrail.parent.session_id`, `embertrail.role` | all | Session links (ADR-0014); a Session's reserved labels override them |
     *     | `model` | all | Model |
     *     | `type` | Metrics | Point type, such as `input` or `cacheRead` for token usage |
     *     | `unit` | Metrics | Metric unit |
     *     | `event.name` | Events | Event name, unprefixed (`api_request`) |
     *     | `event.sequence` | Events | Sender's sequence number |
     *     | `prompt.id` | Events | Prompt |
     *     | `request_id` | Events | Request |
     *
     *     Any other key is read from the data point's or log record's
     *     attributes, falling back to resource attributes.
     */
    Dimension: components['schemas']['AttributeKey']
    ScalarValue: string | number | boolean
    /** @description One condition. A query's filters are combined with AND. */
    Filter:
      | {
          key: components['schemas']['Dimension']
          /** @enum {string} */
          op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'
          value: components['schemas']['ScalarValue']
        }
      | {
          key: components['schemas']['Dimension']
          /** @enum {string} */
          op: 'in' | 'not_in'
          value: components['schemas']['ScalarValue'][]
        }
      | {
          key: components['schemas']['Dimension']
          /** @enum {string} */
          op: 'exists' | 'not_exists'
        }
    /**
     * @description Calendar bucket in the query's `tz`.
     * @enum {string}
     */
    Bucket: 'minute' | 'hour' | 'day' | 'week' | 'month'
    GroupBy: components['schemas']['Dimension'][]
    /** @description Default is `bucket` ascending, then group values. */
    AggregateOrder: {
      /** @enum {string} */
      by?: 'bucket' | 'value'
      /**
       * @default asc
       * @enum {string}
       */
      direction?: 'asc' | 'desc'
    }
    QueryWindow: {
      from: components['schemas']['Timestamp']
      to: components['schemas']['Timestamp']
      tz: components['schemas']['Tz']
      filter?: components['schemas']['Filter'][]
    }
    MetricsQuery: {
      /** @description Metric name, such as `claude_code.token.usage`. */
      metric: string
      /**
       * @description Applied to data point values per row. `sum` suits delta sums;
       *     `avg`, `min`, `max` and `last` suit gauges; `count` counts points.
       * @enum {string}
       */
      aggregation: 'sum' | 'avg' | 'min' | 'max' | 'count' | 'last'
      bucket?: components['schemas']['Bucket']
      group_by?: components['schemas']['GroupBy']
      order?: components['schemas']['AggregateOrder']
      /** @description Return only the first rows in `order`, for top-N queries. */
      limit?: number
    } & components['schemas']['QueryWindow']
    AggregateResult: {
      rows: components['schemas']['AggregateRow'][]
      meta: {
        tz: components['schemas']['Tz']
        bucket?: components['schemas']['Bucket']
        /** @description The Metric's unit, or `null` for Event counts and mixed units. */
        unit?: string | null
      }
    }
    AggregateRow: {
      /** @description Bucket start, present when the query had `bucket`. */
      bucket?: components['schemas']['Timestamp']
      /** @description One entry per `group_by` key; `null` where the row lacks the attribute. */
      group: {
        [key: string]: string | number | boolean | null
      }
      value: number | null
    }
    EventsQuery:
      components['schemas']['EventsListQuery'] | components['schemas']['EventsAggregateQuery']
    EventsListQuery: {
      /** @constant */
      mode: 'list'
      /**
       * @description By time, then `event.sequence`.
       * @default desc
       * @enum {string}
       */
      order?: 'desc' | 'asc'
      cursor?: string
      /** @default 100 */
      limit?: number
    } & (components['schemas']['QueryWindow'] & {
      /**
       * @description discriminator enum property added by openapi-typescript
       * @enum {string}
       */
      mode: 'list'
    })
    EventsAggregateQuery: {
      /** @constant */
      mode: 'aggregate'
      aggregation: {
        /** @enum {string} */
        fn:
          'count' | 'count_distinct' | 'sum' | 'avg' | 'min' | 'max' | 'p50' | 'p90' | 'p95' | 'p99'
        /** @description Required for every `fn` except `count`. Numeric for all but `count_distinct`; non-numeric values are ignored. */
        key?: components['schemas']['Dimension']
      }
      bucket?: components['schemas']['Bucket']
      group_by?: components['schemas']['GroupBy']
      order?: components['schemas']['AggregateOrder']
      limit?: number
    } & (components['schemas']['QueryWindow'] & {
      /**
       * @description discriminator enum property added by openapi-typescript
       * @enum {string}
       */
      mode: 'aggregate'
    })
    EventList: {
      items: components['schemas']['Event'][]
      next_cursor: components['schemas']['NextCursor']
    }
    Event: {
      time: components['schemas']['Timestamp']
      /** @description Unprefixed (`api_request`). */
      event_name: string
      sequence?: number | null
      session_id?: string | null
      prompt_id?: string | null
      request_id?: string | null
      model?: string | null
      service_name: string
      owner_id: components['schemas']['Id']
      source_id: components['schemas']['Id']
      account_id: components['schemas']['Id']
      /** @description The log record body as sent, when it was a string. */
      body?: string | null
      /** @description Log record attributes as sent, with OTLP values unwrapped to plain JSON. */
      attributes: Record<string, unknown>
      /** @description Resource attributes as sent, unwrapped. */
      resource: Record<string, unknown>
    }
    Labels: {
      [key: string]: string
    }
    SessionSummary: {
      id: string
      /** @description `null` for a Session known only from labels. */
      service_name: string | null
      owner_id: components['schemas']['Id']
      source_id: string | null
      account_id: string | null
      /**
       * Format: date-time
       * @description First Signal.
       */
      started_at: string | null
      /**
       * Format: date-time
       * @description Latest Signal.
       */
      last_seen_at: string | null
      models: string[]
      /** @description Sum of `claude_code.cost.usage`; `null` when the sender sends no cost. */
      cost_usd: number | null
      /** @description Sum of `claude_code.token.usage` per `type` (`input`, `output`, `cacheRead`, `cacheCreation`, …); empty when absent. */
      tokens: {
        [key: string]: number
      }
      /** @description Number of Events per unprefixed `event.name`. */
      event_counts: {
        [key: string]: number
      }
      group: {
        id: string
        kind?: string | null
      } | null
      parent_session_id: string | null
      role: string | null
      labels: components['schemas']['Labels']
    }
    SessionDetail: {
      /** @description Direct children (Sessions whose parent is this one), oldest first. Deeper levels come from fetching each child. */
      children: components['schemas']['SessionSummary'][]
    } & components['schemas']['SessionSummary']
    Inventory: {
      /** @description The caller, and every Owner whose data a Grant lets them read. */
      owners: {
        id: components['schemas']['Id']
        /** @enum {string} */
        kind: 'user' | 'team'
        name: string
      }[]
      sources: {
        id: components['schemas']['Id']
        name: string
        owner_id: components['schemas']['Id']
      }[]
      accounts: {
        id: components['schemas']['Id']
        /** @description The User's label, or a suggestion from the email domain, or `Unknown`. */
        label: string
        owner_id: components['schemas']['Id']
        organization_id?: string | null
        account_uuid?: string | null
        email?: string | null
      }[]
      services: string[]
      models: string[]
      metrics: {
        name: string
        /** @enum {string} */
        kind: 'sum' | 'gauge'
        unit: string | null
        service_name?: string
      }[]
      events: {
        /** @description Unprefixed. */
        name: string
        service_name?: string
      }[]
      /** @description Attribute keys seen, for building `group_by` and filter pickers. Capped at 1,000, most frequent first. */
      attributes: {
        /** @enum {string} */
        signal: 'metric' | 'event'
        key: components['schemas']['AttributeKey']
        promoted: boolean
      }[]
    }
    SqlRequest: {
      /** @description One statement; read-only. Use `$1`, `$2`… for parameters. */
      sql: string
      params?: (string | number | boolean | null)[]
    }
    SqlResult: {
      columns: {
        name: string
        /** @description Postgres type name, such as `timestamptz` or `jsonb`. */
        type: string
      }[]
      /** @description Rows as arrays in column order. `timestamptz` as RFC 3339, `numeric` and `int8` as strings, `jsonb` as JSON. */
      rows: unknown[][]
      truncated: boolean
    }
    /** @description Any JSON value. At most 1 MiB once serialised (`payload-too-large`). */
    StoreData: unknown
    StoreDocument: {
      namespace: components['schemas']['Slug']
      id: components['schemas']['Slug']
      owner: {
        /** @enum {string} */
        kind: 'user' | 'team'
        id: components['schemas']['Id']
      }
      /** @description Increments on every replace. */
      version: number
      created_at: components['schemas']['Timestamp']
      updated_at: components['schemas']['Timestamp']
      data: components['schemas']['StoreData']
    }
    /** @description RFC 9457 problem details. */
    Problem: {
      /**
       * Format: uri
       * @description Stable; new types may be added within v1.
       * @enum {string}
       */
      type:
        | 'urn:embertrail:problem:validation'
        | 'urn:embertrail:problem:invalid-cursor'
        | 'urn:embertrail:problem:unauthenticated'
        | 'urn:embertrail:problem:forbidden'
        | 'urn:embertrail:problem:identity-conflict'
        | 'urn:embertrail:problem:not-found'
        | 'urn:embertrail:problem:conflict'
        | 'urn:embertrail:problem:precondition-failed'
        | 'urn:embertrail:problem:payload-too-large'
        | 'urn:embertrail:problem:invalid'
        | 'urn:embertrail:problem:too-many-rows'
        | 'urn:embertrail:problem:query-timeout'
        | 'urn:embertrail:problem:sql-error'
        | 'urn:embertrail:problem:internal'
      title: string
      status: number
      detail?: string
      instance?: string
      request_id: string
      /** @description Module that raised the error, on `internal`. */
      module?: string
      /** @description Field errors, on `validation`. */
      errors?: {
        /** @description JSON Pointer into the request. */
        pointer: string
        message: string
      }[]
      /** @description Postgres SQLSTATE, on `sql-error`. */
      sqlstate?: string
    }
    /** @description `ExportLogsServiceRequest` in OTLP/JSON. See opentelemetry-proto `logs/v1`. */
    OtlpExportLogsRequest: {
      resourceLogs?: Record<string, unknown>[]
    }
    /** @description `ExportMetricsServiceRequest` in OTLP/JSON. See opentelemetry-proto `metrics/v1`. */
    OtlpExportMetricsRequest: {
      resourceMetrics?: Record<string, unknown>[]
    }
    /** @description `ExportTraceServiceRequest` in OTLP/JSON. */
    OtlpExportTraceRequest: {
      resourceSpans?: Record<string, unknown>[]
    }
    /** @description int64 encoded as a decimal string, per the proto3 JSON mapping. */
    OtlpInt64: string
    OtlpExportLogsResponse: {
      partialSuccess?: {
        rejectedLogRecords?: components['schemas']['OtlpInt64']
        errorMessage?: string
      }
    }
    OtlpExportMetricsResponse: {
      partialSuccess?: {
        rejectedDataPoints?: components['schemas']['OtlpInt64']
        errorMessage?: string
      }
    }
    OtlpExportTraceResponse: {
      partialSuccess: {
        rejectedSpans: components['schemas']['OtlpInt64']
        errorMessage: string
      }
    }
    /** @description `google.rpc.Status` in JSON, as OTLP/HTTP requires for 4xx and 5xx. */
    RpcStatus: {
      code?: number
      message?: string
      details?: Record<string, unknown>[]
    }
  }
  responses: {
    /** @description The request failed schema validation (`validation`), or a cursor was invalid (`invalid-cursor`). */
    BadRequest: {
      headers: {
        [name: string]: unknown
      }
      content: {
        /**
         * @example {
         *       "type": "urn:embertrail:problem:validation",
         *       "title": "Request failed validation",
         *       "status": 400,
         *       "detail": "group_by takes at most 3 dimensions",
         *       "request_id": "01J9Z6Q4X1",
         *       "errors": [
         *         {
         *           "pointer": "/group_by",
         *           "message": "must NOT have more than 3 items"
         *         }
         *       ]
         *     }
         */
        'application/problem+json': components['schemas']['Problem']
      }
    }
    /** @description No valid Token or Edge Identity (`unauthenticated`). */
    Unauthorized: {
      headers: {
        [name: string]: unknown
      }
      content: {
        'application/problem+json': components['schemas']['Problem']
      }
    }
    /** @description Missing Scope (`forbidden`), or a Token and an Edge Identity naming different Users (`identity-conflict`). */
    Forbidden: {
      headers: {
        [name: string]: unknown
      }
      content: {
        'application/problem+json': components['schemas']['Problem']
      }
    }
    /** @description No such resource, or one the caller may not read (`not-found`). */
    NotFound: {
      headers: {
        [name: string]: unknown
      }
      content: {
        'application/problem+json': components['schemas']['Problem']
      }
    }
    /** @description The id is held by a document the caller cannot see (`conflict`). */
    Conflict: {
      headers: {
        [name: string]: unknown
      }
      content: {
        'application/problem+json': components['schemas']['Problem']
      }
    }
    /** @description `If-Match` or `If-None-Match` did not hold (`precondition-failed`). */
    PreconditionFailed: {
      headers: {
        [name: string]: unknown
      }
      content: {
        'application/problem+json': components['schemas']['Problem']
      }
    }
    /** @description Body over the endpoint's limit (`payload-too-large`). */
    PayloadTooLarge: {
      headers: {
        [name: string]: unknown
      }
      content: {
        'application/problem+json': components['schemas']['Problem']
      }
    }
    /**
     * @description Valid shape, but the query can't run: `too-many-rows` (over 10,000
     *     aggregate rows), `query-timeout` (over 10 s), `sql-error` (rejected by
     *     the database; `sqlstate` set), or `invalid` (any other semantic error,
     *     such as an unknown time zone).
     */
    Unprocessable: {
      headers: {
        [name: string]: unknown
      }
      content: {
        'application/problem+json': components['schemas']['Problem']
      }
    }
    /** @description Unexpected failure (`internal`). Quote `request_id` when reporting it. */
    Internal: {
      headers: {
        [name: string]: unknown
      }
      content: {
        'application/problem+json': components['schemas']['Problem']
      }
    }
    /** @description Body is not valid OTLP JSON. Not retryable. */
    OtlpBadRequest: {
      headers: {
        [name: string]: unknown
      }
      content: {
        'application/json': components['schemas']['RpcStatus']
      }
    }
    /** @description Missing or invalid Token. */
    OtlpUnauthorized: {
      headers: {
        [name: string]: unknown
      }
      content: {
        'application/json': components['schemas']['RpcStatus']
      }
    }
    /** @description Token lacks `otel:write` or is not bound to a Source. */
    OtlpForbidden: {
      headers: {
        [name: string]: unknown
      }
      content: {
        'application/json': components['schemas']['RpcStatus']
      }
    }
    /** @description Decoded body over 5 MB. Not retryable; lower the exporter's batch size. */
    OtlpPayloadTooLarge: {
      headers: {
        [name: string]: unknown
      }
      content: {
        'application/json': components['schemas']['RpcStatus']
      }
    }
    /** @description Anything but `application/json`. `http/protobuf` is not supported in v1. */
    OtlpUnsupportedMediaType: {
      headers: {
        [name: string]: unknown
      }
      content: {
        'application/json': components['schemas']['RpcStatus']
      }
    }
    /** @description Storage unavailable. Retryable; `Retry-After` may be set. */
    OtlpUnavailable: {
      headers: {
        'Retry-After'?: number
        [name: string]: unknown
      }
      content: {
        'application/json': components['schemas']['RpcStatus']
      }
    }
  }
  parameters: {
    /** @description `next_cursor` from the previous page. */
    Cursor: string
    Limit: number
    /** @description The sender's `session.id`. */
    SessionId: string
    /** @description Client namespace, such as `embertrail-dashboard`. */
    Namespace: components['schemas']['Slug']
    /** @description Client-chosen document id, unique within the namespace. */
    DocumentId: components['schemas']['Slug']
    /**
     * @description Create the document for a Team instead of the caller: `team:<id>`.
     *     The caller must be an editor of that Team. Omit on the solo path.
     */
    OwnerHeader: string
    /** @description `gzip` is accepted. The 5 MB limit applies to the decoded body. */
    ContentEncoding: 'gzip' | 'identity'
  }
  requestBodies: never
  headers: {
    /** @description Strong validator derived from the document's `version`. */
    ETag: string
  }
  pathItems: never
}
export type $defs = Record<string, never>
export interface operations {
  queryMetrics: {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    requestBody: {
      content: {
        /**
         * @example {
         *       "metric": "claude_code.cost.usage",
         *       "aggregation": "sum",
         *       "from": "2026-10-01T00:00:00+02:00",
         *       "to": "2026-10-08T00:00:00+02:00",
         *       "tz": "Europe/Berlin",
         *       "bucket": "day",
         *       "group_by": [
         *         "model"
         *       ]
         *     }
         */
        'application/json': components['schemas']['MetricsQuery']
      }
    }
    responses: {
      /** @description Aggregate rows. */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['AggregateResult']
        }
      }
      400: components['responses']['BadRequest']
      401: components['responses']['Unauthorized']
      403: components['responses']['Forbidden']
      422: components['responses']['Unprocessable']
      500: components['responses']['Internal']
    }
  }
  queryEvents: {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['EventsQuery']
      }
    }
    responses: {
      /** @description Events (`list`) or aggregate rows (`aggregate`), matching the request's `mode`. */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json':
            components['schemas']['EventList'] | components['schemas']['AggregateResult']
        }
      }
      400: components['responses']['BadRequest']
      401: components['responses']['Unauthorized']
      403: components['responses']['Forbidden']
      422: components['responses']['Unprocessable']
      500: components['responses']['Internal']
    }
  }
  listSessions: {
    parameters: {
      query?: {
        /** @description Sessions whose last Signal is at or after this time. */
        from?: components['schemas']['Timestamp']
        /** @description Sessions whose first Signal is before this time. */
        to?: components['schemas']['Timestamp']
        source_id?: components['schemas']['Id']
        account_id?: components['schemas']['Id']
        service_name?: string
        /** @description Sessions that used this model at least once. */
        model?: string
        /** @description Sessions in this group (`embertrail.group.id`). */
        group_id?: string
        /** @description Direct children of this Session. */
        parent_session_id?: string
        /** @description `key=value`; repeat to require several labels. */
        label?: string[]
        sort?: '-started_at' | 'started_at' | '-last_seen_at' | '-cost_usd'
        /** @description `next_cursor` from the previous page. */
        cursor?: components['parameters']['Cursor']
        limit?: components['parameters']['Limit']
      }
      header?: never
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description A page of Sessions. */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': {
            items: components['schemas']['SessionSummary'][]
            next_cursor: components['schemas']['NextCursor']
          }
        }
      }
      400: components['responses']['BadRequest']
      401: components['responses']['Unauthorized']
      403: components['responses']['Forbidden']
      500: components['responses']['Internal']
    }
  }
  getSession: {
    parameters: {
      query?: never
      header?: never
      path: {
        /** @description The sender's `session.id`. */
        session_id: components['parameters']['SessionId']
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description The Session. */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['SessionDetail']
        }
      }
      401: components['responses']['Unauthorized']
      403: components['responses']['Forbidden']
      404: components['responses']['NotFound']
      500: components['responses']['Internal']
    }
  }
  putSessionLabels: {
    parameters: {
      query?: never
      header?: never
      path: {
        /** @description The sender's `session.id`. */
        session_id: components['parameters']['SessionId']
      }
      cookie?: never
    }
    requestBody: {
      content: {
        /**
         * @example {
         *       "labels": {
         *         "embertrail.group.id": "batch-2026-10-10",
         *         "embertrail.group.kind": "orchestrator",
         *         "ticket": "ABC-123"
         *       }
         *     }
         */
        'application/json': {
          labels: components['schemas']['Labels']
        }
      }
    }
    responses: {
      /** @description The stored labels. */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': {
            session_id: string
            labels: components['schemas']['Labels']
          }
        }
      }
      400: components['responses']['BadRequest']
      401: components['responses']['Unauthorized']
      403: components['responses']['Forbidden']
      500: components['responses']['Internal']
    }
  }
  getInventory: {
    parameters: {
      query?: {
        from?: components['schemas']['Timestamp']
        to?: components['schemas']['Timestamp']
      }
      header?: never
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description The Inventory. */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['Inventory']
        }
      }
      400: components['responses']['BadRequest']
      401: components['responses']['Unauthorized']
      403: components['responses']['Forbidden']
      500: components['responses']['Internal']
    }
  }
  runSql: {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    requestBody: {
      content: {
        /**
         * @example {
         *       "sql": "select model, sum(value) from otel.otel_metrics_sum where metric_name = $1 group by 1",
         *       "params": [
         *         "claude_code.cost.usage"
         *       ]
         *     }
         */
        'application/json': components['schemas']['SqlRequest']
      }
    }
    responses: {
      /** @description The result set. */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['SqlResult']
        }
      }
      400: components['responses']['BadRequest']
      401: components['responses']['Unauthorized']
      403: components['responses']['Forbidden']
      422: components['responses']['Unprocessable']
      500: components['responses']['Internal']
    }
  }
  listStoreDocuments: {
    parameters: {
      query?: {
        /** @description `next_cursor` from the previous page. */
        cursor?: components['parameters']['Cursor']
        limit?: components['parameters']['Limit']
      }
      header?: never
      path: {
        /** @description Client namespace, such as `embertrail-dashboard`. */
        namespace: components['parameters']['Namespace']
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description A page of documents. */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': {
            items: components['schemas']['StoreDocument'][]
            next_cursor: components['schemas']['NextCursor']
          }
        }
      }
      400: components['responses']['BadRequest']
      401: components['responses']['Unauthorized']
      403: components['responses']['Forbidden']
      500: components['responses']['Internal']
    }
  }
  getStoreDocument: {
    parameters: {
      query?: never
      header?: never
      path: {
        /** @description Client namespace, such as `embertrail-dashboard`. */
        namespace: components['parameters']['Namespace']
        /** @description Client-chosen document id, unique within the namespace. */
        id: components['parameters']['DocumentId']
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description The document. `ETag` carries its version. */
      200: {
        headers: {
          ETag: components['headers']['ETag']
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['StoreDocument']
        }
      }
      401: components['responses']['Unauthorized']
      403: components['responses']['Forbidden']
      404: components['responses']['NotFound']
      500: components['responses']['Internal']
    }
  }
  putStoreDocument: {
    parameters: {
      query?: never
      header?: {
        /**
         * @description Create the document for a Team instead of the caller: `team:<id>`.
         *     The caller must be an editor of that Team. Omit on the solo path.
         */
        'Embertrail-Owner'?: components['parameters']['OwnerHeader']
        'If-Match'?: string
        'If-None-Match'?: '*'
      }
      path: {
        /** @description Client namespace, such as `embertrail-dashboard`. */
        namespace: components['parameters']['Namespace']
        /** @description Client-chosen document id, unique within the namespace. */
        id: components['parameters']['DocumentId']
      }
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': {
          data: components['schemas']['StoreData']
        }
      }
    }
    responses: {
      /** @description Replaced. */
      200: {
        headers: {
          ETag: components['headers']['ETag']
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['StoreDocument']
        }
      }
      /** @description Created. */
      201: {
        headers: {
          ETag: components['headers']['ETag']
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['StoreDocument']
        }
      }
      400: components['responses']['BadRequest']
      401: components['responses']['Unauthorized']
      403: components['responses']['Forbidden']
      404: components['responses']['NotFound']
      409: components['responses']['Conflict']
      412: components['responses']['PreconditionFailed']
      413: components['responses']['PayloadTooLarge']
      500: components['responses']['Internal']
    }
  }
  deleteStoreDocument: {
    parameters: {
      query?: never
      header?: {
        'If-Match'?: string
      }
      path: {
        /** @description Client namespace, such as `embertrail-dashboard`. */
        namespace: components['parameters']['Namespace']
        /** @description Client-chosen document id, unique within the namespace. */
        id: components['parameters']['DocumentId']
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Deleted. */
      204: {
        headers: {
          [name: string]: unknown
        }
        content?: never
      }
      401: components['responses']['Unauthorized']
      403: components['responses']['Forbidden']
      404: components['responses']['NotFound']
      412: components['responses']['PreconditionFailed']
      500: components['responses']['Internal']
    }
  }
  ingestLogs: {
    parameters: {
      query?: never
      header?: {
        /** @description `gzip` is accepted. The 5 MB limit applies to the decoded body. */
        'Content-Encoding'?: components['parameters']['ContentEncoding']
      }
      path?: never
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['OtlpExportLogsRequest']
      }
    }
    responses: {
      /** @description Stored. `partialSuccess` is present when some records were rejected. */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['OtlpExportLogsResponse']
        }
      }
      400: components['responses']['OtlpBadRequest']
      401: components['responses']['OtlpUnauthorized']
      403: components['responses']['OtlpForbidden']
      413: components['responses']['OtlpPayloadTooLarge']
      415: components['responses']['OtlpUnsupportedMediaType']
      503: components['responses']['OtlpUnavailable']
    }
  }
  ingestMetrics: {
    parameters: {
      query?: never
      header?: {
        /** @description `gzip` is accepted. The 5 MB limit applies to the decoded body. */
        'Content-Encoding'?: components['parameters']['ContentEncoding']
      }
      path?: never
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['OtlpExportMetricsRequest']
      }
    }
    responses: {
      /** @description Stored. `partialSuccess` is present when some data points were rejected. */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['OtlpExportMetricsResponse']
        }
      }
      400: components['responses']['OtlpBadRequest']
      401: components['responses']['OtlpUnauthorized']
      403: components['responses']['OtlpForbidden']
      413: components['responses']['OtlpPayloadTooLarge']
      415: components['responses']['OtlpUnsupportedMediaType']
      503: components['responses']['OtlpUnavailable']
    }
  }
  ingestTraces: {
    parameters: {
      query?: never
      header?: {
        /** @description `gzip` is accepted. The 5 MB limit applies to the decoded body. */
        'Content-Encoding'?: components['parameters']['ContentEncoding']
      }
      path?: never
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['OtlpExportTraceRequest']
      }
    }
    responses: {
      /** @description Every span rejected. */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          /**
           * @example {
           *       "partialSuccess": {
           *         "rejectedSpans": "42",
           *         "errorMessage": "Embertrail v1 does not store traces. Disable the traces exporter for this sender."
           *       }
           *     }
           */
          'application/json': components['schemas']['OtlpExportTraceResponse']
        }
      }
      400: components['responses']['OtlpBadRequest']
      401: components['responses']['OtlpUnauthorized']
      403: components['responses']['OtlpForbidden']
      413: components['responses']['OtlpPayloadTooLarge']
      415: components['responses']['OtlpUnsupportedMediaType']
    }
  }
  getOpenApi: {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description OpenAPI 3.1 document. */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': Record<string, unknown>
        }
      }
    }
  }
  getDocs: {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description HTML page. */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'text/html': string
        }
      }
    }
  }
  getLlmsTxt: {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Markdown text. */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'text/markdown': string
        }
      }
    }
  }
}
