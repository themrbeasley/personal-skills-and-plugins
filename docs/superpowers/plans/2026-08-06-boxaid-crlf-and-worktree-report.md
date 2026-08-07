# Boxaid CRLF Root Cause and `/call-start` Worktree Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `/teardown` failing in worktrees by pinning the workflow sidecars to LF, harden the workflow against empty payloads, and give `/call-start` a cross-worktree state report.

**Architecture:** Four independent changes across two repos. The consumer repo (`Boxaid Work`) gets a `.gitattributes`, a working-tree refresh, and two edits to `teardown-close-out.js`. This monorepo gets the canonical `/call-start` edit, which is then mirrored into the consumer repo. A final verification task runs the test that decides whether the handoff's host-bug claim survives.

**Tech Stack:** git attributes, Node 24 (built-in test assertions, no framework), PowerShell 5.1, Claude Code command markdown.

**Spec:** `docs/superpowers/specs/2026-08-06-call-start-worktree-report-design.md`

## Global Constraints

- **Two repos.** MONOREPO = `C:\Users\jorda\OneDrive\Documents\GitHub\claude-skills_and_plugins-homebrew\.claude\worktrees\migrate-merge-safety-guard-1b9611`. CONSUMER = `C:\Users\jorda\OneDrive\Documents\Claude\Projects\Boxaid Work`. Never run a git command in one expecting it to affect the other. Use `git -C "<path>"` rather than `cd`.
- **No em dashes anywhere**, including in `.js` and `.ps1` files. A PostToolUse hook rejects `.md` writes containing them and a tracked `.githooks/pre-commit` blocks commits, but **no check covers `.js` or `.ps1`**, so those are on you to keep clean.
- **No client PII** in any file, commit message, or test fixture. Refer to clients generically. Privacy is fireable.
- **`git status` is not authoritative for "is there a real change." `git diff` is.** Files can appear modified with an empty diff.
- **Use `git cat-file blob HEAD:<file>` to inspect stored content**, never `git show HEAD:<file>`, which applies the checkout filter and returns converted bytes. This exact mistake caused a wrong diagnosis on 2026-08-06.
- **`[System.IO.File]::*` methods ignore PowerShell's `Set-Location`** and resolve relative paths against the .NET process working directory. In a multi-worktree repo that silently writes to the wrong worktree. Use absolute paths.
- **PowerShell here is 5.1.** No `&&`/`||` chain operators, no ternary, no `??`, no `-AsHashtable`. Use `if/else` and `;`.
- **Verify line endings by raw byte count**, not `grep`. A `grep -c $'\r'` invocation silently collapsed to an empty pattern during diagnosis and reported every line as a match. The reliable form is in Task 1 Step 2.
- **`guard-protected-writes` over-blocks.** A PowerShell command containing both `Remove-Item` and a regex literal gets denied because the hook reads the pattern as a path being deleted. Split such a command into two calls.

---

## File Structure

| File | Repo | Responsibility |
|---|---|---|
| `.gitattributes` | CONSUMER | Pin the two workflow sidecars to LF on every checkout. New file. |
| `.claude/workflows/teardown-close-out.js` | CONSUMER | Fan-out engine. Gains an empty-payload guard and a hardened verifier prompt. |
| `.claude/workflows/teardown-close-out.guard.test.mjs` | CONSUMER | New. Tests the guard against the real shipped source. |
| `boxaid-call-ops/commands/call-start.md` | MONOREPO | Canonical `/call-start`. Gains the worktree report step. |
| `.claude/commands/call-start.md` | CONSUMER | Mirror of the above. Must stay byte-identical modulo line endings. |

---

## Task 1: Pin the workflow sidecars to LF

**Files:**
- Create: `<CONSUMER>/.gitattributes`

**Interfaces:**
- Consumes: nothing.
- Produces: the LF guarantee every later task depends on. Task 2 refreshes existing copies against it; Task 7's by-name test is only meaningful once it exists.

- [ ] **Step 1: Confirm the stored blob is already LF**

The fix pins checkout behavior. It does not renormalize history, so confirm history is already clean first. Run from anywhere:

```bash
R="C:/Users/jorda/OneDrive/Documents/Claude/Projects/Boxaid Work"
git -C "$R" cat-file blob HEAD:.claude/workflows/teardown-close-out.js | od -An -tx1 -v | tr ' ' '\n' | grep -c '^0d'
```

Expected: `0`

If this prints anything other than `0`, STOP. The stored blob itself carries CRLF and this plan's approach is wrong: history would need `git add --renormalize` as a separate first commit. Report that and do not continue.

- [ ] **Step 2: Record the current per-worktree state as the before-picture**

```bash
R="C:/Users/jorda/OneDrive/Documents/Claude/Projects/Boxaid Work"
for W in "$R" "$R/.claude/worktrees/cranky-rubin-7348ae" "$R/.claude/worktrees/malware-notifications-chrome-4637b1" "$R/.claude/worktrees/serene-haibt-549c5e" "$R/.claude/worktrees/teamviewer-two-pc-setup-ca46aa"; do
  f="$W/.claude/workflows/teardown-close-out.js"
  printf '%-42s CR=%s\n' "$(basename "$W")" "$(od -An -tx1 -v "$f" | tr ' ' '\n' | grep -c '^0d')"
done
```

Expected: `Boxaid Work` reads `CR=0`; the other four read `CR=232`.

- [ ] **Step 3: Create the `.gitattributes`**

Create `<CONSUMER>/.gitattributes` with exactly this content:

```
# core.autocrlf is true on this machine, which rewrites LF to CRLF on every
# fresh checkout. The main working tree keeps LF because its copy was written
# by an editor and never re-checked-out, but every worktree is created by a
# checkout, so every worktree copy gets a CR on every line. The Workflow tool
# rejects a script containing control characters, and CR (0x0D) is one, so
# /teardown failed in worktrees and worked in main. Diagnosed 2026-08-06.
#
# Pinning eol=lf makes every checkout byte-identical to the stored blob on
# every platform. Scoped to the workflow sidecars deliberately: a repo-wide
# rule would rewrite every tracked file at once and no other file has shown
# this failure.
.claude/workflows/*.js   eol=lf
.claude/workflows/*.html eol=lf
```

- [ ] **Step 4: Prove the attribute is actually applied**

```bash
R="C:/Users/jorda/OneDrive/Documents/Claude/Projects/Boxaid Work"
git -C "$R" check-attr eol -- .claude/workflows/teardown-close-out.js
git -C "$R" check-attr eol -- .claude/workflows/report-template.html
```

Expected, both lines:
```
.claude/workflows/teardown-close-out.js: eol: lf
.claude/workflows/report-template.html: eol: lf
```

If it reports `unspecified`, the file is not being matched. Do not proceed.

- [ ] **Step 5: Commit**

```bash
R="C:/Users/jorda/OneDrive/Documents/Claude/Projects/Boxaid Work"
git -C "$R" add .gitattributes
git -C "$R" commit -m "fix: pin workflow sidecars to LF so worktree checkouts stay clean

core.autocrlf rewrites LF to CRLF on every fresh checkout. The main
working tree kept LF because its copy was never re-checked-out, so all
four worktrees carried a CR on every one of 232 lines while main read
clean. The Workflow tool rejects scripts containing control characters
and CR is one, which is why /teardown failed only in worktrees.

Verified by raw byte count, not grep."
```

- [ ] **Step 6: Prove a fresh checkout is now clean**

This is the case the fix exists for. Create a throwaway worktree from the commit that has the attribute, measure, then remove it.

```bash
R="C:/Users/jorda/OneDrive/Documents/Claude/Projects/Boxaid Work"
git -C "$R" worktree add "$R/.claude/worktrees/zz-eol-probe" main
od -An -tx1 -v "$R/.claude/worktrees/zz-eol-probe/.claude/workflows/teardown-close-out.js" | tr ' ' '\n' | grep -c '^0d'
```

Expected: `0`

Then remove it (two separate commands: `guard-protected-writes` may deny a single command containing both a removal verb and a path pattern):

```bash
R="C:/Users/jorda/OneDrive/Documents/Claude/Projects/Boxaid Work"
git -C "$R" worktree remove "$R/.claude/worktrees/zz-eol-probe"
```

```bash
R="C:/Users/jorda/OneDrive/Documents/Claude/Projects/Boxaid Work"
git -C "$R" worktree list
```

Expected: the probe is gone and the original five worktrees remain.

---

## Task 2: Refresh the four stale worktree copies

**Files:**
- Modify (working tree only, no commit): the two sidecar files inside each of the four existing worktrees.

**Interfaces:**
- Consumes: Task 1's `.gitattributes`.
- Produces: four worktrees whose sidecar copies read CR=0, so reusing any of them does not reproduce the bug.

**Why a plain re-checkout is not enough:** `.gitattributes` is read from the *working tree*, and these four worktrees are checked out at commits that predate it. Git in those worktrees cannot see the attribute, so `git checkout -- <file>` there would re-apply the old conversion. Stripping the CR bytes in place achieves the same end state without merging anything.

**Why this is safe:** with `core.autocrlf=true` and no attribute in effect, git normalizes CRLF to LF when comparing the working file against the blob. Both a CRLF copy and an LF copy compare equal to the LF blob, so these worktrees stay clean either way.

- [ ] **Step 1: Re-verify every worktree is clean before touching anything**

Do not trust the spec's survey. Re-check now.

```bash
R="C:/Users/jorda/OneDrive/Documents/Claude/Projects/Boxaid Work"
for W in "$R/.claude/worktrees/cranky-rubin-7348ae" "$R/.claude/worktrees/malware-notifications-chrome-4637b1" "$R/.claude/worktrees/serene-haibt-549c5e" "$R/.claude/worktrees/teamviewer-two-pc-setup-ca46aa"; do
  printf '%-42s |%s|\n' "$(basename "$W")" "$(git -C "$W" status --porcelain)"
done
```

Expected: every line ends with `||` (empty between the pipes).

If any worktree reports content, STOP and report which one. Do not strip files in a worktree holding uncommitted work.

- [ ] **Step 2: Strip the CR bytes in place**

```bash
R="C:/Users/jorda/OneDrive/Documents/Claude/Projects/Boxaid Work"
for W in "$R/.claude/worktrees/cranky-rubin-7348ae" "$R/.claude/worktrees/malware-notifications-chrome-4637b1" "$R/.claude/worktrees/serene-haibt-549c5e" "$R/.claude/worktrees/teamviewer-two-pc-setup-ca46aa"; do
  for f in "$W/.claude/workflows/teardown-close-out.js" "$W/.claude/workflows/report-template.html"; do
    tr -d '\r' < "$f" > "$f.tmp" && mv "$f.tmp" "$f"
  done
done
```

- [ ] **Step 3: Verify all four are now clean LF and still git-clean**

```bash
R="C:/Users/jorda/OneDrive/Documents/Claude/Projects/Boxaid Work"
for W in "$R/.claude/worktrees/cranky-rubin-7348ae" "$R/.claude/worktrees/malware-notifications-chrome-4637b1" "$R/.claude/worktrees/serene-haibt-549c5e" "$R/.claude/worktrees/teamviewer-two-pc-setup-ca46aa"; do
  f="$W/.claude/workflows/teardown-close-out.js"
  printf '%-42s CR=%-4s git:|%s|\n' "$(basename "$W")" "$(od -An -tx1 -v "$f" | tr ' ' '\n' | grep -c '^0d')" "$(git -C "$W" status --porcelain)"
done
```

Expected: every line reads `CR=0` and `git:||`.

If a worktree now shows as dirty, the strip changed what git sees. Restore it with `git -C "<that worktree>" checkout -- .claude/workflows/` and report.

- [ ] **Step 4: No commit**

This task changes only working-tree bytes in worktrees whose branches are already merged. There is nothing to commit. Confirm with the command in Step 3 that git reports clean, and move on.

---

## Task 3: Throw on an empty payload

**Files:**
- Modify: `<CONSUMER>/.claude/workflows/teardown-close-out.js:11-16`
- Test: `<CONSUMER>/.claude/workflows/teardown-close-out.guard.test.mjs` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: marker comments `// GUARD-START` and `// GUARD-END` bracketing the payload-parsing block. The test in this task extracts the source between those markers and evaluates it, so later edits inside that block stay covered. Do not remove the markers.

**Background:** the host delivers `args` as a JSON string, so `args.foo` reads `undefined`. Today `|| {}` turns a missing payload into an empty object and the only thing that stops the run is the separate `callDate` check. That produces a message about a missing date when the real problem is a missing payload. During the 2026-08-06 session an ad-hoc script without the guard fed subagents an empty payload; two consecutive review passes located a stale artifact on disk and returned confident findings about superseded content before a third pass reported the empty payload.

- [ ] **Step 1: Write the failing test**

Create `<CONSUMER>/.claude/workflows/teardown-close-out.guard.test.mjs`:

```js
// Tests the real shipped guard, not a copy of it. Reads the source between the
// GUARD-START and GUARD-END markers and evaluates that block with a supplied
// args value, so the test cannot drift from the code it covers.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, 'teardown-close-out.js'), 'utf8')

const start = src.indexOf('// GUARD-START')
const end = src.indexOf('// GUARD-END')
assert.ok(start !== -1, 'GUARD-START marker missing from teardown-close-out.js')
assert.ok(end > start, 'GUARD-END marker missing or before GUARD-START')

const guardSrc = src.slice(start, end)
const runGuard = (argsValue) => new Function('args', guardSrc + '\nreturn { input, call, callDate }')(argsValue)

let failures = 0
const check = (name, fn) => {
  try {
    fn()
    console.log('  ok   ' + name)
  } catch (e) {
    failures++
    console.log('  FAIL ' + name + ': ' + e.message)
  }
}

console.log('teardown-close-out guard')

check('throws when args is undefined', () => {
  assert.throws(() => runGuard(undefined), /empty/i)
})

check('throws when args is an empty object', () => {
  assert.throws(() => runGuard({}), /empty/i)
})

check('throws when args is an empty JSON string', () => {
  assert.throws(() => runGuard('{}'), /empty/i)
})

check('throws when call is present but empty', () => {
  assert.throws(() => runGuard({ callDate: '2026-08-06', call: {} }), /call/i)
})

check('accepts a populated object payload', () => {
  const r = runGuard({ callDate: '2026-08-06', call: { symptom: 'slow boot' } })
  assert.equal(r.callDate, '2026-08-06')
  assert.equal(r.call.symptom, 'slow boot')
})

check('accepts a populated JSON string payload', () => {
  const r = runGuard(JSON.stringify({ callDate: '2026-08-06', call: { symptom: 'slow boot' } }))
  assert.equal(r.callDate, '2026-08-06')
  assert.equal(r.call.symptom, 'slow boot')
})

check('still throws when callDate is missing but call is populated', () => {
  assert.throws(() => runGuard({ call: { symptom: 'slow boot' } }), /callDate/)
})

if (failures > 0) {
  console.log(failures + ' failure(s)')
  process.exit(1)
}
console.log('all passed')
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
node "C:/Users/jorda/OneDrive/Documents/Claude/Projects/Boxaid Work/.claude/workflows/teardown-close-out.guard.test.mjs"
```

Expected: exits non-zero with `GUARD-START marker missing from teardown-close-out.js`. The markers do not exist yet, so the assertion at the top fires before any test runs.

- [ ] **Step 3: Add the markers and the empty-payload guard**

In `<CONSUMER>/.claude/workflows/teardown-close-out.js`, replace lines 11 through 25 (the comment block, the `input`/`call`/`callDate` assignments, and the existing `callDate` throw) with:

```js
// GUARD-START
// The workflow needs the call facts passed in via args. It cannot read the clock
// (Date.now is unavailable in workflow scripts), so callDate is required.
// args may arrive already parsed (an object) or, on some hosts, as the raw JSON
// string the caller passed. Accept both so the same invocation works either way.
const input = (typeof args === 'string' && args.trim() ? JSON.parse(args) : args) || {}

// An empty payload must stop the run, not proceed with {}. A subagent handed an
// empty payload does not fail: it finds a plausible older artifact on disk and
// returns confident, well-argued findings about superseded content. That happened
// on 2026-08-06, when two consecutive review passes silently reviewed a stale
// artifact before a third reported the empty payload. Fail loudly here instead.
if (typeof input !== 'object' || input === null || Object.keys(input).length === 0) {
  throw new Error(
    'teardown-close-out: args arrived empty. This host delivers args as a JSON ' +
      'string, so a caller reading args.foo directly gets undefined and passes ' +
      'nothing through. Refusing to run rather than fan out an empty payload. ' +
      'Pass { callDate, outcome, pageType, hasFileableLesson, call }.',
  )
}

const call = input.call || {}
const callDate = input.callDate
if (!callDate) {
  throw new Error(
    'teardown-close-out: args.callDate is required (scripts cannot read the clock). ' +
      'Pass the session date, for example { callDate: "2026-08-06", outcome: "fixed", ' +
      'pageType: "fix", call: { symptom, rootCause, fixSteps, ' +
      'verification, tier, amountCharged, tip, paid, ... } }.',
  )
}
if (Object.keys(call).length === 0) {
  throw new Error(
    'teardown-close-out: args.call is empty. Every generator prompt embeds the call ' +
      'facts, so an empty call object produces four artifacts drafted from nothing. ' +
      'Pass the technical facts: symptom, rootCause, fixSteps, verification, tier, ' +
      'amountCharged, tip, paid, and the security-review items checked.',
  )
}
// GUARD-END
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
node "C:/Users/jorda/OneDrive/Documents/Claude/Projects/Boxaid Work/.claude/workflows/teardown-close-out.guard.test.mjs"
```

Expected: seven `ok` lines then `all passed`, exit code 0.

- [ ] **Step 5: Confirm no em dash reached the file**

No hook covers `.js`, so check by hand.

```bash
grep -n '—' "C:/Users/jorda/OneDrive/Documents/Claude/Projects/Boxaid Work/.claude/workflows/teardown-close-out.js" || echo "clean"
```

Expected: `clean`

- [ ] **Step 6: Commit**

```bash
R="C:/Users/jorda/OneDrive/Documents/Claude/Projects/Boxaid Work"
git -C "$R" add .claude/workflows/teardown-close-out.js .claude/workflows/teardown-close-out.guard.test.mjs
git -C "$R" commit -m "fix: throw on an empty args payload instead of fanning out nothing

The host delivers args as a JSON string, so a caller reading args.foo
gets undefined and passes nothing through. The old guard turned that
into {} and let the run continue, and a subagent handed an empty
payload does not fail. It locates a plausible older artifact on disk
and returns confident findings about superseded content. On 2026-08-06
two consecutive review passes reviewed a stale artifact that way.

Adds a test that evaluates the real guard source between marker
comments, so it cannot drift from the code it covers."
```

---

## Task 4: Stop verifiers substituting a source for an empty payload

**Files:**
- Modify: `<CONSUMER>/.claude/workflows/teardown-close-out.js` (the `verifyPrompt` function, currently lines 189-206)

**Interfaces:**
- Consumes: nothing. Independent of Task 3, though it addresses the same incident.
- Produces: nothing later tasks read.

**Background:** Task 3 stops the workflow starting with an empty payload. This task covers the other half: a verifier that receives an empty or malformed artifact mid-run must fail rather than go looking for another copy. The verifier prompt currently embeds the artifact and lists three checks, none of which cover the artifact being empty.

- [ ] **Step 1: Add the empty-artifact check as check zero**

In `verifyPrompt`, insert a new line immediately after the `'Check, and FAIL on any hit:',` line and before the line beginning `'1. PII leak:'`:

```js
    '0. Empty or malformed payload: if the artifact JSON above is empty, is {}, or is missing the fields this kind requires, FAIL immediately with severity "blocking" and say so in issues. Do NOT search the repo for another copy of this artifact, do NOT read any file from disk to substitute for it, and do NOT review anything other than the JSON printed above. A confident review of a stale artifact is worse than no review: it reads as a pass on work that was never checked.',
```

- [ ] **Step 2: Verify the prompt renders with the new check**

Confirm the string is present and the surrounding array still joins cleanly:

```bash
grep -n "0. Empty or malformed payload" "C:/Users/jorda/OneDrive/Documents/Claude/Projects/Boxaid Work/.claude/workflows/teardown-close-out.js"
node --check "C:/Users/jorda/OneDrive/Documents/Claude/Projects/Boxaid Work/.claude/workflows/teardown-close-out.js" 2>&1 || echo "NOTE: top-level await/return is expected to fail --check; confirm the error names await or return, not a syntax error in the string you added"
```

Expected: the grep prints the new line. `node --check` will report an error about top-level `await` or `return`, which is normal for a workflow script and not a defect. What matters is that the error does not name an unterminated string or unexpected token.

- [ ] **Step 3: Re-run the guard test to confirm nothing regressed**

```bash
node "C:/Users/jorda/OneDrive/Documents/Claude/Projects/Boxaid Work/.claude/workflows/teardown-close-out.guard.test.mjs"
```

Expected: `all passed`, exit code 0.

- [ ] **Step 4: Check for em dashes**

```bash
grep -n '—' "C:/Users/jorda/OneDrive/Documents/Claude/Projects/Boxaid Work/.claude/workflows/teardown-close-out.js" || echo "clean"
```

Expected: `clean`

- [ ] **Step 5: Commit**

```bash
R="C:/Users/jorda/OneDrive/Documents/Claude/Projects/Boxaid Work"
git -C "$R" add .claude/workflows/teardown-close-out.js
git -C "$R" commit -m "fix: make verifiers fail on an empty artifact instead of finding another

A verifier handed an empty artifact previously had no instruction
covering that case, so it would locate a plausible copy on disk and
review that instead. The result reads as a pass on work that was never
checked. Check zero now fails blocking and forbids substituting a
source or reading any file to stand in for the inline payload."
```

---

## Task 5: Add the worktree report to `/call-start` (canonical)

**Files:**
- Modify: `<MONOREPO>/boxaid-call-ops/commands/call-start.md`, inserting a new section between the end of Speed 1 and the `## Speed 2` heading.

**Interfaces:**
- Consumes: nothing.
- Produces: the exact markdown block Task 6 copies verbatim into the consumer repo.

**Critical distinction to preserve:** the Tune-Up Snapshot in Speed 1 is PowerShell the operator pastes onto the **client machine**. The block added here runs **locally on the operator's own machine**. The section text must make that unmistakable, because an agent that confuses the two would paste repo diagnostics into a client's terminal.

- [ ] **Step 1: Insert the new section**

In `<MONOREPO>/boxaid-call-ops/commands/call-start.md`, add the following immediately after the Speed 1 block (after the line `Then tell him in one line that call mode is armed and the kill guard is at full scope.`) and immediately before `## Speed 2: the KB briefing (only if a symptom was passed)`:

````markdown
## Speed 1b: the worktree report (first response, always, after the snapshot)

Run this on YOUR machine, in this repo. It is not for the client and never gets pasted into the client's PowerShell. It runs only after the Tune-Up Snapshot is already on screen, so it cannot delay the one thing that has to go out first.

Parallel worktrees give work nowhere to be loud: nothing otherwise surfaces work that was done but never committed, or committed but never merged. Report it in about four lines, then move on. It is orientation, not a gate. If it errors, say nothing about it and carry on.

```powershell
$ErrorActionPreference = 'SilentlyContinue'
$wts = @(); $cur = $null
foreach ($l in (git worktree list --porcelain)) {
  if ($l -like 'worktree *') {
    if ($cur) { $wts += $cur }
    $cur = [pscustomobject]@{ Path = $l.Substring(9); Branch = '(detached)'; Dirty = 0; Gone = $false }
  } elseif ($l -like 'branch *') { $cur.Branch = $l -replace '^branch refs/heads/', '' }
}
if ($cur) { $wts += $cur }
if ($wts.Count -gt 0) {
  foreach ($w in $wts) {
    if (-not (Test-Path -LiteralPath $w.Path)) { $w.Gone = $true; continue }
    $w.Dirty = @(@(git -C $w.Path diff --name-only) + @(git -C $w.Path diff --cached --name-only) + @(git -C $w.Path ls-files --others --exclude-standard) | Sort-Object -Unique).Count
  }
  $mainWt = $wts | Where-Object { $_.Branch -eq 'main' }
  $others = $wts | Where-Object { $_.Branch -ne 'main' }
  $unmerged = @(git branch --no-merged main --format='%(refname:short)')
  $noise = $false
  if ($mainWt -and $mainWt.Dirty -gt 0) {
    Write-Host ("MAIN TREE DIRTY: {0} uncommitted file(s). On nobody's branch. Do not run a checkout over it." -f $mainWt.Dirty)
    $noise = $true
  }
  foreach ($w in $others) {
    if ($w.Gone) { Write-Host ("stale worktree: {0} (git worktree prune)" -f (Split-Path $w.Path -Leaf)); $noise = $true }
    elseif ($w.Dirty -gt 0) { Write-Host ("{0} [{1}]: {2} uncommitted" -f (Split-Path $w.Path -Leaf), $w.Branch, $w.Dirty); $noise = $true }
  }
  if ($unmerged.Count -gt 0) { Write-Host ("not merged into main: {0}" -f ($unmerged -join ', ')); $noise = $true }
  if (-not $noise) { Write-Host ("Worktrees: {0} open, all clean, all merged into main." -f $wts.Count) }
}
```

Report what it printed in at most two lines of your own. Do not paste the raw output if it is long, and do not offer to clean anything up unless he asks. `git diff` is used rather than `git status` on purpose: a file can show as modified with an empty diff, and a report that fires on that teaches him to ignore it.
````

- [ ] **Step 2: Confirm no em dash entered the file**

```bash
grep -n '—' "C:/Users/jorda/OneDrive/Documents/GitHub/claude-skills_and_plugins-homebrew/.claude/worktrees/migrate-merge-safety-guard-1b9611/boxaid-call-ops/commands/call-start.md" || echo "clean"
```

Expected: `clean`

- [ ] **Step 3: Syntax-check the PowerShell block**

Extract the block and parse it without running it:

```powershell
$src = Get-Content -Raw 'C:\Users\jorda\OneDrive\Documents\GitHub\claude-skills_and_plugins-homebrew\.claude\worktrees\migrate-merge-safety-guard-1b9611\boxaid-call-ops\commands\call-start.md'
$m = [regex]::Match($src, '(?s)```powershell\r?\n\$ErrorActionPreference(.*?)```')
$code = '$ErrorActionPreference' + $m.Groups[1].Value
$errs = $null
[System.Management.Automation.Language.Parser]::ParseInput($code, [ref]$null, [ref]$errs) | Out-Null
if ($errs.Count -eq 0) { Write-Host 'PowerShell parses clean' } else { $errs | ForEach-Object { Write-Host $_.Message } }
```

Expected: `PowerShell parses clean`

- [ ] **Step 4: Run the block for real in this monorepo worktree**

```powershell
$ErrorActionPreference = 'SilentlyContinue'
$wts = @(); $cur = $null
foreach ($l in (git worktree list --porcelain)) {
  if ($l -like 'worktree *') {
    if ($cur) { $wts += $cur }
    $cur = [pscustomobject]@{ Path = $l.Substring(9); Branch = '(detached)'; Dirty = 0; Gone = $false }
  } elseif ($l -like 'branch *') { $cur.Branch = $l -replace '^branch refs/heads/', '' }
}
if ($cur) { $wts += $cur }
if ($wts.Count -gt 0) {
  foreach ($w in $wts) {
    if (-not (Test-Path -LiteralPath $w.Path)) { $w.Gone = $true; continue }
    $w.Dirty = @(@(git -C $w.Path diff --name-only) + @(git -C $w.Path diff --cached --name-only) + @(git -C $w.Path ls-files --others --exclude-standard) | Sort-Object -Unique).Count
  }
  $mainWt = $wts | Where-Object { $_.Branch -eq 'main' }
  $others = $wts | Where-Object { $_.Branch -ne 'main' }
  $unmerged = @(git branch --no-merged main --format='%(refname:short)')
  $noise = $false
  if ($mainWt -and $mainWt.Dirty -gt 0) {
    Write-Host ("MAIN TREE DIRTY: {0} uncommitted file(s). On nobody's branch. Do not run a checkout over it." -f $mainWt.Dirty)
    $noise = $true
  }
  foreach ($w in $others) {
    if ($w.Gone) { Write-Host ("stale worktree: {0} (git worktree prune)" -f (Split-Path $w.Path -Leaf)); $noise = $true }
    elseif ($w.Dirty -gt 0) { Write-Host ("{0} [{1}]: {2} uncommitted" -f (Split-Path $w.Path -Leaf), $w.Branch, $w.Dirty); $noise = $true }
  }
  if ($unmerged.Count -gt 0) { Write-Host ("not merged into main: {0}" -f ($unmerged -join ', ')); $noise = $true }
  if (-not $noise) { Write-Host ("Worktrees: {0} open, all clean, all merged into main." -f $wts.Count) }
}
```

Expected: this monorepo has six worktrees including several stale ones, so expect several lines naming worktrees with uncommitted files and/or unmerged branches. Confirm it prints without throwing, names real worktrees, and reports at most one line per worktree. A completely silent result means the parser found no worktrees, which is a bug.

- [ ] **Step 5: Test the all-clean path**

The consumer repo is verified clean and fully merged, so it exercises the quiet branch. Run the same block with `git -C` pointed there by temporarily setting the location:

```powershell
Push-Location 'C:\Users\jorda\OneDrive\Documents\Claude\Projects\Boxaid Work'
$ErrorActionPreference = 'SilentlyContinue'
$wts = @(); $cur = $null
foreach ($l in (git worktree list --porcelain)) {
  if ($l -like 'worktree *') {
    if ($cur) { $wts += $cur }
    $cur = [pscustomobject]@{ Path = $l.Substring(9); Branch = '(detached)'; Dirty = 0; Gone = $false }
  } elseif ($l -like 'branch *') { $cur.Branch = $l -replace '^branch refs/heads/', '' }
}
if ($cur) { $wts += $cur }
$dirty = 0
foreach ($w in $wts) {
  if (-not (Test-Path -LiteralPath $w.Path)) { continue }
  $dirty += @(@(git -C $w.Path diff --name-only) + @(git -C $w.Path diff --cached --name-only) + @(git -C $w.Path ls-files --others --exclude-standard) | Sort-Object -Unique).Count
}
$unmerged = @(git branch --no-merged main --format='%(refname:short)')
Write-Host ("worktrees={0} totalDirty={1} unmerged={2}" -f $wts.Count, $dirty, $unmerged.Count)
Pop-Location
```

Expected: `worktrees=6 totalDirty=0 unmerged=0` (six because Task 1 Step 6's probe is removed by then; if a probe worktree still exists, remove it first).

- [ ] **Step 6: Commit**

```bash
M="C:/Users/jorda/OneDrive/Documents/GitHub/claude-skills_and_plugins-homebrew/.claude/worktrees/migrate-merge-safety-guard-1b9611"
git -C "$M" add boxaid-call-ops/commands/call-start.md
git -C "$M" commit -m "feat(boxaid-call-ops): report cross-worktree state in /call-start

Parallel worktrees give work nowhere to be loud. Nothing surfaced work
done but never committed, or committed but never merged, which cost a
session on 2026-08-06: four calls' worth of pages sat uncommitted in
the main tree, three on no branch at all.

Runs after the Tune-Up Snapshot is already on screen so it cannot
delay it, and counts changes with git diff rather than git status
because a file can show modified with an empty diff."
```

---

## Task 6: Mirror `/call-start` into the consumer repo

**Files:**
- Modify: `<CONSUMER>/.claude/commands/call-start.md`

**Interfaces:**
- Consumes: the finished canonical file from Task 5.
- Produces: nothing later tasks read.

**Background:** `boxaid-call-ops/README.md` documents the registration model. This package is never installed; the consumer repo runs off loose mirrors that are copied by hand. All four mirrors were verified in sync on 2026-08-06 and must stay that way.

- [ ] **Step 1: Copy the canonical file over the mirror**

```bash
M="C:/Users/jorda/OneDrive/Documents/GitHub/claude-skills_and_plugins-homebrew/.claude/worktrees/migrate-merge-safety-guard-1b9611"
R="C:/Users/jorda/OneDrive/Documents/Claude/Projects/Boxaid Work"
cp "$M/boxaid-call-ops/commands/call-start.md" "$R/.claude/commands/call-start.md"
```

- [ ] **Step 2: Verify all four mirrors are in sync**

```bash
M="C:/Users/jorda/OneDrive/Documents/GitHub/claude-skills_and_plugins-homebrew/.claude/worktrees/migrate-merge-safety-guard-1b9611/boxaid-call-ops"
R="C:/Users/jorda/OneDrive/Documents/Claude/Projects/Boxaid Work/.claude"
for p in commands/call-start.md commands/teardown.md agents/capture-call.md agents/service-report.md; do
  printf '%-28s ' "$(basename "$p")"
  if diff -q --strip-trailing-cr "$M/$p" "$R/$p" >/dev/null 2>&1; then echo "IN SYNC"; else echo "DRIFTED"; fi
done
```

Expected: all four read `IN SYNC`.

- [ ] **Step 3: Commit**

```bash
R="C:/Users/jorda/OneDrive/Documents/Claude/Projects/Boxaid Work"
git -C "$R" add .claude/commands/call-start.md
git -C "$R" commit -m "chore: mirror /call-start worktree report from the plugin package

Canonical source is boxaid-call-ops/commands/call-start.md in the
skills-and-plugins monorepo. This package is never installed, so the
mirror is copied by hand. All four mirrors verified in sync after."
```

---

## Task 7: Settle the host-bug question

**Files:** none. This task produces a finding, not a change.

**Interfaces:**
- Consumes: Tasks 1 and 2 (the LF guarantee must be in place, in a worktree, for this test to mean anything).
- Produces: the answer that decides whether `/teardown` keeps its inline-script fallback and whether anything is owed upstream to Anthropic.

**Why this exists:** the handoff concluded the Workflow tool has a host bug in by-name and by-path resolution, and called for an upstream report plus a permanent workaround. That conclusion rests on a byte scan of the main working copy, which was always clean. The worktree copies were not scanned. This task runs the test that was never run.

- [ ] **Step 1: Create a fresh worktree in the consumer repo**

```bash
R="C:/Users/jorda/OneDrive/Documents/Claude/Projects/Boxaid Work"
git -C "$R" worktree add "$R/.claude/worktrees/zz-workflow-probe" main
od -An -tx1 -v "$R/.claude/worktrees/zz-workflow-probe/.claude/workflows/teardown-close-out.js" | tr ' ' '\n' | grep -c '^0d'
```

Expected: `0`. If it prints anything else, Task 1 did not work and this test is meaningless.

- [ ] **Step 2: Attempt by-name resolution from inside that worktree**

Start a Claude Code session whose working directory is `<CONSUMER>/.claude/worktrees/zz-workflow-probe`, and invoke:

```
Workflow({ name: "teardown-close-out", args: { callDate: "2026-08-06", outcome: "no-charge", call: { symptom: "probe", rootCause: "probe", fixSteps: "probe", verification: "probe", tier: "30 min", paid: false } } })
```

Record which of these happens:

- **It launches.** The host-bug theory is dead. The CRLF fix was the whole cause. Proceed to Step 3.
- **It fails with the control-character error.** The CRLF fix was necessary but not sufficient. Something else contributes. Record the exact error and keep `/teardown`'s inline-script fallback.
- **It fails with a different error.** Record it verbatim. Do not assume it is the same bug.

This runs a real fan-out and spends tokens. `outcome: "no-charge"` keeps the call-log row's F and H blank so the probe cannot produce a misleading paid row.

- [ ] **Step 3: Remove the probe worktree**

```bash
R="C:/Users/jorda/OneDrive/Documents/Claude/Projects/Boxaid Work"
git -C "$R" worktree remove --force "$R/.claude/worktrees/zz-workflow-probe"
```

- [ ] **Step 4: Record the finding in the spec**

Append a short "Verification result" section to `<MONOREPO>/docs/superpowers/specs/2026-08-06-call-start-worktree-report-design.md` stating what happened in Step 2, dated. If by-name resolution worked, state plainly that no upstream report is owed and that `/teardown` needs no inline-script workaround. If it did not, state what the remaining error was so a future session starts from evidence rather than from the withdrawn claim.

- [ ] **Step 5: Commit the finding**

```bash
M="C:/Users/jorda/OneDrive/Documents/GitHub/claude-skills_and_plugins-homebrew/.claude/worktrees/migrate-merge-safety-guard-1b9611"
git -C "$M" add docs/superpowers/specs/2026-08-06-call-start-worktree-report-design.md
git -C "$M" commit -m "docs: record the by-name workflow resolution test result"
```

---

## Task 8: Push both repos

**Files:** none.

**Interfaces:**
- Consumes: every preceding task.

The operator gave explicit go-ahead on 2026-08-06 to push the consumer repo to `origin`.

- [ ] **Step 1: Review what is about to go out**

```bash
R="C:/Users/jorda/OneDrive/Documents/Claude/Projects/Boxaid Work"
git -C "$R" log origin/main..main --oneline
git -C "$R" status --short
```

Expected: the commits from Tasks 1, 3, 4, and 6, and a clean working tree.

- [ ] **Step 2: Push the consumer repo**

```bash
R="C:/Users/jorda/OneDrive/Documents/Claude/Projects/Boxaid Work"
git -C "$R" push origin main
```

- [ ] **Step 3: Confirm the push landed**

```bash
R="C:/Users/jorda/OneDrive/Documents/Claude/Projects/Boxaid Work"
git -C "$R" log origin/main..main --oneline
```

Expected: empty output, meaning nothing is left unpushed.

- [ ] **Step 4: Hand the monorepo branch off**

The monorepo branch (`claude/boxaid-teardown-plugin-handoff-b21d6f`) is finished with Task 7. Use the `superpowers:finishing-a-development-branch` skill to merge and clean up rather than pushing it directly here, since that skill handles the worktree teardown this branch is running inside.

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| Finding 1: CRLF proven, host-bug withdrawn | Tasks 1, 7 |
| Finding 2: repo healthy, mirrors in sync | Task 6 Step 2 re-verifies |
| Change 1: pin sidecars to LF | Task 1 |
| Change 2: refresh stale worktrees | Task 2 |
| Change 3: harden args guard | Tasks 3, 4 |
| Change 4: `/call-start` report | Tasks 5, 6 |
| Out of scope: `log.d/` | not planned, correctly absent |
| Verification steps 1 to 3 | Task 1 Steps 2/4/6, Task 2 Step 3, Task 7 |

No spec requirement is unplanned.

**Placeholder scan:** none. Every code step carries complete code, every command carries its expected output, and every failure mode names what to do.

**Type consistency:** the guard markers `// GUARD-START` and `// GUARD-END` introduced in Task 3 Step 3 are the same strings the test in Task 3 Step 1 searches for. The `runGuard` helper returns `{ input, call, callDate }`, matching the three `const` names the guard block declares. Task 4 inserts into `verifyPrompt`, which Task 3 does not touch, so the two edits cannot collide.
