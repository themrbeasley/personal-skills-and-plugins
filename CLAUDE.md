# CLAUDE.md

Each top-level directory is an independent, self-contained project. No shared build, root package, or cross-project tooling.

## `professor-orb/` — Claude Code plugin (most active)

Post-session workflow plugin for D&D DMs. Skills, four commands, four agents, two hooks, two workflow scripts.

**Professor-orb imposes its own structural schema.** Index rules, frontmatter schema, filename conventions, and folder layout are professor-orb's, shipped in `references/base-rules.json` and laid down by `setup` as the canonical layout. Its purpose is to assign an organization method and pull unorganized or under-organized material into it. From the consumer's `CLAUDE.md` it reads campaign facts, writing style, and content exclusions — never structure.

- **`.professor-orb/conventions.json` is the machine-readable authority.** `setup` generates it from `references/base-rules.json` plus a project extras layer. Every skill and hook reads it first. Schema: `skills/setup/references/conventions-schema.md`.
- **Multi-setting layout.** `conventions.json` carries `settings[]`, one per world, each with three prong roots (`kbRoot`, `homebrewRoot`, `sessionReportsRoot`), its own `rules`, and its own `tagRegistryPath`. `retired`, `mergedInto`, and `retiredCampaigns` are written only by `/migrate` and must survive a resync.
- **Lane commands own one prong each.** `/scribe`, `/log`, `/catalog` never cross prongs and use `:(literal)` pathspecs. `/migrate` is the exception: it restructures across prongs and commits its own work.
- **`workflows/` is real code.** `migrate.mjs` is the migration executor — plan phase read-only by contract, apply phase mutates behind a snapshot commit. `validation-sweep.mjs` is the KB validator. `setup` copies both into the consumer's `.claude/workflows/`.
- **Comment blocks in `migrate.mjs` are load-bearing.** Each records the invariant its guard holds. Read the comment before changing the code under it; update it when the rule changes.
- **Agent `color` must be one of** `red`, `blue`, `green`, `yellow`, `purple`, `orange`, `pink`, `cyan`.

Tests are Node built-ins, no framework. Run a file directly:

```
node professor-orb/workflows/migrate.plan.test.mjs
```

Suites: `workflows/migrate.plan`, `workflows/migrate.apply`, `workflows/migrate.proposal`, `workflows/validation-sweep.ownership`, `hooks/validate-write`, `hooks/pipeline-next`, `commands/lane-staging`.

Designs are in `docs/superpowers/specs/`, implementation plans in `docs/superpowers/plans/`. Read the relevant spec before changing behavior it describes.

## `boxaid-call-ops/` — Claude Code plugin

Closes out a Boxaid support call. `/call-start` opens one (Tune-Up Snapshot, scratchpad, call mode armed). `/teardown` fans the write-back artifacts — KB page, call-log row, service report, cover email — over a workflow for-loop, verifies each adversarially for PII and convention, then splits them into what Claude writes and what the operator commits by hand. Layout: `commands/`, `agents/`, `hooks/`; no skills.

**Every leg of the fan-out runs unconditionally.** No model judgment about whether one is needed.

Depends on sidecars in the *consumer* repo (the workflow `.js`, `report-template.html`, the call-mode hooks), not shipped here.

## `google-tasks-mcp/` — Cloudflare Workers MCP server

Remote MCP server exposing Google Tasks via OAuth. Cloudflare Workers + Durable Objects (`GoogleTasksMCP`, SQLite-backed) + Hono + `@cloudflare/workers-oauth-provider` + `agents` SDK. KV namespace `OAUTH_KV` holds OAuth state.

`src/`: `index.ts` (Worker entry + Durable Object), `google-handler.ts` (OAuth flow), `google-tasks-api.ts` (Tasks client), `workers-oauth-utils.ts` and `utils.ts` (helpers).

Run from `google-tasks-mcp/`:
```
npm run dev          # wrangler dev (local)
npm run deploy       # wrangler deploy
npm run type-check   # tsc --noEmit
npm run cf-typegen   # regenerate worker-configuration.d.ts from wrangler.jsonc bindings
```
Re-run `cf-typegen` after changing bindings in `wrangler.jsonc`. No test suite.

## `sequencer/` — Claude Code skill

Builds Foundry VTT Sequencer visual-effect macros (projectiles, impacts, auras, summoning flourishes). Integrates with Midi-QOL, DAE, and Portal; implements the *visuals*, not game balance. Layout: `SKILL.md` + `references/` + `evals/`. Unrelated to the toolkit pipeline.

## `sequencer-workspace/` and `docs/`

Development material, not shipped. `sequencer-workspace/` holds eval iteration outputs for `sequencer`. `docs/` holds the design record described under professor-orb.

## Security

`.gitignore` keeps secrets out: `client_secret_*.json`, `.dev.vars`, `.env*`, `.claude/settings.local.json`, `.wrangler/`, `node_modules/`, and build artifacts (`*.zip`, `*.plugin`). Never commit OAuth client secrets or Wrangler secrets — set deployed Worker secrets with `wrangler secret put`, keep local dev values in `.dev.vars` (template: `google-tasks-mcp/.dev.vars.example`). The Cloudflare KV namespace ID in `wrangler.jsonc` is a resource identifier, not a credential, and is safe to commit.
