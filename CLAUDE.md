# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository purpose

Personal collection of Claude Code skills and plugins, plus a Cloudflare-Workers MCP server. Each top-level directory is an independent, self-contained project — there is no shared build, root package, or cross-project tooling.

## Projects

### `dnd-campaign-toolkit/` — Claude Code plugin

A post-session workflow plugin for D&D DMs. Ships as a standard Claude Code plugin (`.claude-plugin/plugin.json`) with seven skills, three agents, and two hooks.

Architecture to understand before editing:

- **Session pipeline** is the core mental model: `debrief → prep → content / chronicler → kb-validator`. Skill descriptions are written to chain into each other — each skill's `description` frontmatter names the upstream skill it consumes from and the downstream skill it feeds. The `Stop` hook in `hooks/hooks.json` reinforces these handoffs by suggesting the next step. When editing any skill's description, keep those handoff references consistent or the pipeline breaks.
- **System-agnostic by design.** Skills do not ship templates or assume folder layouts. Every skill begins with a "First: learn the user's system" section that reads the *consumer project's* `CLAUDE.md` to discover KB conventions (folder structure, frontmatter schema, filename suffixes, cross-reference style). The plugin itself is configuration; the consumer's `CLAUDE.md` is the source of truth. Do not hardcode paths or schemas into skills.
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

### `sequencer-workspace/` and `docs/`

`sequencer-workspace/` holds eval iteration outputs for the `sequencer` skill. `docs/` holds design specs and implementation plans. Both are development/reference material, not shipped components.

## Security note

Secrets are kept out of git via `.gitignore`: `client_secret_*.json`, `.dev.vars`, `.env*`, `.claude/settings.local.json`, `.wrangler/`, `node_modules/`, and build artifacts (`*.zip`, `*.plugin`). Never commit OAuth client secrets or Wrangler secrets — set deployed Worker secrets with `wrangler secret put`, and keep local dev values in `.dev.vars` (template: `google-tasks-mcp/.dev.vars.example`). The Cloudflare KV namespace ID in `wrangler.jsonc` is a resource identifier, not a credential, and is safe to commit.
