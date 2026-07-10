# Professor Orb

A Claude Code plugin for D&D Dungeon Masters managing a campaign knowledge base. It covers the post session workflow loop: turning a played session into a structured report, planning the next one, writing player facing content, updating the lore, keeping a chronology, and designing homebrew, all against whichever knowledge base structure the DM already uses.

## Architecture overview

Professor Orb ships as a standard Claude Code plugin: skills, agents, one command, a pair of hooks, and a workflow script, declared in `.claude-plugin/plugin.json`.

Two facts govern everything else in this plugin:

1. **The plugin is configuration; the consumer project is the source of truth.** No skill hardcodes a folder layout, a frontmatter schema, or a filename convention. Every skill that touches the knowledge base starts by learning the consumer project's actual conventions rather than assuming a shape.
2. **Machine readable conventions live in `.professor-orb/conventions.json`.** The `setup` skill generates this file (and the rest of `.professor-orb/`) by deriving rules from the consumer project during onboarding. Every other skill and hook reads `conventions.json` first because it is a precise, checkable derivation. When it is missing (setup has not run yet, or the install predates it), skills fall back to reading the consumer project's `CLAUDE.md` directly.

Setup also produces the rest of `.professor-orb/`: `pipeline-state.json` (a breadcrumb of the last completed pipeline step), `tag-registry.json` (a tag inventory for drift tracking), and a `proposals/` directory the chronicler skill writes lore-update proposals into. On a first-time run, when the project has no existing conventions document, setup drafts a `KB-CONVENTIONS.md` alongside `conventions.json` so the project ends up with both a human-readable and a machine-readable copy of its own rules. Setup also copies `workflows/validation-sweep.mjs` into the consumer project's `.claude/workflows/`, since a plugin cannot ship a workflow file directly into a consumer's workflow folder.

## Components

| Component | Type | Purpose | Invoke |
|---|---|---|---|
| setup | Skill | One-time onboarding (plus on-demand resync) that produces `.professor-orb/` and copies the validation sweep workflow into the project | Installing the plugin into a project, or when `.professor-orb/` is missing or stale |
| orb | Skill | Menu and orientation: shows every component and recommends what to run next based on pipeline state | `/orb`, "what tools are available," "what should I run next" |
| debrief | Skill | Turns a just-played session into a structured session report, then hands off to the `lore` agent for KB cross-referencing | "debrief me," "write up last night's session," "session report" |
| prep | Skill | Builds a session brief with the DM: work review, recap, planned scenes, handout list | "plan next session," "session prep," "what do I need to prep" |
| content | Skill | Generates player-facing recaps, handouts, setpieces, and timeline visualizations from a session report | "write the recap," "draft the letter from X," "boxed text" |
| chronicler | Skill | Drafts a knowledge base update proposal from the session report and executes it after DM approval. The only pipeline skill that writes the KB | "update the lore," "canonize last session," "apply the session changes" |
| timeline | Skill | Builds or maintains campaign chronology documents, or answers a temporal question; spawns the `historian` agent | "build a timeline," "when did X happen," "update the chronology" |
| homebrew | Skill | D&D 5.5e (2024 rules) homebrew design, review, and balance assistant; points to `/catalog` once a design is locked | Any homebrew design, workshopping, balance, or rules-language question |
| lore | Agent (read-only) | Cross-references session events against the knowledge base and drafts a lore-update proposal | Spawned automatically at the end of `debrief`, or on demand |
| historian | Agent (read-only) | Chronological indexing, calendar conversion, temporal consistency checks | Spawned by `timeline` (and by `content` for timeline visualizations), or on demand |
| kb-validator | Agent (read-only) | Audits article frontmatter, cross-references, index ownership, and filenames against `conventions.json` | After a `chronicler` pass, or on demand for a health check |
| /catalog | Command | Captures one locked, post-tweak piece of homebrew (the DM's final as-built Foundry HTML) into the homebrew catalog | `/catalog` with the locked HTML pasted |
| validation-sweep | Workflow | Whole-KB convention audit at scale: a read-only scan phase, then an approved fix phase | Via the Workflow tool, from `.claude/workflows/validation-sweep.mjs` (copied there by `setup`) |
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

**Standalone components**, never part of pipeline state: `setup` (after the first install), `homebrew`, `timeline`, `/catalog`, and the `validation-sweep` workflow. These run on demand at any point regardless of where the pipeline stands, and none of them write `pipeline-state.json`.

## Design philosophy

**The consumer project owns its conventions.** The plugin discovers them rather than imposing a schema. `conventions.json` is checked first because it is machine-checkable; `CLAUDE.md` is the fallback when it is missing. No skill hardcodes a path, a folder name, or a frontmatter field.

**Approval before mutation.** All three agents (`lore`, `historian`, `kb-validator`) are read-only: they analyze and propose, never write. Of the skills and commands, only `chronicler` and `/catalog` write to the knowledge base, and only after explicit DM approval, chronicler through a written proposal the DM reviews before execution, and `/catalog` through the DM's own act of pasting the locked HTML into the command, which stands in as that approval. The `validation-sweep` workflow honors the same covenant with its own two-phase design: a scan phase that mutates nothing and returns a report split into mechanically fixable and needs-judgment violations, followed by a fix phase that applies only the fixes the DM approved for that specific run.

**Structured input goes through AskUserQuestion.** When a skill needs a real decision from the DM (a go or no-go on a proposal, an ambiguous field, an enforcement level), it asks with AskUserQuestion rather than a plain-text question. Open-ended discussion, brainstorming, and explaining how something works stay free-form chat.

**Hooks are silent on success.** The write-time validator and the pipeline-next suggester only speak up when there is a violation to flag or a next step to suggest. Neither hook narrates what it checked when everything is fine.

**The homebrew catalog records what is real at the table.** `/catalog` stores the DM's final, as-tweaked Foundry HTML verbatim, byte for byte, never reformatted or completed. Catalog entries sit outside the wikilink graph (no cross-references written into them, none pointing at them), but each one is still listed in its owning homebrew index so it stays discoverable.

## Getting started

1. Install the plugin.
2. In your campaign project, run the `setup` skill. It will read (or ask about) your knowledge base's conventions and produce `.professor-orb/conventions.json` plus the rest of `.professor-orb/`.
3. Run `/orb` to see everything the plugin can do and what it recommends running next.
