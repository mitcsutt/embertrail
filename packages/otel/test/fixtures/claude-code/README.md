# Claude Code fixtures

OTLP/HTTP JSON payloads shaped like what Claude Code 2.1 sends with `OTEL_EXPORTER_OTLP_PROTOCOL=http/json`, as the #14 spike recorded it:

- `logs-startup.json`: the first logs flush of a Session, about 73 KB compact: managed settings, plugins loaded, MCP server connections, skills, a prompt, its API requests and tool calls (50 Events).
- `logs-turn.json`: a later, smaller flush from the same Session (6 Events).
- `metrics-first.json`, `metrics-second.json`: two delta-sum flushes (7 and 13 data points).

They are synthetic. The spike's captures were not committed, so these were written from the spike's notes and the [Claude Code monitoring reference](https://code.claude.com/docs/en/monitoring-usage): every id is random, emails are `example.com`, and prompts are redacted. They keep the quirks the spike found: `intValue` as a JSON number, every data point `asDouble`, identity attributes on every record and point, `event.name` unprefixed beside a `claude_code.`-prefixed body, and `event.sequence` and `event.timestamp` on every Event.

The files are pretty-printed for review; tests and the benchmark send them compact, as Claude Code does.
