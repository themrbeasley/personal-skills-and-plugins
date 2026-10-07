# professor-orb: prep briefs and the option-echo check, checking only what an edit wrote, hooks that find the project from any folder, and one save question in prep

Design, 2026-10-07. Source: `rolara-project/docs/professor-orb-report-2026-10-07.md`
(on rolara's `big-guys-game-session` worktree branch), compiled after the Big Guy's
Gang prep of 2026-10-07. Scope approved by the DM in conversation on 2026-10-07.

The report raised four items. Checking them against the source and the session's
transcript (`14ade55e-2921-40fc-8677-a66f6fa1663b.jsonl`) found that item 3 is not
specific to the option-echo check: all five professor-orb hooks locate the project
from the session's working folder, and all five misbehave when that folder is a
subfolder of the project. The report's first suggested fix for item 1 would reopen
the hole the check exists to close, so this design takes a different one.

| # | Report item | Cause found | Ships |
| --- | --- | --- | --- |
| 1 | The option-echo check blocks the north stars prep tells Claude to write | `a3ad4b8` (2026-09-20) checks prep briefs, a day after `f0d60e3` (2026-09-19) made report-drawn options and north stars share one two-part wording | Change 1 |
| 2 | The check flags text the write did not touch | `a3ad4b8` checks every sentence of the file after every write | Change 2 |
| 3 | The check passed silently at save time | `9e1d1cd` (2026-07-09): the hooks take the working folder to be the project root, and a save made from a subfolder finds no settings and does nothing. Copied into four more hooks | Change 3 |
| 4 | Prep's research question reads as though no research was done | Step 3b (`8cc105f`, 2026-07-09) predates Principle 14 (`b473d92`, 2026-09-19) | Change 4 |

All four commits were written by Claude. None of the four defects was reported
before this report.

## Change 1: prep briefs skip the option-echo check

**What changes.** `checkOptionEcho` in `hooks/validate-write.mjs` returns early for
a prep brief: a file in a setting's `sessionReportsRoot` whose name ends in
`-PREP.md`, compared case-insensitively. That is the same suffix test `isStaged`
already uses to tell a brief from a staged article. The exemption sits beside the
homebrew one and its comment block grows to cover both.

**Why prep is exempt.**

- The check guards records of what happened. A brief is a plan. In prep, the DM
  picking a scene from the options is the decision itself, which is the same
  reasoning that already exempts the homebrew catalog.
- Nothing downstream treats a brief as a record. Chronicler reads only its Lore
  Resolution section and calls anything sourced from a north star "a plan, excluded
  by 'What an article is'". Content reads it for upcoming scenes. Reports, staged
  articles, recaps, and handouts are all still checked.

**Decision: not "let a sentence pass when its words appear in an earlier session
report"** (the report's first suggestion). Word matching cannot tell planned from
happened. Line 34 of the Zelex's Gambit report says Horatio "meets the party next
session at Large Luigi's Happy Beholder." Under that rule, a later debrief sentence
"Horatio met the party at Large Luigi's Happy Beholder" would pass on the strength
of a plan, which is the 2026-09-18 failure. The check's comment already records the
same limit for negation.

**Decision: not "prep records which report lines each option came from"** (the
report's second suggestion). It would rest on the model keeping that record
accurately, the kind of prose-only safeguard this check was built to replace.

**Decision: the exemption lives in code, not in the rule's `scope`.** Setup's
resync detects drift by rule ID only, so a changed scope would never reach an
installed project. This is why the homebrew exemption lives in code too. The rule's
`description` in `references/base-rules.json` changes to match, for new setups.

## Change 2: on an edit, check only the sentences the edit wrote

**What changes.** For an `Edit`, `main()` in `validate-write.mjs` rebuilds the file
as it stood before the edit. It reads the file from disk as now, then puts
`old_string` back in place of `new_string`. All three are first normalized to LF,
because `parseFrontmatter` normalizes CRLF and the edit's strings may not match the
file's line endings. The rebuilt body goes into the check context as `priorBody`,
and `checkOptionEcho` skips every sentence `priorBody` already held.

- An edit that changes part of a sentence produces a new sentence, which is
  checked.
- An edit whose `new_string` is empty is a deletion: it writes no sentence, so
  nothing is checked.
- When `new_string` appears more than once in the file and `replace_all` is off,
  the edited spot cannot be told from the others, so `priorBody` stays unset and the
  whole body is checked, as today.
- A `Write`, whether it creates a file or rewrites one, checks the whole body, as
  today.

This covers all three of the report's suggestions. Only written sentences are
checked, so an old sentence is never matched against a newer option, and the "cut
it" remedy is only ever offered for text the edit wrote.

**Decision: only `optionEcho` uses `priorBody`.** Every other rule keeps checking the
whole file. The report itself notes that for rules like the em dash, cleaning old
lines on the next edit is cheap and accepted.

**Decision: rebuild from `tool_input`, not `tool_response.originalFile`.** An Edit's
`old_string`, `new_string`, and `replace_all` are documented hook input. The
transcript stores `originalFile` as null for every Edit in the 2026-10-07 session,
so whether a hook receives it cannot be confirmed from here.

**Skipped:** diffing a `Write` that rewrites an existing file. None has been seen
tripping over old text. Add it when one does.

## Change 3: every hook finds the project from any folder

**Evidence.** The 2026-10-07 transcript records the working folder of every write:

| Time (UTC) | Call | Working folder | Hook result |
| --- | --- | --- | --- |
| 12:20:19 | Write, the new brief | `session-reports/rolara/Big-Guys-Gang` | nothing |
| 12:20:23 to 12:20:29 | Edit x3 (report twice, Prep-INDEX) | same | nothing |
| 12:35:52 to 12:36:06 | Edit x6, the brief | project root | blocked, each one |
| 12:36:55 | Edit, the brief | `.../Big-Guys-Gang/prep` | nothing |
| 12:37:29 | Edit, the report | project root | blocked |

The text the hook flagged at 12:36 was on disk at 12:20. The working folder is the
only thing that differs.

**What each hook does from a subfolder today.**

- `validate-write.mjs`: finds no `conventions.json` and exits, so no rule runs.
- `record-options.mjs`: finds no `.professor-orb` and records nothing, so the echo
  check has nothing to compare. The session's options record holds the four
  question rounds asked from the project root and none of the three asked from
  the `Big-Guys-Gang` folder (11:52, 12:00, 12:18).
- `dm-correction.mjs`: finds no conventions, searches no folder, and reports that
  no line matched.
- `block-excluded.mjs`: falls back to its built-in tag list (`NSFW`) instead of the
  project's. Rolara's tag is `NSFW`, so nothing leaked there. A project with its own
  tag would lose that protection.
- `pipeline-next.mjs`: finds no conventions and prints no next step.

**What changes.** A new module, `hooks/project-root.mjs`, exports
`projectRootFrom(dir)`: the nearest folder at or above `dir` that holds
`.professor-orb`. When there is none, it returns `dir` itself, so a project without
professor-orb behaves exactly as before. All five hooks call it with the payload's
`cwd`, falling back to `process.cwd()` as they do now. `pipeline-next.mjs`, which
reads no payload field for this, calls it with `process.cwd()`.

**Which root each path resolves from.** The conventions file, the prong roots, and
the paths shown in messages resolve from the project root. A path the tool call
supplied resolves from the working folder, because that is how the harness resolves
it. In `block-excluded.mjs`, a Grep with no `path` is measured from the project
root. Grep then searches the working folder, which sits at or below the project
root, so measuring from the root can only over-block. The guard stays fail-closed.

**Decision: one shared module, not five copies.** The flaw spread by copying. One
function that all five hooks route through is the smaller fix, and the next hook
gets it for free.

**Decision: walk up from the working folder rather than read `CLAUDE_PROJECT_DIR`.**
The suites drive every hook with a `cwd` field alone, and walking up needs nothing
from the environment.

**Decision: no notice when a check is skipped** (the report's second suggestion).
After the fix, the hooks exit silently in three cases:

- no professor-orb project above the folder;
- a file outside every prong, or one with no `type` in its frontmatter;
- the echo check's "no options record or no readable transcript".

The first two happen on every save in unrelated projects and on every non-article
file, so a notice there is noise. The third was decided in `a3ad4b8`: a block on no
evidence is worse than no block. A harness timeout cannot be reported by the hook
it kills.

## Change 4: prep asks once to save, and says what it already read

**What changes in `skills/prep/SKILL.md`.**

- **Step 3a becomes "Present the draft and ask to save."** Show the complete brief,
  then ask one AskUserQuestion that names the brief's scenes (Principle 15). It
  offers three options:
  - **Save as written.**
  - **Change something first.** The DM describes the change in the notes. Revise,
    re-present the changed sections, and ask again.
  - **Look into more first.** Its description lists what the brief already drew on:
    the session report, the previous brief, and each article or other file read for
    it. When the DM names topics, read those and nothing wider, fold the findings
    into the brief, and ask again.
- Step 3b is removed. Steps 3c, 3d, and 3e become 3b, 3c, and 3d.
- "Things to never do": "the Phase 3 research decision" becomes "the Phase 3 save
  question".

The screen the DM sees at the end of prep, approved with the scope:

```
[ the full brief, shown in chat ]

┌ Save brief ──────────────────────────────────────────────────────┐
│ Save tonight's brief as shown? Scenes: [1], [2], [3].            │
│ ○ Save as written          Write the brief, Prep-INDEX, the log  │
│ ○ Change something first   Describe it in the notes; I'll show   │
│                            the changed sections again            │
│ ○ Look into more first     Already read: the Zelex's Gambit      │
│                            report, the 09-23 brief, and the      │
│                            Horatio, Large Luigi's, and Keiter    │
│                            articles. Name anything beyond those. │
│ ○ Other                                                          │
└──────────────────────────────────────────────────────────────────┘
```

**Decision: the approval moves from free-form chat into AskUserQuestion.**
Approving a draft is a structured decision with fixed answers. The 2026-10-07
session already asked it that way ("Save tonight's brief ...? Save as written /
Change something first"). Discussing a change stays free-form once the DM picks
"Change something first".

## Testing

Node built-ins, as for every suite here.

- `hooks/option-echo.test.mjs`:
  - **Prep.** The 2026-10-07 North Star 1 sentence, with its real option text as
    the record, passes in a `-PREP.md` brief and still blocks in a `-REPORT.md`.
  - **Written sentences only.** An Edit that adds an unrelated line to a report
    already holding the 09-18 sentence passes. An Edit that adds the 09-18 sentence
    blocks. An Edit whose `new_string` appears twice in the file checks the whole
    body and blocks. A deletion passes. In a CRLF file, an Edit with a multi-line
    `new_string` is still diffed, so an unrelated addition passes.
  - **Working folder.** The 09-18 case, run with the working folder at the
    campaign subfolder, still blocks.
- `hooks/record-options.test.mjs`: options asked with the working folder at a
  subfolder are recorded.
- `hooks/block-excluded.test.mjs`: with the working folder at a subfolder, a Read of
  an article carrying a project-specific excluded tag (not `NSFW`) is refused, and a
  content Grep whose relative `path` names a prong folder is refused.
- `hooks/dm-correction.test.mjs`: a correction sent from a subfolder lists the same
  lines as one sent from the root.
- `hooks/pipeline-next.test.mjs`: run from a subfolder, it prints the same
  suggestion as from the root.
- Every existing case passes unchanged, and all 13 suites pass.
- **Live check on rolara before landing, reading files only.** Replay the 12:37:29
  Edit to the Zelex's Gambit report through the new hook, with that session's
  options record and transcript, from the project root and from the
  `Big-Guys-Gang` folder. Today the first blocks and the second is silent; after
  the change, both pass. Then run the same report as a Write from the
  `Big-Guys-Gang` folder. Today it is silent; after the change it blocks exactly as
  from the root. That shows the subfolder now runs every rule.

## Release and rollout

- **Version 1.22.1**, in both `professor-orb/.claude-plugin/plugin.json` and the
  root `.claude-plugin/marketplace.json`. These are fixes and add no rule, so it is a
  patch.
- **The code reaches rolara when it lands on main.** The marketplace is a directory
  source pointing at this repo's main checkout. The 2026-10-07 transcript's hook
  path confirms it:
  `C:\Users\jorda\GitHub\claude-skills_and_plugins-homebrew\professor-orb/hooks/validate-write.mjs`.
- **Nothing changes in rolara's `conventions.json`.** The exemption and the diffing
  live in code. The rule description change reaches only new setups.
- **The Zelex's Gambit report's line 34 needs nothing.** No edit will flag it again
  unless that line is changed.

## Out of scope

- The report's scope note lists three failures that were Claude's own, against
  instructions it already had. All three are fixed in rolara's `2f2f3cc`.
- Rolara's dead-link warning on session reports. It comes from rolara's own project
  rule `contentWikilinkPolicy` (warn), which checks link targets in session reports,
  while rolara's `CLAUDE.md` allows dead links there. It is rolara's rule, not
  professor-orb's.
