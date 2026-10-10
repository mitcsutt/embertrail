# Embertrail

The repo is in its **design phase**: the work is closing gaps in the design, not writing code. Code starts only after the lock check in the design-phase epic passes.

## Solo first

The expected deployment is one person on their own Hub. Multi-user capabilities exist, and the solo path stays free of their steps, config and UI.

## Sources of truth

- **Design:** GitHub issues. `design` = design docs, `adr` = decisions, `spec` = buildable specs with acceptance criteria. Read the relevant issues before proposing anything; a decision recorded in an `adr` issue stands until a new ADR supersedes it.
- **Language:** `CONTEXT.md` is the glossary. Use its terms exactly in issues, code and commits.
- **Kiln work** (`kiln-charts`, `kiln-dnd`, chart tokens) is tracked in `mitcsutt/kiln`, not here.

## Skills

Matt Pocock's skills are enabled for this repo. Reach for `domain-modeling` when a term or decision appears, `grilling` to stress-test an area, `codebase-design` for module seams, `research` for unverified facts, `prototype` for spikes, and `tdd` once building starts.
