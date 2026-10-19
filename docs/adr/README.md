# Architecture decisions

Decisions live as GitHub issues labelled [`adr`](https://github.com/mitcsutt/embertrail/issues?q=label%3Aadr), not as files here. An ADR stands until a new ADR supersedes it: to depart from one, open a new `adr` issue that says which it supersedes and why, and link it from the pull request.

| ADR  | Decision                                                                                                                    |
| ---- | --------------------------------------------------------------------------------------------------------------------------- |
| 0001 | [Postgres on every Platform, not D1](https://github.com/mitcsutt/embertrail/issues/1)                                       |
| 0002 | [Store Signals in the OpenTelemetry data model, unchanged](https://github.com/mitcsutt/embertrail/issues/2)                 |
| 0003 | [Agents export straight to the Hub over OTLP/HTTP JSON, no Collector](https://github.com/mitcsutt/embertrail/issues/3)      |
| 0004 | [Ports and Adapters; v1 ships the Cloudflare and Docker Platforms only](https://github.com/mitcsutt/embertrail/issues/4)    |
| 0005 | [No app login; Users come from Edge Identity or Tokens](https://github.com/mitcsutt/embertrail/issues/5)                    |
| 0006 | [Standalone parts that talk only through published contracts](https://github.com/mitcsutt/embertrail/issues/6)              |
| 0007 | [Every stored row has one Owner and one Source; multi-user from day one](https://github.com/mitcsutt/embertrail/issues/7)   |
| 0008 | [Modules own their storage and plug in through one contract](https://github.com/mitcsutt/embertrail/issues/8)               |
| 0009 | [Withdrawn](https://github.com/mitcsutt/embertrail/issues/9)                                                                |
| 0010 | [The Dashboard is a separate Kiln app that reads only the Query API](https://github.com/mitcsutt/embertrail/issues/22)      |
| 0011 | [Apache-2.0, unlike Kiln's MIT](https://github.com/mitcsutt/embertrail/issues/11)                                           |
| 0013 | [The Hub exposes a general Query API; Widgets live only in the Dashboard](https://github.com/mitcsutt/embertrail/issues/20) |
| 0014 | [Session links are declared via `embertrail.*` attributes or Labels](https://github.com/mitcsutt/embertrail/issues/23)      |

Keep this table in step with the `adr` label when an ADR is added or superseded.
