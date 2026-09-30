---
name: land
description: Commits the current branch's work, merges it into local main, and pushes main to origin once you confirm.
argument-hint: "[summary for the merge title]"
disable-model-invocation: true
---

# /land

Finish the current branch: commit it, merge it into the repo's local main branch, and push that branch to origin once the user confirms. The main checkout is the live copy (plugin marketplaces and linked modules read from it), so the merge is what makes a change available; origin is the offsite copy. Work lands on local main; there is no pull request.

Every git command that acts on the main checkout is written `git -C "<MAIN>" …`, so each one names the checkout it touches.

## Repo rules

Read the repo's root `CLAUDE.md` first. A heading named "Landing", at any level, holds this repo's own rules, and they override the defaults below. It may name pre-commit steps, fast-forward-only merging and what to offer when a merge is blocked, other version files to bump, and repo-wide checks. A repo with no Landing heading uses the defaults.

## 1. Find the checkouts

- `BRANCH` = `git rev-parse --abbrev-ref HEAD`.
- `DEFAULT` = the repo's main branch: `git symbolic-ref --short refs/remotes/origin/HEAD` without its `origin/` prefix. When that fails (no `origin`, or `origin/HEAD` unset), whichever of `main` and `master` exists as a local branch; if both or neither do, ask.
- `MAIN` = the path in `git worktree list --porcelain` whose entry reads `branch refs/heads/<DEFAULT>`. If no entry does, say so and stop.
- `BASE` = `DEFAULT`, or `origin/<DEFAULT>` when `BRANCH` is `DEFAULT`. When `BRANCH` is `DEFAULT` there is no merge: run steps 2, 3, 5 and 6. With no `origin` either, run step 2 and report.

## 2. Commit the work

- First do any pre-commit step the Landing section names.
- Read `git status --porcelain` and `git diff` in the current checkout.
- Stage the files that belong to this work, one path each: `git add -- ":(literal)<path>"`. A file you can't place stays unstaged; ask about it by name.
- Commit as `type(area): summary`, matching `git log --oneline -10`, ending with the attribution lines the session instructions give.
- A clean tree is fine. What lands is `git log --oneline BASE..BRANCH`; if that is empty, say there is nothing to land and stop.

## 3. Checks

`git diff --name-only BASE...BRANCH` lists what the branch changed. A changed top-level folder is the first segment of any of those paths.

1. **Tests.** For each changed top-level folder, run the check command `CLAUDE.md` names for it, in the root file's section for that folder or in the folder's own `CLAUDE.md`. Run a repo-wide check the Landing section names once. A failing check ends the run, named.
2. **Plugin versions.** Only when `.claude-plugin/marketplace.json` exists. A plugin is in scope when its `source` is a folder path (`./<dir>`) and a changed path starts with `<dir>/`. Its version is in its marketplace entry and, when that file exists and carries a `version`, in `<dir>/.claude-plugin/plugin.json`. Compare both with the `BASE` copies (`git show BASE:<file>`).
   - Unchanged: propose the next version, minor if any commit in `git log --format=%s BASE..BRANCH -- <dir>` is a `feat`, otherwise patch. Ask about every in-scope plugin in one AskUserQuestion call, one question per plugin, each offering "no release". For a release, write the version to both places and commit those files alone as `chore(<plugin>): X.Y.Z`, one commit per plugin.
   - Changed: both places carry the same value. If they differ, set both to the higher one and commit them alone as `chore(<plugin>): X.Y.Z`.
3. **Other version files** (`module.json`, `package.json`, and the like) change only when the Landing section says how.

## 4. Merge into local main

1. `git -C "<MAIN>" status --porcelain`. Lines starting with `??` are untracked files in the main checkout and stay where they are. Any other line is an uncommitted change to a tracked file there: list those lines, offer any choices the Landing section lists for a blocked merge, and stop.
2. Merge:
   - Default: `git -C "<MAIN>" merge --no-ff BRANCH -m "<title>"`. `<title>` is `Merge <plugin> X.Y.Z: <summary>` when the branch moves a plugin's version to X.Y.Z (several: `Merge <plugin> X.Y.Z, <plugin> A.B.C: <summary>`), otherwise `Merge <area>: <summary>`. `<area>` is the `area` most of the branch's `type(area): summary` commits name; when they name none, the top-level folder the branch changed most, or `repo tooling` for files at the root or under `.claude/`. `<summary>` is `$ARGUMENTS` when given; otherwise a short phrase in the voice of `git log --merges --oneline -5`.
   - When the Landing section says fast-forward only: `git -C "<MAIN>" merge --ff-only BRANCH`. If git refuses, stop, offer the choices the Landing section lists, and carry out the one the user picks.
3. "Already up to date" means main already contains `BRANCH`; go on to step 5.
4. If the merge stops, it stopped one of two ways:
   - Git refused before starting, for example because untracked files in the main checkout would be overwritten. Quote its message, name the paths, and stop.
   - It stopped on conflicts. Run `git -C "<MAIN>" merge --abort`, report the conflicting paths, and stop. The conflict gets resolved on `BRANCH` (merge main into it in its own checkout), then /land runs again.

## 5. Push main

1. No `origin` remote: skip this step; the report says "no origin".
2. `git fetch origin`, then `git rev-list --left-right --count origin/<DEFAULT>...<DEFAULT>`.
3. A left count above 0 means origin holds commits local main lacks. Show them (`git log --oneline <DEFAULT>..origin/<DEFAULT>`) and stop; reconciling them is the user's call.
4. Otherwise show `git log --oneline origin/<DEFAULT>..<DEFAULT>` and ask with AskUserQuestion whether to push those N commits.
5. On yes: `git -C "<MAIN>" push origin <DEFAULT>`. A rejected push ends the run with git's message quoted.

## 6. Report

One line each: the commits made, the merge commit's hash and title (or main's new hash after a fast-forward), and what was pushed (`origin/<DEFAULT>` before → after), "not pushed", or "no origin". Then the files the branch changed as links to their path in the main checkout (`<MAIN>/<path>`), or their count when there are more than ten. `BRANCH` and its worktree stay as they are.
