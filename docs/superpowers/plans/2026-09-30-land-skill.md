# /land user-level skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace this repo's `/land` command and rolara-project's with one user-level `/land` skill whose master copy lives in this repo.

**Architecture:** `land/SKILL.md` in this repo is the skill. `~/.claude/skills/land` is a junction to the main checkout's `land/`, so landing a skill change makes it live. Repo-specific rules come from each repo's `CLAUDE.md`, with anything non-default under a "Landing" heading.

**Tech Stack:** Markdown skill file, git, Windows junction (`mklink /J`).

**Spec:** `docs/superpowers/specs/2026-09-30-land-skill-design.md`

## Status

| Task | State |
|---|---|
| 1. Build `land/` and retire the repo command | done |
| 2. Land this branch with the new skill (finish-the-branch gate) | not started |
| 3. rolara: Landing heading, retire its command, land it | not started |
| 4. Junction into `~/.claude/skills/land` | not started |
| Watch: first real version-bump run (next professor-orb or foundryvtt landing) | open |

## Global Constraints

- Skill frontmatter: `name: land`, `argument-hint: "[summary for the merge title]"`, `disable-model-invocation: true`, one-line `description`.
- Every git command on the main checkout is written `git -C "<MAIN>" …`; staging uses `:(literal)` pathspecs.
- Stop on tracked changes in the main checkout; abort a conflicted merge; ask before every push; push only with plain `git push origin <DEFAULT>`.
- No pull requests. Work lands on local main, then pushes.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

Inputs the two real landings (Tasks 2 and 3) don't reach, most likely first:

1. A repo whose main branch is `master`, or whose `origin/HEAD` isn't set: `DEFAULT` falls back to the local `main`/`master`. Pinned by Task 1 Step 3 (probe `jojos-crew`, `beas-quest-journal`).
2. A repo with no `origin`: the push step is skipped and reported. Pinned by Task 1 Step 3 (`beas-quest-journal`).
3. A repo where no worktree has main checked out: step 1 stops with a message. Pinned by Task 1 Step 3 (`real_illusions`, whose only checkout is on a feature branch).
4. A branch that changes a plugin folder: the version question and the `chore(<plugin>)` commit. Not reachable without a plugin change; tracked as the Status table's watch item.
5. A branch whose spec and plan outnumber its other files: the merge title still names the folder the work is for, because `<area>` comes from the commits' `type(area):` first. Exercised by Task 2 (this branch has two `docs/` files).

---

### Task 1: Build `land/` and retire the repo command

**Files:**
- Create: `land/SKILL.md`
- Delete: `.claude/commands/land.md`
- Modify: `CLAUDE.md` (new `land/` section after the `sequencer/` section)
- Modify: `README.md` (new line under Contents, after `sequencer/`)
- Modify: `docs/superpowers/specs/2026-09-30-land-skill-design.md` (two wording refinements, Step 5)

**Interfaces:**
- Produces: the skill file Tasks 2 and 3 follow, and the folder Task 4 links to.

- [ ] **Step 1: Write `land/SKILL.md`**

````markdown
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
````

- [ ] **Step 2: Delete the repo command, add the `CLAUDE.md` section and README line**

Delete: `git rm -q -- ":(literal).claude/commands/land.md"`

In `CLAUDE.md`, insert after the `sequencer/` section (before `## \`sequencer-workspace/\` and \`docs/\``):

```markdown
## `land/` — user-level Claude Code skill

`/land` finishes a branch in any repo: commit, merge into local main, push main once confirmed. This folder is the master copy; `~/.claude/skills/land` is a junction to it in the main checkout, so an edit goes live when it lands on `main`. Edit it here, on a branch. Each repo's own rules come from its `CLAUDE.md`, under a "Landing" heading when they differ from the defaults. Layout: `SKILL.md` only.
```

In `README.md`, insert after the `sequencer/` line:

```markdown
- **[land/](land/)** — A user-level Claude Code skill: `/land` commits a branch, merges it into local main, and pushes main once you confirm, in any repo.
```

- [ ] **Step 3: Probe step 1's discovery commands, read-only, in three repos**

Run:

```bash
for d in jojos-crew beas-quest-journal real_illusions; do
  r=~/GitHub/$d
  def=$(git -C "$r" symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##')
  [ -z "$def" ] && def=$(git -C "$r" branch --list main master --format='%(refname:short)')
  main=$(git -C "$r" worktree list --porcelain | awk -v b="branch refs/heads/$def" '/^worktree /{p=substr($0,10)} $0==b{print p}')
  echo "$d | DEFAULT=$def | MAIN=${main:-<none: stop>} | origin=$(git -C "$r" remote | grep -x origin || echo none)"
done
```

Expected:
- `jojos-crew | DEFAULT=master | MAIN=C:/Users/jorda/GitHub/jojos-crew | origin=origin`
- `beas-quest-journal | DEFAULT=master | MAIN=C:/Users/jorda/GitHub/beas-quest-journal | origin=none`
- `real_illusions | DEFAULT=main | MAIN=<none: stop> | origin=origin`

Any other result means the step 1 wording in `SKILL.md` needs fixing before Step 5.

- [ ] **Step 4: Check the frontmatter**

Run: `head -6 land/SKILL.md && git status --short`
Expected: the five frontmatter lines from Step 1; status shows `A land/SKILL.md` (after staging), `D .claude/commands/land.md`, `M CLAUDE.md`, `M README.md`.

- [ ] **Step 5: Bring the spec in line with two refinements**

In the spec:
- rolara's section heading is `### Landing`, not `## Landing`. It sits inside rolara's "KB Infrastructure & Conventions" section, after the "Repository structure" subsection, so a level-2 heading would swallow the subsections after it. The skill matches the heading at any level.
- The merge title's `<area>` comes from the branch's `type(area):` commits first, then the folder changed most. A branch's spec and plan in `docs/` would otherwise name the merge.

- [ ] **Step 6: Commit**

```bash
git add -- ":(literal)land/SKILL.md" ":(literal)CLAUDE.md" ":(literal)README.md" ":(literal)docs/superpowers/specs/2026-09-30-land-skill-design.md" ":(literal)docs/superpowers/plans/2026-09-30-land-skill.md"
git commit -m "feat(land): one user-level /land for every repo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Mark Task 1 done in the Status table as part of this commit.

---

### Task 2: Land this branch with the new skill

**Files:** none new; the skill's own commits and merge.

**Interfaces:**
- Consumes: `land/SKILL.md` from Task 1, read from this worktree (the junction doesn't exist yet).

- [ ] **Step 1: Follow `land/SKILL.md` from the top, with `$ARGUMENTS` = `one user-level /land for every repo`**

Expected at each step:
- Step 1: `BRANCH=claude/recursing-varahamihira-791b13`, `DEFAULT=main`, `MAIN=C:/Users/jorda/GitHub/claude-skills_and_plugins-homebrew`. No Landing heading in this repo's `CLAUDE.md`.
- Step 2: the tree is clean (Task 1 committed everything); nothing to commit.
- Step 3: changed folders are `land/`, `docs/`, `.claude/`, and root files. No check command is named for them. No plugin folder changed, so no version question.
- Step 4: main checkout clean of tracked changes; `Merge land: one user-level /land for every repo`.
- Step 5: the push question. **This is the finish-the-branch approval point.**
- Step 6: report, with the changed files linked under the main checkout.

- [ ] **Step 2: Record what differed from the expectations above**

Any step that behaved differently gets fixed in `land/SKILL.md` on a new branch before Task 3, and noted in the Status table.

---

### Task 3: rolara — Landing heading, retire its command, land it

**Files (in `C:\Users\jorda\GitHub\rolara-project`):**
- Modify: `CLAUDE.md` (new `### Landing` after the "Repository structure" subsection's last paragraph, the one starting ``.gitignore` treats``, before `### Publishing to the wiki`)
- Delete: `.claude/commands/land.md`
- Modify: `log.jsonl` (the skill's pre-commit step appends this session's row)

**Interfaces:**
- Consumes: `C:\Users\jorda\GitHub\claude-skills_and_plugins-homebrew\land\SKILL.md` (on main after Task 2).

- [ ] **Step 1: Make a branch and worktree**

```bash
git -C ~/GitHub/rolara-project worktree add .claude/worktrees/land-rules -b claude/land-rules main
```

Expected: a new worktree on `claude/land-rules` at main's current commit.

- [ ] **Step 2: Add the Landing heading and delete the command in that worktree**

Insert into `CLAUDE.md` before `### Publishing to the wiki`:

```markdown
### Landing

`/land` follows these rules in this repo:
- Before committing, add this session's `log.jsonl` row if it has none yet.
- Fast-forward only. When main can't fast-forward (it has moved on, or has uncommitted files), stop and offer two choices: copy this session's files onto main and commit there, appending this session's `log.jsonl` rows to main's copy; or a merge commit, when no file changed on both sides.

```

Delete: `git -C ~/GitHub/rolara-project/.claude/worktrees/land-rules rm -q -- ":(literal).claude/commands/land.md"`

- [ ] **Step 3: Follow the skill from that worktree, with `$ARGUMENTS` empty**

Expected at each step:
- Step 1: `DEFAULT=main`, `MAIN=C:/Users/jorda/GitHub/rolara-project`. The Landing heading is read from the branch's `CLAUDE.md`.
- Step 2: the pre-commit step appends one `log.jsonl` row: `"type": "update"`, `"campaign": null`, `"files": ["CLAUDE.md", ".claude/commands/land.md"]`, no em dashes in `details`. The commit is `chore(land): …` or similar in rolara's voice.
- Step 3: no check named; no `marketplace.json`, so no version question.
- Step 4: `git -C "<MAIN>" merge --ff-only claude/land-rules` succeeds.
- Step 5: the push question.
- Step 6: report.

- [ ] **Step 4: Note the result** for Task 4 Step 3's Status table update.

---

### Task 4: Junction into `~/.claude/skills/land`

**Files:**
- Create: `C:\Users\jorda\.claude\skills\land` (junction)

- [ ] **Step 1: Create it**

```bash
cmd //c mklink /J "C:\Users\jorda\.claude\skills\land" "C:\Users\jorda\GitHub\claude-skills_and_plugins-homebrew\land"
```

Expected: `Junction created for C:\Users\jorda\.claude\skills\land <<===>> C:\Users\jorda\GitHub\claude-skills_and_plugins-homebrew\land`

- [ ] **Step 2: Read the skill through it**

Run: `head -6 ~/.claude/skills/land/SKILL.md`
Expected: the frontmatter from Task 1 Step 1.

- [ ] **Step 3: Close out the tracker**

On this same branch: mark Tasks 2 to 4 done in the Status table, then land again by following `~/.claude/skills/land/SKILL.md` (read through the junction). Step 2 commits the table as `docs(land): close out the plan`; step 4 makes a second merge commit. The first `/land` typed in a new session confirms Claude Code picks the skill up; tell the user to watch for it.
