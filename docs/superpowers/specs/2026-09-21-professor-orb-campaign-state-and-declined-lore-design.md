# professor-orb: pipeline state per campaign, declined lore, and a session-scoped options file

Design, 2026-09-21. Source: `rolara-project/docs/professor-orb-report-2026-09-21.md`,
compiled from one Big Guy's Gang `prep` run that followed an interrupted
2026-09-20 `debrief` and `chronicler` run.

The report raised four items. Each traced to a cause in the plugin or in the
consumer project, and two of those causes differ from what the report guessed.

| # | Report item | Cause found | Ships |
| --- | --- | --- | --- |
| 1 | Pipeline state is one file shared by every campaign | One slot with no campaign in it; three skills copy `sessionDate` from whatever state is on disk; no lane command commits `.professor-orb/`, so the file reaches main only through hand commits, which conflict | Change 1 |
| 2 | A turned-down chronicler proposal leaves nothing prep can read | Chronicler's approval question offers "reject" and the skill says nothing about what happens next. The interruption did not skip a step; there is no step | Change 2 |
| 3 | `asked-options.json` is left untracked | Setup has ignored it since 1.19.0, and rolara has not resynced. Separately, `validate-write` reads the file without checking `sessionId` | Change 3 |
| 4 | Split-threshold advice fires on every write to a dated series | Not a missing opt-out. The rule is `scope: "kb"`, but rolara's `conventions.json` (generated 2026-07-31) has no `scope` on any of the four structural rules in either setting, so kb-only rules run on session-report writes | Upgrade note only |

## Change 1: pipeline state lives in each campaign's session-reports folder

### The file

`<sessionReportsRoot>/<campaign>/pipeline-state.json`, with the same three fields
as today:

```json
{
  "lastStep": "prep",
  "sessionDate": "2026-09-09",
  "updatedAt": "2026-09-21T13:37:11Z"
}
```

The file has no `campaign` field because its path names the campaign. Everything
below follows from where the file lives:

- **It reaches main with the work it describes.** The file sits inside the
  campaign's lane, so `/log` stages and commits it with the report or brief the
  same run wrote, and it reaches main when that commit does. This needs no new
  mechanism.
- **Two campaigns never write the same file.** Worktrees running different
  campaigns merge without touching each other's state.
- **A skill cannot pick up another campaign's state.** No skill reads another
  run's state at all (see `sessionDate` below).

### Writers

`debrief`, `prep`, `content`, and `chronicler` each end by writing their own
campaign's file, as they end today by writing the shared one. The guard stays:
if `.professor-orb/` does not exist, setup never ran, and the step is skipped
silently.

**A standalone `chronicler` run writes no state.** It has no report and so no
campaign. It is also not a step in any campaign's session pipeline.

### `sessionDate` stops carrying forward

Today `prep`, `content`, and `chronicler` read `sessionDate` from the state on
disk and copy it unchanged. That rule is how a Big Guy's Gang brief would have
been recorded against an Adjustice session. The rule goes. Each writer records
the date of the report it worked from:

| Skill | `sessionDate` |
| --- | --- |
| `debrief` | the session it debriefed (unchanged) |
| `prep` | the session report it read in Inputs |
| `content` | the session report the content was drawn from |
| `chronicler` | the session date of the proposal it executed (the date in the proposal's filename) |

### Readers

**The Stop hook (`hooks/pipeline-next.mjs`)** reads `.professor-orb/conventions.json`,
takes each setting's `sessionReportsRoot`, lists the immediate subfolders, and
reads `pipeline-state.json` from each one that has it. For every state updated
within the last two hours it prints one line, with the campaign folder's name as
a prefix:

```
Big-Guys-Gang: Next: /content can write recaps and handouts, or /chronicler can update the KB.
```

The lane clause and the `versioning.json` read are unchanged. Two campaigns
active in the same session print two lines, which is rare. The fail-silent
contract carries over: a missing or unparseable `conventions.json`, a missing
settings array, or an unreadable, malformed, stale, or unrecognized state file
means no line for that state, and never a crash. A v1 or v2 conventions file
has no settings array, so the hook stays silent until setup resyncs it. The
only tested consumer is already v3.

Listing folders instead of reading each setting's `campaigns` array means a
campaign added by hand, or one missing from `campaigns`, still gets its
suggestion. A retired campaign's folder is also listed, but its state is long
past two hours old.

**The `orb` skill** answers "where were we?" per campaign:

- The DM named a campaign: report that campaign's state.
- No campaign named: report each campaign that has a state file, with its
  `lastStep` and `sessionDate`.
- `.professor-orb/` exists but no campaign has a state file: the pipeline has
  not started, so suggest `debrief`. This case replaces today's "`{}` with no
  `lastStep`" case.

### Setup

- Step 12 no longer writes `.professor-orb/pipeline-state.json` as `{}`.
- Step 3's ignore list drops `.professor-orb/pipeline-state.json`. The new
  files are meant to be tracked, and they live under the session-reports
  root, which no entry ignores.
- **On a resync, Step 12 deletes a legacy `.professor-orb/pipeline-state.json`**,
  with `git rm` if it is tracked, in the same place it already deletes
  `conventions.json.pre-migration`. Step 5's snapshot has captured the file.
  It has no campaign field, so it cannot be converted, and nothing reads it
  after this change.

### Wording that changes

- `README.md` (lines 14, 58, 60), `SHARED-PRINCIPLES.md` §10, and the
  final-act section of each of the four writers.
- Every standalone component's "never writes `.professor-orb/pipeline-state.json`"
  line (`/catalog`, `/log`, `/scribe`, `/migrate`, `homebrew`, `timeline`,
  `forge-prompt`, `orb`) becomes "never writes pipeline state". The path moved,
  and the path was never the point of the rule.
- `/log`'s description gains pipeline state in its list of what the lane
  holds.
- `CONTEXT.md`'s **pipeline state** entry: one file per campaign, in the
  campaign's session-reports folder. Its **log command** entry names the file
  as part of the lane.

### Rejected

- **`.professor-orb/pipeline-state/<campaign>.json`.** Keeps plugin state in
  the plugin's folder, but no lane command commits `.professor-orb/`, so the
  file would reach main only through the hand commits that produced the
  conflict in the first place.
- **One file keyed by campaign.** Git merges line by line, so two worktrees
  editing neighbouring keys still conflict.
- **A `campaign` field inside today's single file.** It stops the wrong read
  but still keeps one slot, so one campaign's state overwrites another's.

## Change 2: a declined lore item comes off the list

`prep` builds Lore Resolution from unticked Lore Candidates, and a checkbox has
two states. The fix gives chronicler a way to turn a declined item into one of
those two states rather than adding a third: an item declined for good is
**deleted** from the list, and an item set aside is left as it is. An unticked
item already carries forward, so "set aside" needs no action, and `prep` needs
no change.

### Proposal section 7: Lore Items to Remove

The proposal file gains a section between section 6 and Deferred / Flagged:

```
## 7. Lore Items to Remove (count)
| Item | Carrier(s) | DM's reason |
|------|-----------|-------------|
```

Step 2b's last step (marking resolved lore items) also executes this table.
For each row, it deletes the item's line, and any resolution-note line beneath
it, from every carrier that holds it: the session report's Lore Candidates
section and the prep brief's Lore Resolution section. As with resolution
marking, a missing carrier is named in the report-back and never fails the run.
The report-back gains a **Lore items removed (N)** line.

### How an item reaches section 7

- **The DM cuts an item in chat**, during review or a walk-through. Chronicler
  asks with AskUserQuestion whether the item is off the list for good or only
  out of this pass. For good: the row moves to section 7 with the DM's reason
  in their words. This pass only: the row leaves the proposal and the Lore
  Candidate stays unticked.
- **The DM edits the proposal file by hand.** Deleting a row means "not this
  pass". Moving the row to section 7 means "off the list for good". Step 1c's
  note to the DM about hand edits says so.

### The DM rejects the whole proposal

1. The Status line becomes `Rejected YYYY-MM-DD: <the DM's reason, if they gave one>`.
2. Chronicler asks once, with AskUserQuestion: take all of the proposal's lore
   items off the list, keep all of them for a later pass, or decide item by
   item in chat.
3. Items taken off are deleted from their carriers exactly as section 7 rows
   are.
4. Nothing else executes. No article, index, or log is touched, and no pipeline
   state is written, because no pipeline step completed.

### Wording that changes

- The Step 1c approval question's reject option now leads somewhere: add the
  whole-rejection path above as its own step, after Step 1d.
- "Never edit narrative content in session reports or prep files" gains one
  more permitted work-tracking edit: deleting a declined item from Lore
  Candidates or Lore Resolution.

### Rejected

- **Tick the declined item and annotate it.** This works through the same
  checkbox, but it leaves a line whose only purpose is to say "ignore me".
- **A settled list in the brief** (the report's suggestion). This needs a new
  brief section and a new `prep` rule for a list the DM has already decided
  about.

**The cost of deleting:** the DM's reason survives only in the proposal file's
section 7 and Status line, and rolara ignores `.professor-orb/proposals/`. If
the KB still holds the sentences a declined edit targeted, a later `debrief`'s
lore agent can raise the same candidate again. The DM declines it again. A
record in the report would not prevent this, because the lore agent does not
read past reports.

## Change 3: the options record moves to OS temp, one file per session

### The path

```js
// ponytail: one small file per questioning session is left for the OS's temp cleanup.
path.join(os.tmpdir(), "professor-orb", `asked-options-${sessionId}.json`)
```

The file holds `{ "options": [...] }`. The file name carries the session, so
the `sessionId` field and the stale-session comparison in `record-options.mjs`
go away. Both were only there to tell one session's record from another's.

### `record-options.mjs`

- `session_id` becomes part of a file name, so the hook exits 0 without writing
  unless it matches `^[A-Za-z0-9_-]+$`. That excludes path traversal.
- It creates `<tmpdir>/professor-orb/` if needed (`mkdirSync` with
  `recursive: true`) and appends to the file. The "`.professor-orb/` missing
  means setup never ran, exit" gate stays.
- The header comment's `.gitignore` paragraph is replaced: the file is never
  inside the project, so git cannot see it.

### `validate-write.mjs`

`main()` carries `input.session_id` into `ctx`. `checkOptionEcho` reads the
same path. A missing or invalid session ID, or a missing file, passes, which is
the same as today's missing-file behaviour.

This also fixes a bug the report did not name. Today `checkOptionEcho` reads
`.professor-orb/asked-options.json` without comparing its `sessionId`, so until
a new session asks its first question, the previous session's options can
block this session's writes. The recorder's own comment says that must never
happen. With a per-session file name, one session cannot read another's
options.

### One path in two hooks

No hook imports a shared module today, and this change does not add one. Each
hook defines the path expression itself. An end-to-end test runs
`record-options.mjs` and then `validate-write.mjs` with the same session ID,
both with the temp directory pointed at the test's own folder through `TEMP`,
`TMP`, and `TMPDIR`. If the two paths ever drift apart, that test fails before
the check can go quietly inert.

### Setup

Step 3's ignore list drops `.professor-orb/asked-options.json`.

## Item 4: no plugin change

`validate-write` skips a `scope: "kb"` rule for a file outside `kbRoot`, which
is correct. The consumer's rules have no `scope` to skip on. Setup's resync
rebuilds the base layer from `references/base-rules.json` rather than carrying
it over (setup Step 11), so a resync
restores `scope: "kb"` on all four structural rules.

A drift detector was considered and deferred: `validate-write` comparing each
`provenance: "professor-orb"` rule against `base-rules.json`. It would have
caught this, but it is one incident with a one-command fix. Add the detector if
a second consumer file drifts the same way.

## Upgrading an existing project (1.20.0)

For rolara, and for any project set up before 1.20.0:

1. **Run setup's resync.** This restores `scope: "kb"` on the structural rules
   and deletes the legacy `.professor-orb/pipeline-state.json`. Each campaign's
   state starts again on that campaign's next pipeline run.
2. **Delete `.professor-orb/asked-options.json`** if it is present. Nothing
   writes or reads it after 1.20.0.
3. **Leave the old `.gitignore` entries** for those two files. Setup only ever
   appends to `.gitignore`, and an entry for a file that no longer exists does
   no harm.

## Testing

Node built-ins, no framework, as the existing suites are.

- **`hooks/pipeline-next.test.mjs`**, moved to the new layout:
  - a fresh state in one campaign prints one line with that campaign's prefix
  - fresh states in two campaigns print two lines
  - a stale, malformed, or unrecognized state prints nothing for that campaign
    and does not suppress another campaign's line
  - no `conventions.json`, or one without `settings`, prints nothing
  - a legacy `.professor-orb/pipeline-state.json` is ignored
  - the lane-clause cases keep their current coverage
- **`hooks/record-options.test.mjs`**:
  - writes to the per-session temp path
  - two session IDs produce two files
  - a session ID containing `..` or a path separator writes nothing
  - no `.professor-orb/` writes nothing
- **`hooks/option-echo.test.mjs`**:
  - seeds the per-session temp path instead of `.professor-orb/asked-options.json`
  - another session's file does not block the write
  - the end-to-end case from "One path in two hooks"

Changes 1 and 2's skill and prose edits have no automated tests. The review
pass checks every "pipeline-state" and "never writes" mention against the new
wording with a grep.

## Release

1.20.0, bumped in both `.claude-plugin/marketplace.json` and
`professor-orb/.claude-plugin/plugin.json`.
