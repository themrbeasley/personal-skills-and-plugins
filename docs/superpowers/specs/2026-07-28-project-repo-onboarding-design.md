# Project repo onboarding: setup owns the versioning decision

Date: 2026-07-28
Components: `professor-orb/skills/setup/SKILL.md`, `professor-orb/commands/catalog.md`
Status: **SUPERSEDED 2026-07-28.** Do not implement from this document.

> **Why this was superseded.** Brainstorming continued past this draft and invalidated two
> of its premises. First, the DM established that setup is meant to impose professor-orb's
> own organizational schema and migrate the consumer to it, without a confirmation gate,
> reporting afterward. This document assumed the opposite, that setup respects whatever
> structure it finds. Second, the canonical layout became multi-setting
> (`settings/<setting>/`, `homebrew/<setting>/`, `session-reports/<setting>/<campaign>/`),
> so the three flat lane paths this document specifies for `conventions.json` are wrong.
> Two new commands, `/scribe` and `/log`, also joined the design.
>
> An audit of the plugin (6 agents, 2026-07-28) then found the derive-never-impose posture
> in roughly 50 places across 8 files, plus a rule-provenance defect in the autofix path.
> The work was split into three specs:
>
> 1. `2026-07-28-canonical-schema-design.md`, the schema is professor-orb's
> 2. Apply it: multi-setting layout, git-first onboarding, setup's initial migration
> 3. Lanes: `/scribe`, `/log`, `/catalog`
>
> Followed later by `/migrate` and `/genesis`. Material still valid from this document,
> chiefly the GitHub walkthrough boundaries, the `.gitignore` policy, the `versioning.json`
> rename and its conversion, and the push policy, is carried into spec 2 rather than
> reworked here.

## Problem

`/catalog` Step 3 decides how a homebrew catalog records versions (git commits, or a
dated changelog line in the entry). Its first check is "is the catalog folder inside a
git repository?" and, if so, it concludes git mode on the theory that "the repository's
own presence is the record of that choice."

That check conflates two different facts. It was written when a catalog folder plausibly
*was* its own git repository, so "this folder is in a repo" and "the DM chose git-mode
versioning for this catalog" were the same fact. They are no longer the same fact. In the
Rolara consumer project, four repositories were consolidated into one on 2026-07-28, so
`homebrew/` is now an ordinary folder inside a large repository holding the KB, session
reports, and project config. The check still returns git mode, but for a reason that has
nothing to do with a catalog-versioning decision. It is right by coincidence.

Three further defects surfaced while examining the step:

1. **The inference is never persisted.** Only the first-run offer (case 3) writes
   `.professor-orb/catalog-versioning.json`. A catalog that reaches git mode via the
   repo-presence check re-derives that conclusion from live git state on every capture,
   forever, so it stays permanently vulnerable to a change in its surroundings.
2. **The marker is checked second, not first.** A recorded decision can therefore be
   bypassed by ambient repository state, which contradicts Step 3's own promise that the
   choice is "decided once for the catalog, the first time it is used, and then followed
   silently on every later capture."
3. **The decision is scoped to the catalog alone.** Versioning is a project-level
   concern. The KB and session reports benefit from history at least as much as homebrew
   does, but nothing in the plugin ever raises the subject for them.

The root cause is that no component ever asks the DM the project-level question, so
`/catalog` is left inferring an answer from folder structure at capture time. The fix is
to ask it once, explicitly, during onboarding.

## Decisions

Settled with the DM during brainstorming:

- `setup` gains a versioning step that strongly recommends one repository covering the
  whole project, ideally a private GitHub repository, and walks a first-time user
  through it in plain language.
- A DM who declines GitHub gets local-only git rather than nothing, with the tradeoff
  stated plainly and the door left open to add GitHub later.
- The decision is written to disk the first time it is made, and the recorded decision is
  authoritative thereafter.
- The marker file is renamed from `catalog-versioning.json` to `versioning.json`, with a
  one-time automatic conversion for existing installs.
- `/catalog` stops inferring anything from folder structure. The repo-presence check is
  deleted, not made more precise.
- Setup performs the first push. After that, commits are automatic and pushes happen on
  request.

## Design

### Part 1: setup gains a versioning step

A new step is inserted into `setup/SKILL.md` after predecessor detection (currently Step
1) and before conventions intake (currently Step 2). The existing Steps 2, 3, 4, 5, and 6
become Steps 3, 4, 5, 6, and 7 respectively, and their internal cross-references shift
with them.

The step is placed early for two reasons: the DM's attention is freshest before the
conventions interview, and `git init` must happen before setup writes files so the first
commit can contain everything setup produced.

**The step splits across the run.** The decision and local `git init` happen at the new
Step 2. The first commit and the first push happen at the end, in "Closing this run",
once `conventions.json`, the copied workflow, and any greenfield index structure exist.
An empty initial commit followed by a second commit containing everything is worse than
one initial commit that captures the finished setup.

**Detect the current state before offering anything.** Four cases:

- **Project root is already a git repository with a remote.** Nothing to set up. Record
  the existing state and move on. Mention the remote so the DM can confirm it is the one
  they expect.
- **Project root is already a git repository with no remote** (Rolara's case). Do not
  offer `git init`. Offer only the GitHub connection, or record local-git mode.
- **Project root is not a repository, but sits inside one.** Surface this plainly rather
  than adopting the ancestor repository silently: name the ancestor's root path and ask
  whether the DM wants a repository for this project specifically, or intends the
  ancestor to cover it. Never assume. This is the same conflation that caused the
  original defect, so it must not be reintroduced at setup time.
- **No repository anywhere.** The full three-way offer below.

**The offer.** Presented via AskUserQuestion, with the benefit stated in concrete terms
rather than version-control vocabulary: every change is undoable, the campaign can be
viewed as it stood on any past date, and an offsite copy survives a dead hard drive.

1. **Private GitHub repository (recommended).** Full walkthrough, described below.
2. **Local git only.** No account, works offline, full history and undo. The tradeoff is
   stated explicitly: no offsite copy, so hardware failure or a lost laptop loses the
   campaign. Setup states that GitHub can be added later at any time by asking.
3. **No version control.** The existing changelog baseline. Setup states what is given
   up: no undo, no history, only a running description of what changed.

**Voice requirement.** This step is the plugin's only encounter with a DM who may never
have used git or GitHub. Every term is either avoided or defined on first use in one
clause. Write "a free account at github.com, where a private copy of your campaign is
stored online" rather than "a remote origin". Never emit a bare command for the DM to run
without saying what it does and what they will see happen.

**Privacy is not optional framing.** Campaign material routinely contains content the
players must not read. Setup defaults to a private repository, states that a public
repository would let players read everything including unrevealed plot, and confirms
private before creating anything.

**Disclosure.** Choosing GitHub uploads campaign content to a third party. Setup says so
plainly before creating the repository, not after. A private repository is private from
other users, not from GitHub itself.

### Part 2: the GitHub walkthrough and its boundaries

The walkthrough is gated on tooling that may be absent, and on actions the assistant
cannot perform. Both are handled explicitly rather than by attempting and failing.

**What the assistant cannot do, and hands back to the DM:**

- Creating a GitHub account. The DM does this themselves at github.com. Setup gives the
  short version (free, email plus username plus password) and waits.
- Running `gh auth login`. It is interactive and cannot be driven from a non-interactive
  shell. Setup tells the DM to run it in their own terminal, describes the browser
  window and one-time code they will see, and waits for them to confirm it finished.
- Entering any password or token.

**What the assistant does once the DM is authenticated:**

- Verify with `gh --version` and `gh auth status` before proceeding. Never assume.
- `git init` at the project root, if not already a repository.
- Write a starter `.gitignore` (Part 4).
- At the end of the run, in this order: stage and commit everything setup produced, then
  `gh repo create <name> --private --source=. --remote=origin --push`, which creates the
  private repository, wires the remote, and pushes the commit in one non-interactive
  command. The commit must exist before `gh repo create` runs, since `--push` publishes
  the current branch and an unborn branch has nothing to send.

**If `gh` is not installed.** Two paths, offered in order. First, the DM installs it
(`winget install --id GitHub.cli` on Windows, `brew install gh` on macOS) and the flow
resumes. Second, if they prefer not to, the DM creates the private repository in the
GitHub web UI and pastes the HTTPS URL back; setup runs `git remote add origin <url>`,
and the DM runs the first `git push -u origin main` themselves. The manual path exists
because a bare `git push` without `gh` can trigger a credential-manager GUI prompt that
would hang a non-interactive shell call. Prefer `gh` precisely to avoid that.

**If the DM stalls on account creation.** Setup must not hang waiting. It completes local
git setup immediately so the project is protected now, records mode `git` with
`githubPending: true`, and states that finishing the GitHub connection later is a matter
of asking. This is a real case: account creation involves email verification and may not
complete inside one session.

**Never fabricate success.** If any step fails, say which step, what the error was, and
what state the project is actually in.

### Part 3: `versioning.json`

The marker moves from `.professor-orb/catalog-versioning.json` to
`.professor-orb/versioning.json`. Same directory, name no longer implying the decision
covers only homebrew.

It stays a separate file rather than folding into `conventions.json`, because
`conventions.json` is regenerated wholesale on every resync and the versioning decision
must survive that untouched.

Shape:

```json
{
  "mode": "github",
  "decided": "2026-07-28",
  "remote": "https://github.com/<owner>/<repo>",
  "githubPending": false
}
```

- `mode` is `github`, `git`, or `changelog`.
  - `github`: git with a private remote. Commits per capture, pushes on request.
  - `git`: local git only. Commits per capture, no remote.
  - `changelog`: no git. The existing dated-changelog-line baseline.
- `decided` is the date the choice was first recorded, never rewritten afterward.
- `remote` is present only for `github`, so later steps need not rediscover it.
- `githubPending` is present only when the DM chose GitHub but has not finished
  authenticating. It is removed once the connection completes.

**`github` and `git` are both "git mode" downstream.** `/catalog` Step 7's existing "Git
mode" branch (commit per capture, no changelog block in the entry) applies to both. The
only difference is whether a remote exists to push to. Keeping the existing value `git`
and the existing value `changelog` means Step 7's prose needs no rewrite.

**One-time conversion.** Any component that reads the marker performs this check first:
if `catalog-versioning.json` exists and `versioning.json` does not, read the old file,
write its `mode` and `decided` values unchanged into `versioning.json`, delete the old
file, and mention the conversion in passing. The `decided` date is preserved, not reset
to today: the decision was made when it was made.

The conversion is one shared behavior, not a Rolara special case. Any install predating
this change is in the same position.

### Part 4: `.gitignore`

Setup writes a starter `.gitignore` when it initializes a repository, and proposes
additions to an existing one rather than overwriting it.

Ignored by default, as derived or transient state:

- `.professor-orb/pipeline-state.json` (a breadcrumb, rewritten constantly)
- `.professor-orb/proposals/` (transient, consumed then discarded)
- `.professor-orb/tag-registry.json` (regenerated by every validation sweep, so tracking
  it produces commit noise on every run)

Tracked, as durable decisions worth history:

- `.professor-orb/conventions.json`
- `.professor-orb/versioning.json`

Setup also asks about large or sensitive material a campaign project commonly holds
(Foundry exports, map images, audio) rather than silently committing hundreds of
megabytes on the first push. The tag-registry exclusion is a judgment call and the DM may
override it.

### Part 5: `/catalog` Step 3 collapses

Step 3 becomes two cases:

1. **`.professor-orb/versioning.json` exists.** Read `mode`, carry it to Step 7, done.
   Checked first, always. A recorded decision is never overridden by ambient state.
2. **It does not exist.** This means `/catalog` ran before `setup`. Do not guess. Say that
   setup has not established how this project keeps history, point at `setup` as the right
   place to decide it, and offer the choice inline so the DM is not blocked mid-capture. A
   choice made inline is written to `versioning.json` and is thereafter identical to one
   made during setup.

   The inline offer covers local git and changelog only. If the DM wants GitHub, record
   local `git` so the capture can proceed with real history, and point them at `setup` for
   the connection walkthrough. A full account-creation and authentication flow does not
   belong in the middle of a capture, and Part 2's stalled-account handling already models
   this: get history working now, connect the remote later.

The repo-presence check is removed entirely. No component infers a versioning decision
from folder structure. The Step 3 heading changes from "Establish how this catalog is
versioned" to reflect that it now reads a project-level decision rather than establishing
a catalog-level one.

The "Things to never do" entry about the git offer is updated: the offer now lives in
setup, and `/catalog`'s inline fallback is the exception rather than the primary path.

### Part 6: push policy

Setup performs the first push, so the DM sees the remote working before the run ends.

After that, commits remain automatic where they already are (`/catalog` Step 7 commits
each capture) and pushes happen when the DM asks. Nothing pushes silently in the
background. This preserves the deliberateness of sending content to a third party while
keeping local history effortless.

`/catalog`'s existing prohibition on creating remotes and authenticating stands
unchanged. Its scope narrows to what it always meant: `/catalog` is not the place where
remotes get set up. Setup is.

## Edge cases

- **Resync with a decision already recorded.** Do not re-ask. Report what is in place. The
  one exception: if mode is `git` (local only) or `githubPending` is true, mention that
  GitHub is still available, since the DM asked for changing their mind to stay easy.
- **Resync with no decision recorded** (any install predating this change, after the
  conversion finds nothing to convert). Run the new step normally.
- **Project root already a repository.** Covered in Part 1. Never run `git init` over an
  existing repository.
- **Project root nested inside an unrelated repository.** Covered in Part 1. Surface, ask,
  never adopt silently.
- **`gh` present but not authenticated.** Detected by `gh auth status`. Route to the
  DM-runs-`gh auth login` path rather than attempting it.
- **DM declines everything.** Mode `changelog`. Setup proceeds normally. Nothing about the
  rest of the plugin depends on git existing.
- **Greenfield project with no folders yet.** The three-prong structure (KB, session
  reports, homebrew) is recommended when setup builds structure from scratch, which the
  existing greenfield branch of the folder-index parity step already handles. Established
  projects are not restructured.

## Out of scope

- **Auto-committing every KB write.** Plausible follow-on, separate project. This design
  changes only where the versioning decision is made and recorded.
- **Restructuring existing projects into the three-prong layout.** Setup recommends it for
  greenfield only. The existing "migrations stay proposals" rule is untouched.
- **Any change to `debrief`, `prep`, `content`, `chronicler`, `timeline`, `homebrew`, the
  agents, the hooks, or the validation sweep.** None of them read the versioning marker.
- **Branching, pull requests, or any git workflow beyond commit and push.** A single
  `main` branch is the whole model.
- **Migrating Rolara's four archived repositories.** Already done, and consumer-project
  work regardless.

## Files touched

| File | Change |
| --- | --- |
| `professor-orb/skills/setup/SKILL.md` | New versioning step, existing Steps 2 through 6 renumbered to 3 through 7, first commit and push added to "Closing this run", `.gitignore` handling |
| `professor-orb/commands/catalog.md` | Step 3 collapsed to two cases, repo-presence check deleted, marker path and name updated, "Things to never do" entry revised |
| `professor-orb/CONTEXT.md` | New language entry for the versioning decision and the renamed marker |
| `professor-orb/README.md` | Setup description mentions the repository step |
| `professor-orb/.claude-plugin/plugin.json` | Version 1.5.1 to 1.6.0 |
| `.claude-plugin/marketplace.json` | Version 1.5.1 to 1.6.0, same commit |

## Verification

No test framework exists for the markdown components, so verification is behavioral:

- Read `catalog.md` end to end and confirm no path reaches a versioning decision without
  reading `versioning.json` first.
- Confirm setup's renumbered cross-references all resolve to the intended steps.
- Confirm no em dashes anywhere in the changed files (SHARED-PRINCIPLES Principle 6).
- Exercise the conversion against a fixture holding only the old
  `catalog-versioning.json` and confirm `decided` survives unchanged.
- Exercise setup's four repository-state cases against disposable fixtures, at minimum
  the "already a repository, no remote" case, which is Rolara's.

## Notes

Version bump is minor (1.5.1 to 1.6.0): new capability, no breaking change, with the
marker rename handled by automatic conversion. Both version files change in the same
commit, per the convention established in the 1.3.0 plan.
