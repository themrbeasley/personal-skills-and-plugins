# Professor Orb

A Claude Code plugin for D&D Dungeon Masters managing a campaign knowledge base. It covers the post session workflow loop: turning a played session into a structured report, planning the next one, writing player facing content, updating the lore, keeping a chronology, and designing homebrew.

## Architecture overview

Professor Orb ships as a standard Claude Code plugin: skills, agents, five commands, a pair of hooks, and two workflow scripts, declared in `.claude-plugin/plugin.json`.

Two facts govern everything else in this plugin:

1. **Professor-orb brings the structural schema; the consumer project is the source of truth for campaign facts and content.** Index rules, frontmatter schema, and filename conventions are professor-orb's own, shipped as rules at `references/base-rules.json`. Folder layout is professor-orb's too, laid down by setup as the canonical layout rather than carried in that file. Wikilink format is not: the base set ships no rule for it, and a project that wants one adds it as an extra. Every skill that touches the knowledge base still learns the consumer project's campaign facts, writing style, and content exclusions from `CLAUDE.md` rather than assuming those.
2. **Machine readable conventions live in `.professor-orb/conventions.json`.** The `setup` skill generates this file (and the rest of `.professor-orb/`) by instantiating professor-orb's base rule set and layering in a project-specific extras layer discovered during onboarding. Every other skill and hook reads `conventions.json` first because it is a precise, checkable source, not a derivation of the consumer's prose. When it is missing (setup has not run yet, or the install predates it), skills fall back to professor-orb's base schema directly and say that setup has not run.

Setup also produces the rest of `.professor-orb/`: `pipeline-state.json` (a breadcrumb of the last completed pipeline step), `tag-registry.json` (a tag inventory for drift tracking), and a `proposals/` directory the chronicler skill writes lore-update proposals into. If the project already has a human-readable conventions document, setup folds it into the extras layer of `conventions.json` and can offer to retire the source document with a pointer paragraph in `CLAUDE.md`. Setup also copies `workflows/migrate.mjs` and `workflows/validation-sweep.mjs` into the consumer project's `.claude/workflows/`, since a plugin cannot ship workflow files directly into a consumer's workflow folder.

## Components

| Component | Type | Purpose | Invoke |
|---|---|---|---|
| setup | Skill | One-time onboarding (plus on-demand resync) that produces `.professor-orb/` and copies `migrate.mjs` and the validation sweep workflow into the project | Installing the plugin into a project, or when `.professor-orb/` is missing or stale |
| orb | Skill | Menu and orientation: shows every component and recommends what to run next based on pipeline state | `/orb`, "what tools are available," "what should I run next" |
| debrief | Skill | Turns a just-played session into a structured session report, then hands off to the `lore` agent for KB cross-referencing | "debrief me," "write up last night's session," "session report" |
| prep | Skill | Builds a session brief with the DM: work review, recap, planned scenes, handout list | "plan next session," "session prep," "what do I need to prep" |
| content | Skill | Generates player-facing recaps, handouts, setpieces, and timeline visualizations from a session report | "write the recap," "draft the letter from X," "boxed text" |
| chronicler | Skill | Drafts a knowledge base update proposal from the session report and executes it after DM approval. The only pipeline skill that writes the KB | "update the lore," "canonize last session," "apply the session changes" |
| timeline | Skill | Builds or maintains campaign chronology documents, or answers a temporal question; spawns the `historian` agent | "build a timeline," "when did X happen," "update the chronology" |
| homebrew | Skill | D&D 5.5e (2024 rules) homebrew design, review, and balance assistant; points to `/catalog` once a design is locked | Any homebrew design, workshopping, balance, or rules-language question |
| forge-prompt | Skill | Image-generation prompt craft for FLUX.2 and ComfyUI: forge a new prompt, write an edit prompt against an approved image, or diagnose one that underperformed. Runs an iterative loop that keeps invented detail in the suggestions rather than the prompt, saves to the campaign's `prompts/` directory, and can record a house style in `CLAUDE.md` on approval | `/forge-prompt`, "write an image prompt," "edit this image," "fix this prompt" |
| lore | Agent (read-only) | Cross-references session events against the knowledge base and drafts a lore-update proposal | Spawned automatically at the end of `debrief`, or on demand |
| historian | Agent (read-only) | Chronological indexing, calendar conversion, temporal consistency checks | Spawned by `timeline` (and by `content` for timeline visualizations), or on demand |
| kb-validator | Agent (read-only) | Audits article frontmatter, cross-references, index ownership, and filenames against `conventions.json` | After a `chronicler` pass, or on demand for a health check |
| /catalog | Command | Captures one finalized, DM-confirmed piece of homebrew as a type-specific, versioned catalog entry, and maintains it across its playtest life | `/catalog` with the finalized homebrew pasted or referenced, or a name/type to catalog |
| /scribe | Command | Commits the setting KB lane (`settings/<setting>/`): what `chronicler` and `timeline` wrote, plus the DM's own Obsidian edits. Authors no KB content itself | `/scribe`, "commit the lore," "commit the KB changes" |
| /log | Command | Commits the session-reports lane (`session-reports/<setting>/<campaign>/`): reports, prep briefs, recaps, handouts, and prompts. Sets an unfinished report aside by name and commits the rest | `/log`, "commit the session report," "commit the recap" |
| /genesis | Command | Creates a new setting: three prong folders scaffolded to professor-orb's layout, a vault, a tag registry, and a conventions.json entry. Adopts a folder tree that already exists rather than refusing it | `/genesis`, "start a second world", "new setting", "new campaign world" |
| /migrate | Command | Restructures the knowledge base to a DM-stated scope, or to setup's deferred items and the sweep's needs-judgment findings. Writes a proposal the DM may edit, then executes exactly what the approved file says, landing a preparation commit and a migration commit whose combined undo is two git reverts | `/migrate`, "clean up items/", "rename X to Y everywhere", "retire the Karsk campaign" |
| /sweep | Command | Runs the validation sweep: a read-only scan across every setting, presented as mechanically-fixable and needs-judgment buckets, then an approved fix phase. The only invocation path for `validation-sweep.mjs` | `/sweep`, "run a validation sweep", "audit the knowledge base", "check for convention violations" |
| migrate | Workflow | Migration executor shared by setup's onboarding migration, `/migrate`, and `/genesis`: a mutation-free plan phase, then an apply phase that moves files with `git mv` and asserts link integrity before committing | Via the Workflow tool, from `.claude/workflows/migrate.mjs` (copied there by `setup`); run during setup's onboarding migration, by `/migrate`, and by `/genesis` |
| validation-sweep | Workflow | Whole-KB convention audit at scale: a read-only scan phase, then an approved fix phase | Via the Workflow tool, from `.claude/workflows/validation-sweep.mjs` (copied there by `setup`); run by `/sweep` |
| write-time validator | Hook (PostToolUse) | Validates a just-written article's frontmatter against `conventions.json` | Automatic on every Write/Edit; silent on success |
| pipeline-next | Hook (Stop) | Suggests the next session-pipeline step after a pipeline skill finishes | Automatic; silent when there is nothing to suggest |

## Pipeline flow

The session pipeline is the core mental model. Four steps, in order:

```
debrief --> prep --> content   --\
              |                   >--> kb-validator (agent)
              \--> chronicler --/
```

- **debrief** captures the session and hands off to the `lore` agent.
- **prep** builds the next session's brief.
- **content** and **chronicler** are both open after prep; either or both can run, in either order.
- **kb-validator** audits whatever chronicler changed.

Each pipeline skill's last act is writing `.professor-orb/pipeline-state.json` with the step that just completed, the session date, and a timestamp. Only `debrief`, `prep`, `content`, and `chronicler` write this file. The Stop hook (`pipeline-next.mjs`) reads it to suggest the next step automatically, and the `orb` skill reads the same file on demand for the same purpose.

**Standalone components**, never part of pipeline state: `setup` (after the first install), `homebrew`, `timeline`, `forge-prompt`, `/catalog`, `/scribe`, `/log`, `/migrate`, and `/sweep`. These run on demand at any point regardless of where the pipeline stands, and none of them write `pipeline-state.json`.

## Design philosophy

**Professor-orb brings the structural schema; the consumer project owns its content.** `conventions.json` is checked first because it is machine-checkable; `CLAUDE.md` is the fallback for campaign facts and content, never for structure. No skill hardcodes a path.

**Approval before mutation.** All three agents (`lore`, `historian`, `kb-validator`) are read-only: they analyze and propose, never write. `debrief`, `prep`, `content`, `chronicler`, `timeline`, and `/catalog` write to the knowledge base, each only after DM approval: `debrief`, `prep`, `content`, and `timeline` present a draft for DM review before writing it, `chronicler` and `timeline`'s hand-offs for corrections and declarations route through a written proposal the DM reviews before execution, and `/catalog` treats the DM's own act of invoking it on homebrew already finalized and confirmed as that approval, with one exception: the Design Notes block is composed during the session rather than supplied to the command, so an invocation cannot have approved it and it is shown to the DM and confirmed before the write. `/scribe`, `/log`, and `/migrate` are deliberately absent from that list: the first two commit knowledge base content to version control without authoring any of it, so the approval that governs them is the one that already gated the write which put the content on disk, and `/migrate` moves and renames what the others wrote rather than writing anything itself, holding its own plan-and-approve covenant instead, described below. The `validation-sweep` workflow honors the same covenant with its own two-phase design: a scan phase that mutates nothing and returns a report split into mechanically fixable and needs-judgment violations, followed by a fix phase that applies only the fixes the DM approved for that specific run. `/migrate` holds the same covenant in the same shape: a plan phase that mutates nothing and writes a proposal to `.professor-orb/proposals/`, followed by an apply phase that executes exactly what the DM approved in that file.

**Structured input goes through AskUserQuestion.** When a skill needs a real decision from the DM (a go or no-go on a proposal, an ambiguous field, an enforcement level), it asks with AskUserQuestion rather than a plain-text question. Open-ended discussion, brainstorming, and explaining how something works stay free-form chat.

**Hooks are silent on success.** The write-time validator and the pipeline-next suggester only speak up when there is a violation to flag or a next step to suggest. Neither hook narrates what it checked when everything is fine.

**The homebrew catalog records what is real at the table.** `/catalog` writes one type-specific entry per finalized piece of homebrew: its frontmatter stamps a lifecycle status (`playtest`, `active`, `reverted`, `discontinued`) and a version that carries the entry across revisions, while its body blocks preserve the DM's finalized content verbatim, never reformatted or completed. One block is different by design: Design Notes records why the artifact was designed the way it was, as labeled records each answering one design question about it, and is confirmed with the DM before the entry is written. The primary source is the DM's confirmed design, typically the `homebrew` skill's iterated output; reading an exported Foundry actor or item JSON is a Phase 2 capability and not yet available. Catalog entries sit outside the wikilink graph (no cross-references written into them, none pointing at them), but each one is still listed in its owning homebrew index so it stays discoverable.

## Getting started

1. Install the plugin.
2. In your campaign project, run the `setup` skill. It will apply professor-orb's base schema, discover your project's extras (or ask about them), produce `.professor-orb/conventions.json` plus the rest of `.professor-orb/`, and propose a folder-index parity migration if your existing KB needs one.
3. Run `/orb` to see everything the plugin can do and what it recommends running next.
