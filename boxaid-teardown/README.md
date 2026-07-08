# boxaid-teardown

A Claude Code plugin that closes out a finished Boxaid support call in one deterministic pass. Firing `/teardown` fans out the call's write-back artifacts over a workflow for-loop that cannot drop a leg, verifies each one adversarially for PII and convention, then writes the safe artifacts (KB page, service report) and hands back the manual ones (call-log cells, cover email) as copy blocks.

It replaces three older skills (`capture-call`, `security-report`, and the `teardown` router) whose report step was model-judged and optional, so a routine call often produced only one leg. Removing that optionality from the fan-out is the whole fix.

## Components

| Component | Type | File |
| --- | --- | --- |
| `/teardown` | command | `commands/teardown.md` |
| `capture-call` | agent | `agents/capture-call.md` |
| `service-report` | agent | `agents/service-report.md` |

The command assembles the call facts (no client PII) and invokes the close-out workflow. The two agents are the generators the workflow fans out to.

## Loose sidecars (not bundled)

A plugin cannot bundle a Workflow script or a resource file, so two pieces live loose in the consumer repo's `.claude/workflows/`:

- `teardown-close-out.js`, the fan-out engine (a `pipeline()` over a `jobs[]` array). Loose because there is no `workflows/` plugin component and workflow discovery reads the project's `.claude/workflows/`.
- `report-template.html`, the service-report HTML, edited as HTML rather than a string literal. The `service-report` agent reads it at runtime.

The plugin also relies on (does not ship) the consumer repo's `.claude/` hooks: the PII commit gate, the em-dash checks, and the raw-sources guard.

## Registration (D2: loose mirrors, no install)

This package is the canonical, portable source and is never installed or registered. The consumer repo (Boxaid Work) runs entirely off loose mirrors of these three files in its own `.claude/commands/` and `.claude/agents/`, so `/teardown` fires and the workflow resolves the agents by their bare names (`capture-call`, `service-report`). Edit the plugin package first, then copy the changes to the loose mirrors. See the consumer repo's `docs/adr/0001-teardown-spine.md` for the rationale and the copy cost.

## Author

Mr. Beasley
