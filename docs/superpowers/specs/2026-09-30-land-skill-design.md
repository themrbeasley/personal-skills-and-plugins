# /land as a user-level skill

- **Date:** 2026-09-30
- **Branch:** `claude/recursing-varahamihira-791b13`
- **Status:** built and landed 2026-09-30

## Goal

`/land` finishes a branch: commit, merge into local main, push once confirmed. Today it is a project command in this repo (`.claude/commands/land.md`) with professor-orb written into it, and `rolara-project` has a separate, differently-behaved copy. This work makes one `/land` that runs in every repo, finds each repo's rules for itself, and keeps its master copy here with history.

Success looks like this:

- In this repo, `/land` does everything the old command did, and also offers a version bump for foundryvtt (or any other plugin in `marketplace.json`) when the branch changed it.
- In rolara, `/land` still fast-forwards only and adds the `log.jsonl` row, because rolara's `CLAUDE.md` says so.
- In any other repo, `/land` lands work correctly with nothing in the skill written for that repo, including repos whose main branch is `master` and repos with no GitHub copy.
- The skill costs no context until typed.

## Decisions (settled 2026-09-30)

1. **User level, typed only.** The skill is `~/.claude/skills/land/SKILL.md` with `disable-model-invocation: true`, so its description stays out of every session until `/land` is typed. The description is one short line.
2. **Master copy in this repo, linked.** The source is a new top-level folder, `land/`. `~/.claude/skills/land` is a folder junction to the main checkout's `land/`, so a skill change goes live when it lands on `main`. `~/.claude` has no history; this repo does.
3. **Repo rules come from `CLAUDE.md`.** The skill reads the repo's `CLAUDE.md` and the `CLAUDE.md` of each top-level folder the branch changed. A heading named "Landing" holds anything that differs from the defaults. Repos on the defaults add nothing.
4. **rolara folds in.** Its three special rules become a two-line Landing section (linking files at the main checkout becomes a default everywhere). Its rule about deleting the session branch's GitHub copy is dropped.
5. **Both old command files are deleted.** A user-level skill beats a same-named project command ([skills docs](https://code.claude.com/docs/en/skills.md): "personal over project"), so neither file would run again, and a pointer file would never be read.
6. **Version discovery covers marketplace plugins only.** A plugin in `.claude-plugin/marketplace.json` whose folder the branch changed gets a proposed bump. Other version files (`module.json`, `package.json`) mark releases, so they're touched only when a Landing section names them.

**Considered and rejected:**

- **Only in `~/.claude/skills`.** No history or backup.
- **A plugin in the marketplace.** Plugin skills are namespaced (`/<plugin>:land`), and every edit would need a version bump to reach installs.
- **A separate `.claude/land.md` rules file per repo.** One more file per repo, which can drift from `CLAUDE.md`.
- **Inferring rules from `CLAUDE.md` prose with no Landing section.** Nothing in rolara's `CLAUDE.md` says "fast-forward only", so that rule would be lost.
- **Deferring to a repo's own `.claude/commands/land.md`.** Two sources of truth.

## The skill

Frontmatter: `name: land`, a one-line `description`, `argument-hint: "[summary for the merge title]"`, `disable-model-invocation: true`.

Every git command on the main checkout is written `git -C "<MAIN>" …`. Staging uses `:(literal)` pathspecs.

### 1. Find the checkouts and the rules

- `BRANCH` = the current branch.
- `DEFAULT` = the repo's main branch: the branch `origin/HEAD` names, or, with no `origin`, whichever of `main` and `master` exists.
- `MAIN` = the path in `git worktree list --porcelain` whose entry reads `branch refs/heads/<DEFAULT>`. If none does, say so and stop.
- `BASE` = `DEFAULT`, or `origin/<DEFAULT>` when `BRANCH` is `DEFAULT`. When `BRANCH` is `DEFAULT` there is no merge: run steps 2, 3, 5 and 6.
- Read the repo's `CLAUDE.md` and the `CLAUDE.md` of each top-level folder in `git diff --name-only BASE...BRANCH`. A Landing section's rules override the defaults below.

### 2. Commit the work

First do any pre-commit step a Landing section names. Then, as the old command: read status and diff, stage the files that belong to this work one path each, ask about any file that can't be placed, and commit as `type(area): summary` matching `git log --oneline -10`, ending with the session's attribution lines. If `git log --oneline BASE..BRANCH` is empty, say there is nothing to land and stop.

### 3. Checks

- **Tests.** For each changed top-level folder, run the check command `CLAUDE.md` names for it, if it names one. A failure ends the run, named.
- **Versions.** For each plugin in `.claude-plugin/marketplace.json` whose `source` folder the branch changed, compare its `version` (the marketplace entry and `<source>/.claude-plugin/plugin.json` when that file exists) with the `BASE` copies.
  - Unchanged: propose the next version (minor if any commit in `BASE..BRANCH` is a `feat`, otherwise patch), all plugins in one AskUserQuestion call, each offering "no release". For a release, write the version to both places and commit those files alone as `chore(<plugin>): X.Y.Z`.
  - Changed: both places carry the same value. If they differ, set both to the higher one and commit them alone as `chore(<plugin>): X.Y.Z`.
- Other version files are bumped only when a Landing section names them.

### 4. Merge into local main

1. `git -C "<MAIN>" status --porcelain`. `??` lines stay where they are. Any other line: list it and stop.
2. Default: `git -C "<MAIN>" merge --no-ff BRANCH -m "<title>"`. The title is `Merge <plugin> X.Y.Z: <summary>` when the branch releases a plugin (several joined with ", "), otherwise `Merge <area>: <summary>`. `<area>` is the `area` most of the branch's `type(area):` commits name, so a branch's spec and plan in `docs/` don't name the merge; when the commits name none, the top-level folder the branch changed most (`repo tooling` for the root or `.claude/`). `<summary>` is `$ARGUMENTS` when given, otherwise a short phrase in the voice of `git log --merges --oneline -5`.
3. A Landing section that says fast-forward only: `git -C "<MAIN>" merge --ff-only BRANCH`. When it can't, stop and offer the choices the section lists.
4. "Already up to date": go on to step 5.
5. If the merge stops: git refused before starting (quote it, name the paths, stop), or it hit conflicts (`merge --abort`, report the paths, stop; the conflict gets resolved on `BRANCH` and `/land` runs again).

### 5. Push main

- No `origin` remote: skip, and say so in the report.
- Otherwise as the old command: `git fetch origin`; if `origin/<DEFAULT>` has commits local `DEFAULT` lacks, show them and stop; otherwise show what would go up, ask with AskUserQuestion, and on yes `git push origin <DEFAULT>`. A rejected push ends the run with git's message quoted. Never force-push.

### 6. Report

One line each: the commits made, the merge commit's hash and title, and what was pushed (before → after) or "not pushed". Then the changed files as links to their path in the main checkout, or a count when there are more than ten. `BRANCH` and its worktree stay as they are.

## rolara's Landing section

Added to `rolara-project/CLAUDE.md` at the end of the "Repository structure" subsection, before "Publishing to the wiki". It is a level-3 heading because it sits inside "KB Infrastructure & Conventions"; a level-2 heading would swallow the subsections after it. The skill matches the heading at any level.

```markdown
### Landing

`/land` follows these rules in this repo:
- Before committing, add this session's `log.jsonl` row if it has none yet.
- Fast-forward only. When main can't fast-forward (it has moved on, or has uncommitted files), stop and offer two choices: copy this session's files onto main and commit there, appending this session's `log.jsonl` rows to main's copy; or a merge commit, when no file changed on both sides.
```

## What gets built

| File | Change |
|---|---|
| `land/SKILL.md` | New. The skill above. |
| `.claude/commands/land.md` | Deleted. |
| `CLAUDE.md` | Add a `land/` section: user-level skill, master copy here, junctioned into `~/.claude/skills/land`, edit here and it goes live on landing. |
| `README.md` | Add a `land/` line under Contents. |
| `rolara-project/CLAUDE.md` | Add the Landing section above. |
| `rolara-project/.claude/commands/land.md` | Deleted. |
| `~/.claude/skills/land` | New junction to `C:\Users\jorda\GitHub\claude-skills_and_plugins-homebrew\land`. |

## Order and checks

1. Build `land/`, the `CLAUDE.md` and `README.md` edits, and the deletion on this branch.
2. Land this branch by following `land/SKILL.md` directly. First real run: default path, no plugin changed, merge commit `Merge land: …`, push question. This is the finish-the-branch approval point.
3. In a new rolara branch and worktree, add the Landing section and delete the old command, then land it by following the skill. Second real run: Landing section read, fast-forward, `log.jsonl` row, push question.
4. Create the junction and read the skill through it. A new Code tab session may be needed before `/land` appears.

The version-bump step first runs for real on the next professor-orb or foundryvtt landing. Watch that run.

## Out of scope

- Changing any other repo's workflow beyond rolara.
- Bumping Foundry `module.json` versions by default.
- Pruning worktrees or deleting branches after landing.
