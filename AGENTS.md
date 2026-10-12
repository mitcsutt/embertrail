# Embertrail

The design is **locked** (#24). Build in this order, each spec issue's acceptance criteria being its definition of done:

1. **Kiln first**, in `mitcsutt/kiln`: K1 tokens (mitcsutt/kiln#57), then K2 charts (mitcsutt/kiln#58) and K3 drag-and-drop (mitcsutt/kiln#59). Kiln packages serve other projects too, so they land before Embertrail code.
2. **Embertrail**: Core (#49, starting with #28), then Cloudflare (#50), Dashboard (#51) and v0.1 (#52).

## Public by default

This repo, its issues and its commits are public. Write only generic, reusable content: deployment specifics, personal infrastructure and any one deployment's details belong in that deployment's private repo. A local guard blocks commits and issue writes that match the owner's private pattern list; when it fires, rewrite the content generically.

## Solo first

The expected deployment is one person on their own Hub. Multi-user capabilities exist, and the solo path stays free of their steps, config and UI.

## Sources of truth

- **Design:** GitHub issues. `design` = design docs, `adr` = decisions, `spec` = buildable specs with acceptance criteria. Read the relevant issues before proposing anything; a decision recorded in an `adr` issue stands until a new ADR supersedes it.
- **Language:** `CONTEXT.md` is the glossary. Use its terms exactly in issues, code and commits.
- **Kiln work** (`kiln-charts`, `kiln-dnd`, chart tokens) is tracked in `mitcsutt/kiln`, not here.

## Skills

Matt Pocock's skills are enabled for this repo. Reach for `domain-modeling` when a term or decision appears, `grilling` to stress-test an area, `codebase-design` for module seams, `research` for unverified facts, `prototype` for spikes, and `tdd` once building starts.
