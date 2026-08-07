# `/call-start` Cross-Worktree Report: Design

**Date:** 2026-08-06
**Status:** Draft for review
**Scope:** `boxaid-call-ops/commands/call-start.md` only. No changes to `/teardown`, the workflow script, or any file that lives only in the consumer (Boxaid Work) repo.

## The problem

Mr. Beasley runs support calls in parallel git worktrees on purpose: he starts call #2 in a fresh worktree while `/teardown` is still running on call #1, since a close-out can take 5 to 20 minutes. That's a good workflow. The cost is that parallel worktrees give work nowhere to be loud. Nothing today surfaces work that was done but never committed, or committed but never merged into `main`.

From one session on 2026-08-06 (recorded in the KB repo's `log.jsonl`, seq 94 to 97):

- Four calls' worth of pages and log entries sat uncommitted in the `main` working tree, three of them on no branch and no remote at all, up to ten days old. A single `git checkout .` would have destroyed them.
- One branch had committed but unmerged work that a first sweep missed, because "already committed" was checked against the branch's own history instead of against `main`.
- Two further worktrees held uncommitted pages.
- A parallel session wrote a duplicate of a log entry another session was writing at the same moment, because neither could see the other.

This isn't a one-off. Grilling this branch's own monorepo turned up a live example of the same failure mode: a worktree named `boxaid-call-ops-updates-76d5ff` sitting on this machine right now, its commits already merged into `main` weeks ago, but still carrying an untracked plan file nobody cleaned up. Nobody noticed because nothing ever reported it.

## Non-goals

This spec covers only the `/call-start` reporting change. Two other items from the same handoff are tracked separately and are explicitly out of scope here:

- The CRLF root-cause fix and the `teardown-close-out.js` args guard both live entirely in the consumer repo, which this session cannot reach. They'll be written up as a plan doc after this ships (see "What happens after this ships" below).
- Splitting the call log into one file per entry (`log.d/`) was evaluated and deferred by the handoff itself. Nothing here revisits that.

## Design

### Placement

`call-start.md` runs at two speeds today: Speed 1 serves the Tune-Up Snapshot with no lookups and no delay, and Speed 2 gives the KB briefing if a symptom was passed. The worktree report becomes a new step between them, run in the same first response but only after the snapshot command is already on the page. It never gates or delays Speed 1.

### What it checks

One PowerShell command, run once per `/call-start` invocation:

1. List every worktree and its branch with `git worktree list`.
2. For each worktree, count files with a real change using `git diff`, not `git status`. The handoff already documents why: `git status` can mark a file modified when the actual diff is empty, and that false-positive is the same class of bug as the CRLF/autocrlf mismatch this operator's machine produces on every fresh worktree checkout. A report meant to catch real risk shouldn't cry wolf from the same cause it's supposed to guard against.
3. For each branch, check merge status with `git branch --merged main`, not by checking whether the branch merely has commits. The handoff calls this out directly: a branch can be fully committed and still never have reached `main`.
4. Flag separately, on its own line, if `main`'s own working tree is dirty. The handoff names this the highest-risk case, since it's nobody's feature branch and the easiest to overlook.

### Output shape

Roughly four lines: one summary line per worktree with dirty-file count and branch, one line for any unmerged branch, one line flagging a dirty `main` if applicable. No output at all beyond a single "nothing else open" line when there are no other worktrees.

### Error handling

- A worktree `git worktree list` still remembers but that's gone from disk (a common state after manual cleanup) is reported as needing `git worktree prune`, not treated as a failure.
- A worktree in detached HEAD state shows as detached rather than erroring on the merge-status check.
- The command must not throw or halt `/call-start` on any of the above. Worst case, the worktree report is silently skipped and the snapshot still ships on time.

## Testing

There's no automated test harness for command markdown in this plugin the way there is for hooks (`hooks/tests/test-kill-guard.ps1`). Verification is manual: run `/call-start` for real against a few setups before calling this done.

- Everything clean, single worktree.
- One other worktree with uncommitted changes.
- One branch that's fully committed but not merged into `main`.
- `main`'s own working tree left dirty.
- A stale worktree entry pointing at a deleted folder.

## What happens after this ships

Once this change is implemented, tested, committed, merged, and pushed, a separate plan doc captures the CRLF fix and the args-guard hardening for the consumer repo: `docs/superpowers/plans/2026-08-06-boxaid-teardown-kb-repo-fixes.md`. That doc is written last, on purpose, so it reflects the final state of this branch rather than being drafted mid-flight.
