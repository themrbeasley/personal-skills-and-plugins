# boxaid-call-ops

A Claude Code plugin that closes out a finished Boxaid support call in one deterministic pass. Firing `/teardown` fans out the call's write-back artifacts over a workflow for-loop that cannot drop a leg, verifies each one adversarially for PII and convention, then writes the safe artifacts (KB page, service report) and hands back the manual ones (call-log cells, cover email) as copy blocks.

It replaces three older skills (`capture-call`, `security-report`, and the `teardown` router) whose report step was model-judged and optional, so a routine call often produced only one leg. Removing that optionality from the fan-out is the whole fix.

## Components

| Component | Type | File |
| --- | --- | --- |
| `/call-start` | command | `commands/call-start.md` |
| `/teardown` | command | `commands/teardown.md` |
| `capture-call` | agent | `agents/capture-call.md` |
| `service-report` | agent | `agents/service-report.md` |

The command assembles the call facts (no client PII) and invokes the close-out workflow. The two agents are the generators the workflow fans out to.

## Loose sidecars (not bundled)

A plugin cannot bundle a Workflow script or a resource file, so two pieces live loose in the consumer repo's `.claude/workflows/`:

- `teardown-close-out.js`, the fan-out engine (a `pipeline()` over a `jobs[]` array). Loose because there is no `workflows/` plugin component and workflow discovery reads the project's `.claude/workflows/`.
- `report-template.html`, the service-report HTML, edited as HTML rather than a string literal. The `service-report` agent reads it at runtime.

The call-mode hooks (`kill-guard.ps1`, `call-reminder.ps1`, `call-precompact.ps1`, `call-restore.ps1`) are a different case: their canonical copies live here in `hooks/`, and they are loose-mirrored into the consumer repo's `.claude/hooks/` the same way the commands and agents are (see Registration below). A plugin *can* bundle hooks, via `hooks/hooks.json` and `${CLAUDE_PLUGIN_ROOT}`. These live loose only because this package is never installed or enabled as a plugin, so a bundled `hooks.json` would never fire; the hooks have to be wired into the consumer repo's own `settings.json` instead.

The plugin also relies on (does not ship) the consumer repo's `.claude/` hooks: the PII commit gate, the em-dash checks, and the raw-sources guard.

## Registration (D2: loose mirrors, no install)

This package is the canonical, portable source and is never installed or registered. The consumer repo (Boxaid Work) runs entirely off loose mirrors in its own `.claude/`: the two commands (`/call-start`, `/teardown`) and two agents (`capture-call`, `service-report`) mirror into `.claude/commands/` and `.claude/agents/`, and the four call-mode hooks (`kill-guard.ps1`, `call-reminder.ps1`, `call-precompact.ps1`, `call-restore.ps1`) mirror into `.claude/hooks/` and are wired in `.claude/settings.json`. So both commands fire, the workflow resolves the agents by their bare names, and the hooks arm on a Boxaid Work session. Edit the plugin package first, then copy the changes to the loose mirrors. See the consumer repo's `docs/adr/0001-teardown-spine.md` for the rationale and the copy cost.

## Author

Mr. Beasley
