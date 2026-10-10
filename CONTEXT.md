# Embertrail

Embertrail collects telemetry from AI coding agents (Claude Code first) into one self-hostable place, and shows it back through a dashboard. It is built from standalone parts that talk only through published contracts.

## Language

### Data and where it comes from

**Signal**:
One of the OpenTelemetry data kinds Embertrail stores: a Metric or an Event.
_Avoid_: datapoint, record

**Metric**:
A numeric measurement over time, such as tokens used or cost, sent as an OTLP metric.
_Avoid_: counter, stat

**Event**:
A single timestamped occurrence sent as an OTLP log record, such as one API request or one tool result.
_Avoid_: log, log line

**Session**:
One Claude Code session, identified by its `session.id`.
_Avoid_: conversation, chat

**Request**:
One call from an agent to a model API, identified by its request id; the unit that Backfill and live data are matched on.
_Avoid_: API call, turn

**Origin**:
How a Signal reached Embertrail: `live` (exported as it happened) or `backfill` (reconstructed later).
_Avoid_: provenance, mode

**Backfill**:
Importing historical Signals that predate a Source's live export, reconstructed from transcripts or from an older telemetry store.
_Avoid_: migration, sync, import (on its own)

**Importer**:
One Backfill reader for one kind of historical data (transcripts, Prometheus, Loki).
_Avoid_: loader, migrator

### Who owns what

**User**:
A person whose data Embertrail holds, identified by an edge identity or by their Tokens.
_Avoid_: member, login

**Team**:
A named group of Users that can own data and dashboards together.
_Avoid_: org, group, workspace

**Owner**:
The User or Team a stored row belongs to; every stored row has exactly one.
_Avoid_: tenant

**Source**:
A named sender of Signals owned by one User, typically one machine.
_Avoid_: device, client, host

**Account**:
A Claude identity that produced the Signals (personal Max plan, a company's org), recognised from the telemetry itself, not from the Source.
_Avoid_: profile, login

**Token**:
A secret that lets a Source or an app act for a User within a set of Scopes.
_Avoid_: API key, credential

**Scope**:
A permission naming one Module and one verb, such as `otel:write`.
_Avoid_: permission, role

**Grant**:
Read access to another Owner's data within one Module.
_Avoid_: share, ACL

### How it is built

**Hub**:
A running Embertrail server: ingests Signals, stores them, and answers queries.
_Avoid_: backend, server, instance

**Module**:
A self-contained feature of the Hub with its own storage, routes and Widgets, such as `otel`, `transcripts` or `memory`.
_Avoid_: plugin, extension, service

**Port**:
An interface the Hub's core needs from its environment, such as Db, Blob, Queue or Identity.
_Avoid_: driver, provider

**Adapter**:
One Platform's implementation of one Port.
_Avoid_: driver, binding

**Platform**:
A place the Hub can run: Cloudflare or Docker in v1.
_Avoid_: target, cloud, environment

**Edge Identity**:
A User identity asserted by infrastructure in front of the Hub or Dashboard (such as Cloudflare Access), instead of an app login.
_Avoid_: SSO, auth

### Dashboard

**Dashboard**:
The standalone web app that shows Widgets from one or more Data Sources.
_Avoid_: UI, frontend, console

**Data Source**:
An endpoint that implements the Widget Data API; the Hub is one, but any can be configured.
_Avoid_: backend, datasource, connector

**Widget**:
One self-contained view in a Board, with a kind (stat, series, bars, table, heatmap…) and data from one Data Source.
_Avoid_: panel, tile, card, chart

**Catalogue**:
The list of Widgets a Data Source offers.
_Avoid_: registry, library

**Board**:
A named arrangement of Widgets that a User or Team owns.
_Avoid_: dashboard (that is the app), page, view

**Layout**:
The grid positions of a Board's Widgets.
_Avoid_: arrangement, config

**Preset**:
A built-in, read-only Board such as Overview or Explore; customising it copies it into a new Board.
_Avoid_: template, default dashboard
