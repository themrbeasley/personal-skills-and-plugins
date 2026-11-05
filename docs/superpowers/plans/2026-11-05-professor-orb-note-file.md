# Professor-orb Note File Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `debrief` and `prep` keep a running note file on disk for the length of the job, so a rambling account, a context compaction, or a closed session loses nothing, and the file is gone when the job ends.

**Architecture:** One rule in `SHARED-PRINCIPLES.md` Principle 8 defines the note file: where it lives, how it opens, how it is kept, how it closes. `debrief` and `prep` say when to use it. Every line elsewhere that restated "no files at all" is narrowed to name what it actually gates, the output.

**Tech Stack:** Markdown skill text; Node built-ins for the test, no framework.

**Spec:** None separate. The design record is the section below.

## Design record

**Root cause.** `debrief` has told the DM "I'll take notes" since the first commit (2026-06-21, `5aa7180`, which read "mentally note"), and it told Claude to "keep a running list" and hand that list to `lore` in Phase 4. Principle 8 and the skill's own never-do list barred any file to keep them in, and Principle 2 barred any write before approval. So the notes could live only in the conversation.

**Origin of the ban.** Present word for word in `5aa7180`, the repo's first commit, in `dnd-campaign-toolkit/skills/SHARED-PRINCIPLES.md:47`. Ported to professor-orb unchanged on 2026-07-09 (`9cd3a3f`, `d2f0ee7`, `8cc105f`). No commit message, spec, or plan records a reason. Earlier history is outside this repo.

**Earlier scratchpad.** No version of any professor-orb or `dnd-campaign-toolkit` skill told Claude to keep one. The word in this repo's history belongs to Boxaid's `/call-start` (`4b1268e`, 2026-07-11: `call/scratchpad.md`, "the only thing that survives a context squeeze").

**Where the file lives: `.professor-orb/proposals/notes-<skill>-<campaign>.md`.**

| Requirement | Evidence |
|---|---|
| Stays out of tracked content | Setup's `.gitignore` policy ignores `.professor-orb/proposals/`; `rolara-project/.gitignore:26` carries it, so no resync is needed |
| Clear of the write-time validator | `validate-write.mjs:1335` exits when no prong root contains the path |
| Clear of the exclusion wall | `block-excluded.mjs:305` exits for a path outside every prong root |
| A correction reaches it | `dm-correction.mjs:144` searches that folder, `:309` walks `.md` only |
| Nothing mistakes it for a proposal | `chronicler` and `/migrate` read their proposals by exact name; nothing lists the folder |

A new `.professor-orb/notes/` folder was rejected: existing projects do not ignore it, so it would show in `git status` and could be swept up by a `/migrate` snapshot until each project resynced.

**Other skills.** `prep` gets the note file: its Step 1b answers feed the Work Review and exist nowhere else until the brief is approved, and it usually runs in the same conversation as `debrief`, when context is fullest. `chronicler` does not: its inputs are on disk and its proposal file already holds its working state. Any other skill or command may open one when the DM's talk runs long.

**Version.** `/land` proposes the bump at landing and commits it alone. Professor-orb has no changelog. Neither is touched on this branch.

## Global Constraints

- State each instruction as the action to take, then the mechanism that makes it correct.
- No em dashes, and no double hyphens used as dashes, in anything written, commit messages included.
- Every instruction keys to something observable: re-read before each question round rather than "after a compaction", which a model cannot reliably detect.
- `.professor-orb/` is created only by `setup`.

## Review Focus

1. A note file already exists when a run opens, because an earlier run stopped early. Expected: read it, say what it holds, ask once whether to pick up or start clean. Pinned by the text checks and the fresh-agent scenario in Task 3.
2. Setup never ran, so `.professor-orb/` is absent. Expected: the file goes under the system temp directory and `.professor-orb/` is not created. Pinned by the text checks.
3. The DM corrects a detail mid-debrief. Expected: the hook lists the note file among the copies, and the line is fixed there. Pinned by the `dm-correction` case in Task 1.
4. A picked question option lands in the notes and then in the report. Expected: notes record the DM's words, so `contentOptionEcho` has nothing to refuse. Pinned by the fresh-agent scenario in Task 3.
5. A real compaction mid-interview. Expected: the re-read before the next round restores everything. Not testable from here; the fresh-agent scenario checks the instruction reads that way, and the report says so.

---

### Task 1: The failing test

**Files:**
- Create: `professor-orb/skills/note-file.test.mjs`

- [x] **Step 1: Write the test.** Hook half, driving the real hooks with a disposable project: `validate-write` blocks a bad file in a prong (control) and stays silent on the same content at the note path; `block-excluded` refuses a tagged article in a prong (control) and passes the note; `dm-correction` names the note file in its copies; a `.gitignore` built from setup's "Ignored" line ignores the note. Text half: no skill, agent, or command carries the old ban or its absolute "no files" restatements; Principle 8 names the path; Principle 2 names the note file; `debrief` and `prep` open the file, then delete it, then reach the final act, in that order.
- [x] **Step 2: Run it and watch the text half fail.** `node professor-orb/skills/note-file.test.mjs`. Expected: hook half passes, because the location was chosen for this; text half fails on every ban line.

### Task 2: The rule and the skills

**Files:**
- Modify: `professor-orb/skills/SHARED-PRINCIPLES.md` (Principles 2 and 8)
- Modify: `professor-orb/skills/debrief/SKILL.md`, `professor-orb/skills/prep/SKILL.md`
- Modify: `professor-orb/skills/timeline/SKILL.md`, `content/SKILL.md`, `forge-prompt/SKILL.md`, `orb/SKILL.md`, `setup/SKILL.md` (narrow "no files" to the output; name the note file in `proposals/`)
- Modify: `professor-orb/CONTEXT.md`, `professor-orb/README.md`

- [x] **Step 1: Make the edits.**
- [x] **Step 2: Run the test and watch it pass.**

### Task 3: Verify and commit

- [x] **Step 1: Run every suite.** `for f in $(find professor-orb -name "*.test.mjs" | sort); do node "$f" || break; done`. Expected: each exits 0.
- [x] **Step 2: Read `debrief` and Principles 2 and 8 end to end** for contradictions and for em dashes.
- [x] **Step 3: Rerun the baseline scenario with a fresh agent against the new text.** Baseline answer on the old text: no path, no file allowed, re-ask the DM after a compaction, material gone if the session dies.
- [x] **Step 4: Commit on the branch.** Leave pushing and the version bump to `/land`.
