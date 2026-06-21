# Personal Skills and Plugins

A personal collection of Claude Code skills, plugins, and a Cloudflare-Workers MCP server. Each top-level directory is an independent, self-contained project.

## Contents

- **[dnd-campaign-toolkit/](dnd-campaign-toolkit/)** — Claude Code plugin: a post-session workflow suite for D&D DMs (debrief → prep → content / chronicler pipeline, plus homebrew design and timeline tools).
- **[google-tasks-mcp/](google-tasks-mcp/)** — Remote MCP server exposing Google Tasks via OAuth, built on Cloudflare Workers + Durable Objects.
- **[sequencer/](sequencer/)** — A Claude Code skill for building Foundry VTT Sequencer visual-effect macros (integrates with Midi-QOL, DAE, and Portal).
- **docs/** — Design specs and implementation plans.

See [CLAUDE.md](CLAUDE.md) for architecture notes and per-project commands.

## Security

Secrets are kept out of version control via `.gitignore` — OAuth client secrets, `.dev.vars`/`.env` files, local Claude settings, and build artifacts are never committed. See the security note in [CLAUDE.md](CLAUDE.md) for details.
