---
name: orb
description: "Menu and orientation skill for professor-orb: shows every skill, agent, command, workflow, and hook the plugin ships, and helps the DM pick what to run next. Use when the user runs /orb, asks what tools are available, what this plugin can do, or what to run next. Reads .professor-orb/pipeline-state.json (if present) to recommend the next session-pipeline step (debrief, then prep, then content and/or chronicler, then the kb-validator agent) and suggests running setup first when no professor-orb install is found yet. Standalone components (setup after first install, homebrew, timeline, /catalog, the validation-sweep workflow) are always available on demand and never presented as a required next step. This skill only reads pipeline state; it never writes pipeline-state.json, conventions.json, or any KB file. It is the on-demand counterpart to the Stop hook's automatic next-step suggestion, not a replacement for it."
---

> **Before you begin:** read `../SHARED-PRINCIPLES.md` and apply its rules throughout this workflow.

# Orb Menu

You are showing a D&D DM what professor-orb can do and helping them decide what to run next. This is the plugin's front door: keep it scannable, no preamble, no filler.

## First: what professor-orb needs from the project

This skill does not need `.professor-orb/conventions.json`. Conventions govern KB frontmatter, folder structure, and writing style, none of which the menu itself touches. The one file this skill reads is `.professor-orb/pipeline-state.json`, for the "what to run next" section below. If that file or the whole `.professor-orb/` directory is missing, that is itself useful information (it means `setup` has not run yet), not an error to recover from.

## What professor-orb is

Professor Orb is a post-session workflow plugin for D&D DMs. Every skill drafts its output and waits for your approval before writing files; `chronicler` and `/catalog` are the only components that write anything to the knowledge base, and only after explicit approval.

**Session pipeline:** debrief > prep > content / chronicler > kb-validator (agent)

**Standalone, on demand, never part of pipeline state:** setup (after the first install), homebrew, timeline, `/catalog`, the validation-sweep workflow, and orb itself.

## Components

| Component | Type | Purpose | Invoke |
|---|---|---|---|
| setup | Skill | One-time onboarding (plus on-demand resync) that produces `.professor-orb/` (conventions, pipeline state, tag registry, proposals) and copies the validation-sweep workflow into the project | Installing professor-orb into a project, or when `.professor-orb/` is missing or looks stale |
| debrief | Skill | Turn a just-played session into a structured session report, then hand off to the `lore` agent for KB cross-referencing | "debrief me," "write up last night's session," "session report" |
| prep | Skill | Build a session brief with the DM: work review, recap, north stars, handout list | "plan next session," "session prep," "what do I need to prep" |
| content | Skill | Generate player-facing recaps, handouts, setpieces, and timeline visualizations from a session report | "write the recap," "draft the letter from X," "boxed text," "player-facing timeline" |
| chronicler | Skill | Draft a KB lore-update proposal from the session report and execute it after DM approval. The only pipeline skill that writes the KB | "update the lore," "canonize last session," "apply the session changes" |
| timeline | Skill | Build or maintain campaign chronology documents, or answer a temporal question; spawns `historian` and runs temporal triage on flagged inconsistencies | "build a timeline," "when did X happen," "update the chronology" |
| homebrew | Skill | D&D 5.5e (2024 rules) homebrew design, review, and balance assistant; points to `/catalog` once a design is locked | Any homebrew design, workshopping, balance, or rules-language question |
| orb | Skill | This menu: what is available and what to run next | `/orb`, "what tools are available," "what should I run next" |
| lore | Agent (read-only) | Cross-references session events against the KB and drafts a lore-update proposal | Spawned automatically at the end of `debrief`, or on demand for a lore/contradiction check |
| historian | Agent (read-only) | Chronological indexing, calendar conversion, temporal consistency checks | Spawned by `timeline` (and by `content` for timeline visualizations), or on demand for a temporal query |
| kb-validator | Agent (read-only) | Audits KB article frontmatter, cross-references, index ownership, and filenames against `conventions.json` | After a `chronicler` pass, or on demand for a KB health check |
| /catalog | Command | Capture one locked, post-tweak piece of homebrew (the DM's final as-built Foundry HTML) into the homebrew catalog | `/catalog` with the locked HTML pasted |
| validation-sweep | Workflow | Whole-KB convention audit at scale: a read-only scan phase, then an approved fix phase | Via the Workflow tool, from `.claude/workflows/validation-sweep.mjs` (copied there by `setup`) |
| write-time validator | Hook (PostToolUse) | Validates a just-written KB article's frontmatter against `conventions.json` | Automatic on every Write/Edit; silent on success |
| pipeline-next | Hook (Stop) | Suggests the next session-pipeline step after a pipeline skill finishes | Automatic; silent when there is nothing to suggest |

## What to run next

Read `.professor-orb/pipeline-state.json` if it exists, and check its `lastStep`, `sessionDate`, and `updatedAt` fields.

- **`.professor-orb/` missing, or `pipeline-state.json` missing.** Nothing has been set up yet. Suggest running `setup` first; little else works reliably without it.
- **`pipeline-state.json` exists but has no `lastStep`** (the empty `{}` that `setup` writes on first install). Setup has run but the pipeline has not started. Suggest `debrief` as the first step.
- **`lastStep` is `"debrief"`.** Suggest `prep` next, or `chronicler` if the DM wants the KB updated before planning the next session.
- **`lastStep` is `"prep"`.** Suggest `content` (recaps and handouts) and/or `chronicler` (KB updates); either or both can run from here.
- **`lastStep` is `"content"`.** Suggest `chronicler` if the KB has not been updated for this session yet, or `timeline` if the DM wants chronology work.
- **`lastStep` is `"chronicler"`.** Suggest running the `kb-validator` agent to audit what changed, and `timeline` if chronology needs updating.
- **Any other or unrecognized `lastStep`.** Say what state you found and ask the DM directly rather than guessing.

Mention `sessionDate` when you report the suggestion, so the DM knows which session's progress this reflects. Standalone components (`homebrew`, `timeline`, `/catalog`, the validation-sweep workflow) never count as a required next step; note that they remain available at any time regardless of pipeline state.

This is the on-demand version of the Stop hook's automatic suggestion. The Stop hook already prints a next-step line after a pipeline skill finishes; orb exists for when the DM asks directly, mid-conversation, or wants the fuller menu alongside the same answer. Neither replaces the other.

## Presenting choices

When more than one next action is genuinely viable (for example, both `content` and `chronicler` are open after `prep`), or when the DM wants to browse the standalone tools, present the options as a structured pick-one (or pick-several) menu with AskUserQuestion rather than a plain-text list to click through mentally. Open-ended questions about what a component does or how it works stay free-form chat; only the actual choice of what to run needs the structured tool.

## Things to never do

- **Never write `.professor-orb/pipeline-state.json`.** Orb reads it; only `debrief`, `prep`, and `chronicler` write it.
- **Never write `conventions.json`, KB articles, or any other file.** This skill is display-only.
- **Never claim to be the only source of next-step guidance.** The Stop hook already does this automatically; orb is the on-demand complement.
- **Never guess at `lastStep` values not covered above.** If the state file looks unfamiliar or malformed, say so and ask.

## Closing

End with: "What would you like to do?"
