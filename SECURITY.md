# Security policy

## Supported versions

Embertrail is pre-1.0. Security fixes go into the latest release only; older versions don't get backports.

## Reporting a vulnerability

Please don't open a public issue for a security problem.

Report it privately through [GitHub's private vulnerability reporting](https://github.com/mitcsutt/embertrail/security/advisories/new) for this repository. Include:

- the affected part (Hub, Dashboard, CLI or client) and version
- what the problem is and what an attacker could do with it
- steps or a minimal example that reproduces it

The report stays private while it's investigated. Once a fix is ready, it's released with a changelog entry and a GitHub security advisory that credits you, unless you'd rather stay anonymous.

## Scope

A Hub holds telemetry about how people use their coding agents, so reports about data leaking between Owners, Tokens or Scopes being bypassed, or Signals readable without authorisation are especially welcome. Problems in one particular deployment's infrastructure belong to whoever runs it.
