# Importing history

`embertrail import` puts Signals recorded elsewhere into a Hub, through the same OTLP ingest Claude Code uses. Everything it sends is stored as one Source of the logged-in User, so the Owner, Source and Scope rules apply as they do to live telemetry, and the Hub's de-duplication keys ([`otel.md`](otel.md#de-duplication-keys)) make every import safe to run again.

| Command                                                          | Reads                                                                                    |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `import file <file\|-> --source <name>`                          | An `embertrail export otel` file: moving a Hub's Signals and Labels to another Hub       |
| `import prometheus-loki --source <name> --prometheus … --loki …` | A Collector's Prometheus (Metrics) and Loki (Events): backfilling from an existing stack |

Both share one replay core (`packages/cli/src/import/replay.ts`): entries are merged into requests of at most `--batch-bytes` (default 256 KiB, so one request stays well inside the Hub's 5 MiB body cap and a Worker's CPU limit), never splitting one entry. On a 413, a 503 or a Cloudflare 1102 the batch is halved and sent again; a 429, 502 or 504 is retried with backoff. `partialSuccess` refusals are counted and printed, and never stop the run.

Each run first checks its input (the file is a regular file or `-`; Prometheus and Loki answer), so a mistyped path or URL leaves nothing behind. It then creates the Source if it is missing, issues an ingest Token for it that expires in a day, and revokes that Token when it ends (a revoke that fails is printed with the Token's id). It then reads back what the Hub holds for the Source and prints it beside what it read and sent:

```
Imported into Source "history" (9ad8…), 2026-09-24T09:00:00.000Z to 2026-10-24T09:00:00.000Z.
                 READ  SENT  REFUSED  STORED
  Events         112   112   0        112
  Metric points  40    40    0        40
  Sessions       -     -     -        2
```

`STORED` is everything the Source holds in the window, so a second run shows the same number while `SENT` repeats: the Hub skipped what it already had. It exits 1 when the Hub refused anything or a line could not be read, after printing the counts. `--dry-run` reads and converts without creating a Source or sending, and `--json` prints the report as JSON.

## Old timestamps and retention

The Hub stores a Signal at the time it carries, from 1970 to 9999; nothing refuses old data, so a backfill lands where it happened. The limit is retention: a Hub with `RETENTION_DAYS` deletes rows older than that on its next sweep, imported or not. Leave it unset, or longer than the history, before importing.

## Replaying an export

```sh
embertrail export otel --out history.jsonl          # logged in to the old Hub
embertrail import file history.jsonl --source laptop  # logged in to the new one
```

Lines are read as a stream: `resourceLogs` lines go to `/v1/logs`, `resourceMetrics` lines to `/v1/metrics`, and the `sessionLabels` lines are applied after every Signal with `PUT /api/v1/sessions/{id}/labels` (as the logged-in User). A line that is none of these is counted as unreadable. The export carries no Source, so an export of several Sources arrives as the one `--source` ([`otel.md`](otel.md#retention-and-export) has the limitation).

## Backfilling from Prometheus and Loki

The stack this reads is the common one for Claude Code: Claude Code sends OTLP to an OpenTelemetry Collector, which exports Metrics to Prometheus with `resource_to_telemetry_conversion` (resource attributes become labels) and Events to Loki through its `loki` exporter (the default JSON line format, `service.name` as a stream label, often the event body copied to an `event_name` label). [`packages/cli/test/import-stack/`](../packages/cli/test/import-stack/) holds a Collector config of that shape. The importer was built against Collector contrib 0.96, Prometheus 2.51 and Loki 2.9.

```sh
embertrail import prometheus-loki --source history \
  --prometheus http://localhost:9090 --loki http://localhost:3100 --from 30d
```

| Option                  | Default                        | Meaning                                                                                                                                              |
| ----------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--from`, `--to`        | `30d` before `--to`, and now   | The window, `[from, to)`: ISO 8601, or for `--from` a duration such as `30d`                                                                         |
| `--prometheus-selector` | `{__name__=~"claude_code_.+"}` | The series to read                                                                                                                                   |
| `--loki-selector`       | `{service_name="claude-code"}` | The streams to read                                                                                                                                  |
| `--gap`                 | `2m`                           | A counter silent for longer than this restarted from zero; keep it above twice the scrape interval                                                   |
| `--chunk`               | `6h`                           | The window is read in pieces this long, cut at the same instants every run                                                                           |
| `--loki-limit`          | `5000`                         | Lines per Loki query, at most its `max_entries_limit_per_query`                                                                                      |
| `--state`, `--restart`  | a file beside the CLI config   | Progress: each piece is recorded once it is stored with nothing refused or unreadable, and the next run skips it; `--restart` reads everything again |

Either URL may carry `user:password@`, which is sent as Basic auth and left out of every message.

**Metrics.** For each piece, one instant query of a range selector (`<selector>[<range>ms]`) returns Prometheus's raw samples, plus `--gap` before the piece; `query_range` is not used because it resamples onto a step and would invent points. `/api/v1/metadata` says which series are counters and which are gauges (a series it doesn't know is a counter when its name ends in `_total`); histograms and anything else are skipped and named in the report. A counter becomes delta sums, as the Hub stores them: each sample minus the one before it, timed at the sample and starting at the one before. A sample is the counter's whole value, not a difference, when the value dropped (a reset) or when no sample came in the `--gap` before it (the Collector's exporter expires an idle series after 5 minutes and starts it again from zero). Increases of zero are left out. Because a point depends only on samples within `--gap` of it, any windows, and any re-run, give the same points, which the Hub then de-duplicates. Names and keys go back to the OTel form: `claude_code_cost_usage_USD_total` is `claude_code.cost.usage` in `USD`, and `session_id`, `user_email`, `os_type` and the other keys Claude Code spells with dots get their dots back (`service.*`, `os.*`, `host.arch` on the resource, the rest on the point). `job`, `instance` and `exported_*` are the scrape's, and are dropped.

**Events.** Each piece is read with `query_range`, forward, a page of `--loki-limit` lines at a time; the next page starts at the newest timestamp the last one reached and skips the lines it already returned, so lines that share a timestamp are read once. More lines at one timestamp than a page holds stop the run with a message to raise `--loki-limit`. Each line's `body`, `attributes`, `resources`, `instrumentation_scope`, `severity`, `traceid` and `spanid` become the log record at the line's timestamp; stream labels other than `exporter`, `job`, `instance`, `level` and `event_name` go back into the attributes or the resource. When `event.name` is missing, it is the body without its `claude_code.` prefix. Claude Code's `session.id`, `event.sequence` and `event.name` are kept, so the Hub's Event key de-duplicates a re-run.

### What cannot be recovered

- **Metrics per export.** Prometheus holds a running total per scrape. Every increase between two scrapes becomes one point at the later scrape, so the Metric points are per scrape interval, not per Claude Code export, and their times are scrape times. Totals per Session, model and type are exact (the import test checks them against the source).
- **A restart the gap cannot see.** A series the Collector expired and started again within `--gap`, at a value above its last one, reads as an increase from the old value, so that increase is undercounted. A Prometheus outage longer than `--gap` while the Collector kept counting reads as a restart, so it is overcounted.
- **What the stack never kept**: anything past its retention (30 days in the common setup), Metric points Prometheus did not scrape, a record's `observedTimeUnixNano` and `severityNumber`, scope attributes and the Metrics' scope (imported Metrics carry the scope `embertrail-import` unless the series has `otel_scope_name`), and the type of a Metric attribute (labels are strings).
- **Dots in other keys.** A label not in the list of Claude Code's dotted keys (`attributeKey` in `src/import/otlp.ts`) is stored as the label is spelled, such as a custom `OTEL_RESOURCE_ATTRIBUTES` key `team.name` arriving as `team_name`.
- **Labels and traces.** Session Labels exist only in a Hub, and the Hub stores no traces.

History older than the stack's retention, such as Claude Code's local transcripts, is not imported: Backfill from transcripts is not an Embertrail feature (ADR-0009 was withdrawn).

## Trying it locally

[`packages/cli/test/import-stack/`](../packages/cli/test/import-stack/) starts a throwaway Collector, Prometheus and Loki on ports you choose, and `feed.ts` sends synthetic Claude Code telemetry (the otel Module's fixtures, moved onto new Sessions and the current time) to the Collector:

```sh
export COMPOSE_PROJECT_NAME=et-import-try OTLP_PORT=34318 PROMETHEUS_PORT=39090 LOKI_PORT=33100
docker compose -f packages/cli/test/import-stack/compose.yaml up -d
node packages/cli/test/import-stack/feed.ts --otlp http://127.0.0.1:34318 --sessions 2
# wait a scrape or two, then, logged in to a test Hub:
node packages/cli/dist/bin.js import prometheus-loki --source try --from 1h \
  --prometheus http://127.0.0.1:39090 --loki http://127.0.0.1:33100
docker compose -f packages/cli/test/import-stack/compose.yaml down -v
```

Two Sessions give 112 Events and 40 Metric points, and the Hub's token, cost, active-time and lines totals equal the fixtures'. The automated tests (`src/import.test.ts`, `src/import/*.test.ts`) run against fakes of the two APIs in `src/testing/stack.ts`, which return what this stack returned.
