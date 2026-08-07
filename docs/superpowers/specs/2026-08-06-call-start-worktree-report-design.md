# Boxaid Call-Ops Handoff: CRLF Root Cause and `/call-start` Worktree Report

**Date:** 2026-08-06
**Status:** Draft for review
**Scope:** Two repos. `boxaid-call-ops/commands/call-start.md` in this monorepo, and three changes in the consumer repo at `C:\Users\jorda\OneDrive\Documents\Claude\Projects\Boxaid Work` (operator granted explicit access on 2026-08-06).

## Summary

The handoff document at `%TEMP%\boxaid-teardown-plugin-handoff.md` proposed three changes and attributed the blocking failure to a Claude Code host bug. Direct inspection of the consumer repo disproves that attribution. The blocking failure has a mundane, fully-evidenced cause: `core.autocrlf` rewrites the workflow script's line endings on every fresh worktree checkout, and the resulting carriage returns are the control characters the Workflow tool rejects.

## Finding 1: the CRLF cause is proven, and the host-bug claim is not

The handoff states:

> Both copies of `teardown-close-out.js` scan byte-clean and Unicode-clean. No control characters, no BOM, no zero-width or line-separator characters.

That scan was run against the wrong copy. Measured on 2026-08-06 by raw byte count (`od`, corroborated by `file(1)` and hexdump, after an initial `grep` measurement proved unreliable and was discarded):

| Checkout | CR bytes | LF bytes |
|---|---|---|
| `Boxaid Work` (main working tree) | 0 | 232 |
| `.claude/worktrees/cranky-rubin-7348ae` | 232 | 232 |
| `.claude/worktrees/malware-notifications-chrome-4637b1` | 232 | 232 |
| `.claude/worktrees/serene-haibt-549c5e` | 232 | 232 |
| `.claude/worktrees/teamviewer-two-pc-setup-ca46aa` | 232 | 232 |

The mechanism: `core.autocrlf` is `true` on this machine and the repo ships no `.gitattributes`. That setting converts LF to CRLF **on checkout**. The main working tree's copy was written by an editor and committed without ever being re-checked-out, so it kept LF. Every worktree is created by a fresh checkout, so every worktree copy is converted. The operator runs `/teardown` in worktrees, which is why the failure was total there and invisible in main.

A carriage return (0x0D) is a control character. The rejection message named control characters. The stored blob and the main working copy are both clean, which is why a scan of either found nothing.

**Consequence for the handoff's action items.** Two of its instructions are withdrawn by this spec:

- "Report upstream to Anthropic" is dropped. No host defect has been demonstrated.
- The permanent inline-script workaround in `/teardown` is not adopted as a permanent measure. Whether by-name and by-path resolution work once line endings are pinned is a testable question, and the test has not been run.

This spec does not claim the CRLF differential is the *only* possible contributor to the original error. It claims the differential is real, sufficient to produce that error, and untested as a fix. The verification step below settles it.

## Finding 2: the consumer repo is otherwise healthy

Surveyed read-only before any change:

- All five worktrees and the main tree are clean. No uncommitted or untracked work anywhere.
- Every branch is merged into `main`. Nothing is stranded.
- `origin` is intact at `https://github.com/themrbeasley/boxaid-kb.git`.
- All four mirrored files (`call-start.md`, `teardown.md`, `capture-call.md`, `service-report.md`) are byte-identical to this monorepo's canonical copies once trailing carriage returns are ignored. There is no drift to reconcile.

The uncommitted backlog the handoff describes (four calls' worth of pages, three on no branch) was resolved during the 2026-08-06 session and no longer exists.

## Change 1: pin the workflow sidecars to LF (consumer repo)

Add a `.gitattributes` at the consumer repo root pinning only the two sidecar files:

```
.claude/workflows/*.js   eol=lf
.claude/workflows/*.html eol=lf
```

Scoped deliberately to `.claude/workflows/`. A repo-wide `* text=auto eol=lf` would fix the same class of problem for the PowerShell hooks, but it rewrites every tracked file at once on a live work repo, and no hook has exhibited this failure. This mirrors the precedent already set in this monorepo's own `.gitattributes` for `professor-orb/workflows/*.mjs`.

The file carries a comment recording the mechanism, matching the professor-orb precedent and this repo's convention that a guard explains the invariant it holds.

## Change 2: refresh the four stale worktree copies (consumer repo)

The four existing worktrees hold CRLF copies that predate the fix and will not self-correct, because `.gitattributes` governs checkout and those files are already on disk. Each worktree's two sidecar files get deleted and re-checked-out so they pick up the pinned attribute.

Safe to do unconditionally here because every worktree is verified clean. If any worktree had uncommitted work this step would need per-worktree review instead. The check is re-run immediately before the refresh rather than trusting this spec's survey.

## Change 3: harden the args guard (consumer repo)

`teardown-close-out.js` carries this line, which must survive:

```js
const input = (typeof args === 'string' && args.trim() ? JSON.parse(args) : args) || {}
```

The host delivers `args` as a JSON string, so reading `args.foo` directly yields `undefined`. The failure is silent: subagents receive an empty payload, find a plausible older artifact on disk, and return confident findings about superseded content. This happened during the 2026-08-06 session. Two review passes silently reviewed a stale artifact before a third reported the empty payload.

Two changes:

1. Throw on an empty or missing payload instead of proceeding with `{}`.
2. Instruct verifier agents to fail on an empty payload rather than locate another source, and to review only the inline payload they were given.

## Change 4: `/call-start` cross-worktree report (both repos)

### Problem

Parallel worktrees give work nowhere to be loud. Nothing surfaces work that was done but never committed, or committed but never merged. The 2026-08-06 session lost time to exactly this: four calls' worth of uncommitted pages in the main tree, and a branch whose committed-but-unmerged work a first sweep missed because "already committed" was checked against the branch rather than against `main`.

### Placement

`call-start.md` runs at two speeds: Speed 1 serves the Tune-Up Snapshot with no lookups and no delay, Speed 2 gives the KB briefing when a symptom was passed. The report becomes a step between them, in the same first response, after the snapshot command is already on screen. It never gates Speed 1.

### Checks

1. List every worktree and its branch (`git worktree list`).
2. Count real changes per worktree using `git diff`, not `git status`. The handoff documents that `git status` can mark a file modified with an empty diff, and on this machine that false positive has the same root cause as the bug above. A report meant to catch real risk must not fire on line-ending noise.
3. Check merge state with `git branch --no-merged main`, not by testing whether a branch has commits.
4. Flag a dirty `main` working tree on its own line. It belongs to no feature branch and is the easiest to overlook.

### Output and failure behavior

Roughly four lines. A single "nothing else open" line when no other worktrees exist. A worktree that git remembers but that is gone from disk reports as needing `git worktree prune`. A detached-HEAD worktree reports as detached rather than erroring. Nothing in this step may throw or delay `/call-start`; worst case it is skipped and the snapshot still ships on time.

### Mirror obligation

`commands/call-start.md` is canonical in this monorepo and mirrored into the consumer repo's `.claude/commands/`. Both copies change together, matching the registration model in `boxaid-call-ops/README.md`.

## Out of scope

`log.d/`, the one-file-per-entry log split, stays deferred. The handoff evaluated it and recommended against, and the 2026-08-06 JSONL migration already removed the worst of the conflict pain. Nothing here revisits it.

## Verification

The CRLF fix is verified by measurement, not assertion:

1. Re-run the byte count across all worktrees. Every copy reads CR=0.
2. Create a throwaway worktree and confirm its fresh checkout also reads CR=0. This is the case the fix exists for, and the only one that proves the attribute is doing its job.
3. Attempt `Workflow({ name: "teardown-close-out", ... })` by name. If it resolves, the host-bug theory is dead and the inline workaround is unnecessary. If it still fails with a clean-LF file, the theory survives and gets recorded as still open, with the new evidence attached.

Step 3 is the one that decides whether anything is owed to Anthropic. It runs before any upstream report is written.

`/call-start` has no automated harness in this plugin the way the hooks do (`hooks/tests/test-kill-guard.ps1`). It is verified by running it against: a clean single worktree, a worktree with uncommitted changes, a committed-but-unmerged branch, a dirty `main`, and a stale worktree entry pointing at a deleted folder.
