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

**Session Group**:
A set of Sessions declared to belong together, such as one orchestrator run, through `embertrail.group.*` attributes or Labels; Sessions may also form a tree through a parent Session.
_Avoid_: group (alone; Team is the group of Users), batch, run

**Label**:
A key–value pair attached to a Session after the fact; reserved `embertrail.*` Labels link it into a Session Group or tree.
_Avoid_: tag, annotation

**Request**:
One call from an agent to a model API, identified by its request id.
_Avoid_: API call, turn

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

### Reading data

**Query API**:
The Hub's public read contract over stored Signals, specified with OpenAPI and JSON Schema; any client may use it.
_Avoid_: REST API, endpoints, backend API

**Inventory**:
What exists in the data a caller can read (Owners, Sources, Accounts, services, models, Metric and Event names, attribute keys), served by the Query API for pickers and labels.
_Avoid_: catalog, catalogue (that is the Dashboard's list of Widgets)

### Dashboard

**Dashboard**:
The Embertrail web app that shows the Hub's data as Boards of Widgets, built on the Query API.
_Avoid_: UI, frontend, console

**Widget**:
One self-contained view in a Board, with a kind (stat, series, bars, table, heatmap…), defined and computed by the Dashboard.
_Avoid_: panel, tile, card, chart

**Catalogue**:
The list of Widgets the Dashboard offers.
_Avoid_: registry, library

**Board**:
A named arrangement of Widgets.
_Avoid_: dashboard (that is the app), page, view

**Layout**:
The grid positions of a Board's Widgets.
_Avoid_: arrangement, config

**Preset**:
A built-in, read-only Board such as Overview; customising it copies it into a new Board.
_Avoid_: template, default dashboard
