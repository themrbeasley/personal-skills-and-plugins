# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository purpose

Personal collection of Claude Code skills and plugins, plus a Cloudflare-Workers MCP server. Each top-level directory is an independent, self-contained project — there is no shared build, root package, or cross-project tooling.

## Projects

### `professor-orb/` — Claude Code plugin (most active project)

A post-session workflow plugin for D&D DMs. Skills, four commands, four agents, two hooks, and two workflow scripts, declared in `.claude-plugin/plugin.json`.

**Professor-orb imposes its own structural schema. It does not derive one from the consumer project.** Index rules, frontmatter schema, filename conventions, and folder layout are professor-orb's, shipped as `references/base-rules.json` and laid down by `setup` as the canonical layout. This is the plugin's whole purpose: to assign an organization method and rope unorganized or under-organized material into it. A consumer whose KB conventions were reverse-engineered would get their disorganization ratified as the rule set and then enforced by the validator.

**Do not reintroduce "derive, never impose" in any form.** That posture was the plugin's original defect: an audit found it in roughly 50 sentences across 8 files, and the 1.6.0 release (`docs/superpowers/specs/2026-07-28-canonical-schema-design.md`, "Phase 1: the schema is professor-orb's") deleted it deliberately. It reads plausible and it is wrong here. Note that `dnd-campaign-toolkit/` below *is* system-agnostic and shares many of professor-orb's skill names (`debrief`, `prep`, `content`, `chronicler`, `homebrew`, `timeline`) and agent names (`lore`, `kb-validator`, `historian`) — do not carry that plugin's posture across the boundary. What professor-orb still reads from the consumer's `CLAUDE.md` is campaign *facts*, writing style, and content exclusions; never structure.

Architecture to understand before editing:

- **`.professor-orb/conventions.json` is the machine-readable authority.** `setup` generates it by instantiating `references/base-rules.json` and layering a project-specific extras layer. Every other skill and hook reads it first. Schema reference: `skills/setup/references/conventions-schema.md`.
- **Multi-setting layout since 1.6.0.** `conventions.json` carries a `settings[]` array, one entry per world, each with three prong roots (`kbRoot`, `homebrewRoot`, `sessionReportsRoot`), its own `rules`, and its own `tagRegistryPath`. `retired`, `mergedInto`, and `retiredCampaigns` are written only by `/migrate` and must survive a resync.
- **Lane commands own one prong each.** `/scribe`, `/log`, and `/catalog` never cross prongs and use `:(literal)` pathspecs. `/migrate` is the sole exception — it restructures across prongs and commits its own work.
- **`workflows/` is real code with real tests**, unlike the markdown-only toolkit below. `migrate.mjs` is the migration executor (plan phase read-only by contract; apply phase mutates behind a snapshot commit); `validation-sweep.mjs` is the KB validator. Setup copies both into the consumer's `.claude/workflows/`, since a plugin cannot ship files there directly.
- **The comment blocks in `migrate.mjs` are load-bearing.** They record measured defects and the invariant each guard exists to hold. Read the comment before changing the code under it, and update it when the rule changes.

Tests are Node built-ins only, no framework. Run each file directly:

```
node professor-orb/workflows/migrate.plan.test.mjs
```

Seven suites: `workflows/migrate.plan`, `workflows/migrate.apply`, `workflows/migrate.proposal`, `workflows/validation-sweep.ownership`, `hooks/validate-write`, `hooks/pipeline-next`, `commands/lane-staging`.

Design record lives in `docs/superpowers/specs/` (designs) and `docs/superpowers/plans/` (implementation plans), one per release or phase. Read the relevant spec before changing behavior it describes.

### `dnd-campaign-toolkit/` — Claude Code plugin

A post-session workflow plugin for D&D DMs. Ships as a standard Claude Code plugin (`.claude-plugin/plugin.json`) with seven skills, three agents, and two hooks.

Architecture to understand before editing:

- **Session pipeline** is the core mental model: `debrief → prep → content / chronicler → kb-validator`. Skill descriptions are written to chain into each other — each skill's `description` frontmatter names the upstream skill it consumes from and the downstream skill it feeds. The `Stop` hook in `hooks/hooks.json` reinforces these handoffs by suggesting the next step. When editing any skill's description, keep those handoff references consistent or the pipeline breaks.
- **System-agnostic by design — this plugin only, not `professor-orb/`.** Skills do not ship templates or assume folder layouts. Every skill begins with a "First: learn the user's system" section that reads the *consumer project's* `CLAUDE.md` to discover KB conventions (folder structure, frontmatter schema, filename suffixes, cross-reference style). The plugin itself is configuration; the consumer's `CLAUDE.md` is the source of truth. Do not hardcode paths or schemas into skills. **`professor-orb/` takes the opposite posture on purpose** and the two share skill and agent names, so check which plugin you are editing before applying either rule.
- **Two skills sit outside the pipeline.** `homebrew` is standalone and targets D&D 5.5e (2024) rules specifically. `timeline` builds DM-reference chronology documents on demand and spawns the `historian` agent for temporal analysis.
- **Hooks use `"type": "prompt"`** rather than shell commands. The `PostToolUse` hook validates KB article frontmatter against the consumer project's `CLAUDE.md` conventions; the `Stop` hook suggests the next pipeline step. Both are silent on success.
- **Agents are read-only QA.** `lore` cross-references session events against the KB; `kb-validator` audits article metadata; `historian` builds chronological analysis from reports and lore. None of them write files — the `chronicler` skill is the only component that mutates the KB, and only after explicit DM approval.

No build, test, or lint tooling — it is all markdown. To validate changes, install the plugin into a Claude Code session against a real campaign project and exercise the pipeline.

**Cowork install constraint — keep frontmatter `description` fields short.** The plugin is also distributed by dragging a packaged `.zip`/`.plugin` into Claude Cowork, which runs a content validator that rejects the *entire* plugin with a "Plugin validation failed." toast if any `skills/*/SKILL.md` or `agents/*.md` frontmatter `description` is too long. Observed: `agents/lore.md` at 1616 chars installs; an earlier 2055-char `agents/historian.md` failed. Keep every `description` under ~1500 chars. `claude plugin validate` does **not** catch this — it only schema-checks `plugin.json`/`hooks.json` (and reports a spurious `hooks` error even on plugins that install cleanly), so it is not a proxy for a real Cowork install. Also set each agent's `color` to a valid enum value (`red`, `blue`, `green`, `yellow`, `purple`, `orange`, `pink`, `cyan`); `magenta` is not valid.

### `google-tasks-mcp/` — Cloudflare Workers MCP server

Remote MCP server exposing Google Tasks via OAuth. Stack: Cloudflare Workers + Durable Objects (`GoogleTasksMCP` class, SQLite-backed) + Hono + `@cloudflare/workers-oauth-provider` + `agents` SDK. KV namespace `OAUTH_KV` stores OAuth state.

Source layout (`src/`):
- `index.ts` — Worker entry + `GoogleTasksMCP` Durable Object
- `google-handler.ts` — Google OAuth flow
- `google-tasks-api.ts` — Tasks API client
- `workers-oauth-utils.ts`, `utils.ts` — OAuth + helpers

Commands (run from `google-tasks-mcp/`):
```
npm run dev          # wrangler dev (local)
npm run deploy       # wrangler deploy
npm run type-check   # tsc --noEmit
npm run cf-typegen   # regenerate worker-configuration.d.ts from wrangler.jsonc bindings
```
Re-run `cf-typegen` after changing bindings in `wrangler.jsonc`. No test suite exists.

### `sequencer/` — Claude Code skill

Standalone skill for building Foundry VTT Sequencer visual-effect macros (projectiles, impacts, auras, summoning flourishes). Integrates with Midi-QOL, DAE, and Portal; the skill implements the *visuals*, not game balance. Layout: `SKILL.md` + `references/` (recipes, troubleshooting) + `evals/`. Unrelated to the `dnd-campaign-toolkit` pipeline.

### `boxaid-call-ops/` — Claude Code plugin

Closes out a finished Boxaid support call in one deterministic pass. `/call-start` opens a call (Tune-Up Snapshot, scratchpad, call mode armed); `/teardown` fans the write-back artifacts (KB page, call-log row, service report, cover email) over a workflow for-loop, verifies each adversarially for PII and convention, then splits them into what Claude writes and what the operator commits by hand. Layout: `commands/`, `agents/`, `hooks/` — no skills.

The fan-out's non-optionality is the point. It replaced three older skills whose report step was model-judged and optional, so a routine call often produced only one leg. Do not reintroduce a model judgment about whether a leg runs.

Depends on loose sidecars living in the *consumer* repo (the workflow `.js`, `report-template.html`, and the call-mode hooks), not shipped here.

### `sequencer-workspace/` and `docs/`

`sequencer-workspace/` holds eval iteration outputs for the `sequencer` skill. `docs/` holds the design record: `docs/superpowers/specs/` (designs) and `docs/superpowers/plans/` (implementation plans), chiefly for `professor-orb`. Both are development/reference material, not shipped components — but the specs are authoritative about *why* professor-orb behaves as it does, so read the relevant one before changing behavior it describes.

## Security note

Secrets are kept out of git via `.gitignore`: `client_secret_*.json`, `.dev.vars`, `.env*`, `.claude/settings.local.json`, `.wrangler/`, `node_modules/`, and build artifacts (`*.zip`, `*.plugin`). Never commit OAuth client secrets or Wrangler secrets — set deployed Worker secrets with `wrangler secret put`, and keep local dev values in `.dev.vars` (template: `google-tasks-mcp/.dev.vars.example`). The Cloudflare KV namespace ID in `wrangler.jsonc` is a resource identifier, not a credential, and is safe to commit.
