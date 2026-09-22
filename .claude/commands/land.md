---
description: Commits the current branch's work, merges it into local main with a titled merge commit, and pushes main to origin once you confirm. Use to finish a branch in this repo.
argument-hint: "[summary for the merge title]"
disable-model-invocation: true
---

# /land

Finish the current branch the way this repo lands work. The professor-orb marketplace is a directory source pointing at the main checkout, so merging into local `main` is what makes a change available; `origin` is the offsite copy.

Every git command that acts on the main checkout is written `git -C "<MAIN>" …`, so each one names the checkout it touches.

## 1. Find the two checkouts

- `BRANCH` = `git rev-parse --abbrev-ref HEAD`.
- `MAIN` = the path in `git worktree list --porcelain` whose entry reads `branch refs/heads/main`. If no entry does, say so and stop.
- `BASE` = `main`, or `origin/main` when `BRANCH` is `main`. When `BRANCH` is `main` there is no merge: run steps 2, 3, 5, and 6.

## 2. Commit the work

- Read `git status --porcelain` and `git diff` in the current checkout.
- Stage the files that belong to this work, one path each: `git add -- ":(literal)<path>"`. A file you can't place stays unstaged; ask about it by name.
- Commit as `type(area): summary`, matching `git log --oneline -10`.
- A clean tree is fine. What lands is `git log --oneline BASE..BRANCH`; if that is empty, say there is nothing to land and stop.

## 3. Checks

`git diff --name-only BASE...BRANCH` lists what the branch changed.

If any path starts with `professor-orb/`:

1. Run every suite: `for f in $(find professor-orb -name "*.test.mjs" | sort); do node "$f" || break; done`. A failing suite ends the run, named.
2. Compare `version` in `.claude-plugin/marketplace.json` and `professor-orb/.claude-plugin/plugin.json` with the `BASE` copies (`git show BASE:<file>`).
   - Unchanged: propose the next version (minor if any commit in `BASE..BRANCH` is a `feat`, otherwise patch) with AskUserQuestion, offering "no release" as an answer. For a release, write the version to both files and commit those two files alone as `chore(professor-orb): X.Y.Z`.
   - Changed: the two files carry the same value. If they differ, set both to the higher one and commit them alone as `chore(professor-orb): X.Y.Z`.

For any other top-level project the branch touches, run the check command that project's section of `CLAUDE.md` names, if it names one.

## 4. Merge into local main

1. `git -C "<MAIN>" status --porcelain`. Lines starting with `??` are untracked files in the main checkout and stay where they are. Any other line is an uncommitted change to a tracked file there: list those lines and stop.
2. `git -C "<MAIN>" merge --no-ff BRANCH -m "<title>"`, where `<title>` is
   - `Merge professor-orb X.Y.Z: <summary>` when the branch moves the professor-orb version to X.Y.Z, otherwise
   - `Merge <area>: <summary>`, with `<area>` the top-level directory the branch changed most (`repo tooling` for files at the root or under `.claude/`).

   `<summary>` is `$ARGUMENTS` when given; otherwise a short phrase in the voice of `git log --merges --oneline -5`.
3. "Already up to date" means `main` already contains `BRANCH`; go on to step 5.
4. If the merge stops, it stopped one of two ways:
   - Git refused before starting, for example because untracked files in the main checkout would be overwritten. Quote its message, name the paths, and stop.
   - It stopped on conflicts. Run `git -C "<MAIN>" merge --abort`, report the conflicting paths, and stop. The conflict gets resolved on `BRANCH` (merge `main` into it in its own checkout), then /land runs again.

## 5. Push main

1. `git fetch origin`, then `git rev-list --left-right --count origin/main...main`.
2. A left count above 0 means `origin/main` holds commits local `main` lacks. Show them (`git log --oneline main..origin/main`) and stop; reconciling them is the user's call.
3. Otherwise show `git log --oneline origin/main..main` and ask with AskUserQuestion whether to push those N commits.
4. On yes: `git push origin main`. A rejected push ends the run with git's message quoted.

## 6. Report

One line each: the commits made, the merge commit's hash and title, and what was pushed (`origin/main` before → after) or "not pushed". `BRANCH` and its worktree stay as they are.
