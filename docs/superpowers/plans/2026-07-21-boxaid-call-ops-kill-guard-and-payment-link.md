# Boxaid Call-Ops: Kill-Guard False-Positive Fix + Payment-Link Cover Email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the confirmed kill-guard false-positive bug plus four related self-reference weaknesses found by audit, and add a `call.paid`-conditional payment-link line to the teardown cover email, in the `boxaid-call-ops` plugin source, then install the finished result into the `Boxaid Work` consumer repo.

**Architecture:** Two independent fixes land in the plugin source repo (`boxaid-call-ops/`) with TDD regression tests, get committed and merged directly to `main`, then get installed (file copy, no git operations) into `Boxaid Work`'s loose `.claude/` mirrors per that plugin's documented "edit source first, then copy to loose mirrors" model. `Boxaid Work` also gets a small `teardown-close-out.js` verify-prompt update and an ADR fact correction, both file edits only, not committed.

**Tech Stack:** PowerShell 5.1 (hook + test suite), Markdown agent spec, JavaScript (Claude Code workflow script, `Boxaid Work` side only), git.

## Global Constraints

- All git operations (commit, merge, push) happen ONLY in this repo (`claude-skills_and_plugins-homebrew`, `boxaid-call-ops/` plugin source), on the current worktree branch `claude/boxaid-call-ops-updates-76d5ff`, merged directly into `main` and pushed. No commits, staging, or pushes happen in `Boxaid Work` — it is a file-copy install target only.
- `boxaid-call-ops/hooks/kill-guard.ps1` is FAIL OPEN by contract: every regex change must preserve "any error, any unparsable input, exit 0 and do nothing." Do not add code paths that can throw outside the existing top-level `try/catch`.
- Every kill-guard.ps1 regex change must be verified against the FULL existing test suite (`boxaid-call-ops/hooks/tests/test-kill-guard.ps1`), not just the new case being added. Run it after every edit.
- No em dashes (U+2014) in any Markdown file touched (`service-report.md`, the ADR). Use periods, commas, parentheses, or colons.
- `call.paid` is the field to branch on for the payment-link line (reusing the existing documented call-facts field, not introducing a new one).
- Never mention or solicit a specific tip amount in the cover email, in either branch.
- The `power off` (`Stop-Computer`) fix must NOT require a command-line flag to detect the dangerous case: `Stop-Computer` with zero arguments is itself dangerous (shuts down the local machine), unlike `shutdown` (needs a flag to do anything) or `Disable-NetAdapter` (`-Name` is a mandatory parameter, so a bare invocation just prompts). Use a two-sided (lookbehind + lookahead) exclusion of nearby explanation vocabulary instead, and document in the ADR that this is a best-effort mitigation, not a complete close of the self-reference loop.
- Do not touch `Boxaid Work`'s `wiki/`, `index.md`, or `log.md` — flag any needed updates there in a final handoff note instead.

---

## Task 1: Fix the confirmed `shutdown` false-positive bug

**Files:**
- Modify: `boxaid-call-ops/hooks/kill-guard.ps1:84`
- Test: `boxaid-call-ops/hooks/tests/test-kill-guard.ps1`

**Interfaces:**
- Consumes: nothing from earlier tasks (first task).
- Produces: the corrected `shutdown without restart` Tier-2 rule at `kill-guard.ps1:84`. Task 5 (install) copies this file verbatim into `Boxaid Work`; Task 6 relies on the final test count this task establishes.

- [ ] **Step 1: Add the failing regression test**

Open `boxaid-call-ops/hooks/tests/test-kill-guard.ps1` and add this line immediately after line 128 (`Assert-Passed 'reinstating the service is not a kill' ...`), while still inside the "false positives" section (call mode is ON there, which is required since this is a Tier-2-only rule):

```powershell
Assert-Passed 'explaining a blocked shutdown mention is not a kill' (Stop-Payload 'KILL GUARD BLOCK fired because that reply mentioned shutdown. I will not suggest shutting down the machine.')
```

- [ ] **Step 2: Run the suite to verify the new case currently fails**

```bash
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "boxaid-call-ops/hooks/tests/test-kill-guard.ps1"
```

Expected: `FAIL  should have passed: explaining a blocked shutdown mention is not a kill` appears in the output, and the final line reads `30 passed, 1 failed` (the pre-existing 30 cases still pass; the new one fails, confirming the bug reproduces).

- [ ] **Step 3: Fix the regex**

In `boxaid-call-ops/hooks/kill-guard.ps1`, replace line 84:

```powershell
        @{ label = 'shutdown without restart';       pattern = '(?im)^.*\bshutdown(?:\.exe)?\b(?![^\r\n]*(?:/r|-r)\b).*$' }
```

with:

```powershell
        @{ label = 'shutdown without restart';       pattern = '(?im)^.*\bshutdown(?:\.exe)?\b\s*/(?:s|f|t\s*\d)(?![^\r\n]*(?:/r|-r)\b).*$' }
```

This requires the match to look like real invoked command syntax (`shutdown` immediately followed by `/s`, `/f`, or `/t <digits>`) instead of firing on the bare word `shutdown` appearing anywhere in a line.

- [ ] **Step 4: Run the suite to verify everything passes**

```bash
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "boxaid-call-ops/hooks/tests/test-kill-guard.ps1"
```

Expected: `31 passed, 0 failed`. This confirms the real `shutdown /s /t 0` and `shutdown /r /t 0` cases (lines 113, 116, 119-124 of the test file) are still handled correctly, alongside the new prose case now passing.

- [ ] **Step 5: Commit**

```bash
git add boxaid-call-ops/hooks/kill-guard.ps1 boxaid-call-ops/hooks/tests/test-kill-guard.ps1
git commit -m "fix(boxaid-call-ops): require command-shape syntax for the shutdown Tier-2 rule

The 'shutdown without restart' pattern fired on any line containing the
bare word shutdown, including Claude's own prose explaining a prior
block. Require an actual flag (/s, /f, /t) immediately after the word."
```

---

## Task 2: Harden the four audit-discovered Tier-2 patterns

**Files:**
- Modify: `boxaid-call-ops/hooks/kill-guard.ps1:77,81-83`
- Test: `boxaid-call-ops/hooks/tests/test-kill-guard.ps1`

**Interfaces:**
- Consumes: the file state left by Task 1 (line numbers below assume Task 1's edit already landed; the `tier2` array itself is otherwise unchanged from the version read during planning).
- Produces: the final, fully-hardened `kill-guard.ps1` and `test-kill-guard.ps1` that Task 5 installs into `Boxaid Work`, and the final test count (35) that Task 6's ADR edit cites.

- [ ] **Step 1: Add the four failing regression tests**

Add these four lines to `boxaid-call-ops/hooks/tests/test-kill-guard.ps1`, immediately after the line added in Task 1 (still inside the false-positives section, call mode ON):

```powershell
Assert-Passed 'explaining a blocked network adapter disable rule is not a kill' (Stop-Payload 'That reply was blocked by the network adapter disable rule because it named Disable-NetAdapter. I will not suggest disabling network adapters during the call.')
Assert-Passed 'explaining a blocked msconfig safe boot rule is not a kill' (Stop-Payload 'The msconfig safe boot rule blocked your last message. I will not suggest booting into Safe Mode.')
Assert-Passed 'explaining a blocked ScreenConnect Safe Mode button rule is not a kill' (Stop-Payload 'The ScreenConnect Safe Mode button rule fired because I mentioned it. I will not suggest pressing that button.')
Assert-Passed 'explaining a blocked power off rule is not a kill' (Stop-Payload 'That reply was blocked by the power off rule because I mentioned Stop-Computer while explaining what happened.')
```

- [ ] **Step 2: Run the suite to verify all four new cases currently fail**

```bash
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "boxaid-call-ops/hooks/tests/test-kill-guard.ps1"
```

Expected: `31 passed, 4 failed`, with each of the four new cases listed as `FAIL  should have passed: ...`.

- [ ] **Step 3: Tighten the four patterns**

In `boxaid-call-ops/hooks/kill-guard.ps1`, replace line 77:

```powershell
        @{ label = 'network adapter disable';        pattern = '(?is)Disable-NetAdapter' }
```

with:

```powershell
        @{ label = 'network adapter disable';        pattern = '(?is)Disable-NetAdapter\b[^\r\n]{0,40}-\w' }
```

Replace lines 81-83:

```powershell
        @{ label = 'msconfig safe boot';             pattern = '(?is)msconfig[\s\S]{0,200}safe\s?boot' }
        @{ label = 'ScreenConnect Safe Mode button'; pattern = "(?is)(?:$sc[\s\S]{0,160}safe\s?mode|safe\s?mode[\s\S]{0,160}button)" }
        @{ label = 'power off';                      pattern = '(?is)Stop-Computer' }
```

with:

```powershell
        @{ label = 'msconfig safe boot';             pattern = '(?is)\b(?:open|run|launch|go\s+to|navigate\s+to|start|boot\s+into)\b[\s\S]{0,40}\bmsconfig\b[\s\S]{0,200}safe\s?boot' }
        @{ label = 'ScreenConnect Safe Mode button'; pattern = "(?is)\b(?:press|click|tap|select|hit)\b[\s\S]{0,160}(?:safe\s?mode[\s\S]{0,160}button|button[\s\S]{0,160}safe\s?mode)" }
        @{ label = 'power off';                      pattern = '(?is)(?<!\b(?:rule|guard|pattern|blocked|block|fired|triggered|flagged)\b[\s\S]{0,40})Stop-Computer\b(?![\s\S]{0,40}\b(?:rule|guard|pattern|blocked|block|fired|triggered|flagged)\b)' }
```

Notes on the approach, for the engineer picking this up:
- `network adapter disable` and `msconfig safe boot` / `ScreenConnect Safe Mode button` now require a *positive* signal (a flag token, or an action verb) that a real invocation has and a rule-name mention does not. This is the same principle as the `shutdown` fix and does not weaken detection, because `Disable-NetAdapter -Name` genuinely needs `-Name` to do anything, and describing the msconfig/Safe-Mode-button GUI steps as an instruction genuinely needs an action verb.
- `power off` is different on purpose: `Stop-Computer` with no arguments is a real, complete attack (it shuts down the local machine), so requiring a flag would create a detection gap. Instead this pattern excludes matches only when explanation vocabulary (`rule`, `guard`, `blocked`, `fired`, etc.) appears within 40 characters before or after the cmdlet name. This is a best-effort mitigation of the self-reference loop, not a full close: a differently-worded explanation could still slip past the exclusion list. Document this residual risk in Task 6's ADR update.

- [ ] **Step 4: Run the suite to verify everything passes**

```bash
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "boxaid-call-ops/hooks/tests/test-kill-guard.ps1"
```

Expected: `35 passed, 0 failed`. This confirms the real invocations (`Disable-NetAdapter -Name "Wi-Fi" -Confirm:$false` at test line 106, `Stop-Computer -Force` at test line 112, the msconfig and Safe-Mode-button instruction prose at test lines 110-111) are all still blocked, alongside the four new false-positive cases now passing.

- [ ] **Step 5: Commit**

```bash
git add boxaid-call-ops/hooks/kill-guard.ps1 boxaid-call-ops/hooks/tests/test-kill-guard.ps1
git commit -m "fix(boxaid-call-ops): harden four more Tier-2 patterns against self-reference

Audit triggered by the shutdown false-positive fix: network adapter
disable and power off matched bare cmdlet names with no invocation
context, and msconfig safe boot / ScreenConnect Safe Mode button's own
rule labels satisfied their own patterns. Require a flag or action verb
for the first three; exclude nearby explanation vocabulary for power off
since Stop-Computer is dangerous with zero arguments and can't require a
flag without opening a detection gap."
```

---

## Task 3: Add the `call.paid`-conditional payment-link line to the cover email job

**Files:**
- Modify: `boxaid-call-ops/agents/service-report.md:41-49`

**Interfaces:**
- Consumes: nothing from Tasks 1-2 (independent change, same repo).
- Produces: the final `service-report.md` "## Job: cover email" section that Task 5 installs into `Boxaid Work`, and that Task 6's `teardown-close-out.js` verify-prompt update checks against.

- [ ] **Step 1: Replace the cover email job section**

In `boxaid-call-ops/agents/service-report.md`, replace lines 41-49:

```markdown
## Job: cover email

Draft the short note the client opens the report with. The operator pastes it into his mail client and attaches the report PDF.

- Greeting: MUST use a placeholder like `Hi [first name],` so no client name is stored.
- Subject: short and plain, for example `Your Boxaid security check-up (recap attached)`.
- Body: a few sentences only: a one or two line plain recap of what was handled, a pointer to the attached PDF, the free-follow-up line if a scan is still running, the change-passwords-from-a-clean-device note if the machine was tampered or compromised, and a warm closing as the operator. Do not append a formal signature or contact block: the operator's mail client adds that, so a full contact block here would double it.

Return: `kind: "email-body"`, `subject` (the subject line), `content` (the email body text), `notes`.
```

with:

```markdown
## Job: cover email

Draft the short note the client opens the report with. The operator pastes it into his mail client and attaches the report PDF.

- Greeting: MUST use a placeholder like `Hi [first name],` so no client name is stored.
- Subject: short and plain, for example `Your Boxaid security check-up (recap attached)`.
- Body: a few sentences only: a one or two line plain recap of what was handled, a pointer to the attached PDF, the free-follow-up line if a scan is still running, the change-passwords-from-a-clean-device note if the machine was tampered or compromised, and a warm closing as the operator. Do not append a formal signature or contact block: the operator's mail client adds that, so a full contact block here would double it.
- **Payment line, conditional on `call.paid`:**
  - `call.paid` is `true` (client paid live during the session): omit the payment line entirely. Do not mention payment at all.
  - `call.paid` is `false` or absent: include one warm, specific line offering the `boxaid.com/shop` payment link and asking the client to complete payment there, plus a request to reply once it's handled so the operator knows to close out the call-log row. Never mention or ask for a tip amount in this line, or anywhere else in the email: tips are voluntary, and a client who leaves one tends to volunteer the amount unprompted in their reply. Explicitly soliciting it reads as tacky.
  - Length calibration for this line: match the same middle ground as the rest of the body. Not a bare stub ("Please pay at the link.") and not padded past what one warm, specific sentence needs. One or two sentences is enough.

Return: `kind: "email-body"`, `subject` (the subject line), `content` (the email body text), `notes`.
```

- [ ] **Step 2: Verify the edit**

```bash
grep -n "Payment line, conditional" boxaid-call-ops/agents/service-report.md
```

Expected: one match, at the new line inside the cover email section.

- [ ] **Step 3: Commit**

```bash
git add boxaid-call-ops/agents/service-report.md
git commit -m "feat(boxaid-call-ops): add payment-link mode to the cover email job

Cover email now branches on call.paid: omits the payment line entirely
when the client paid live, otherwise offers boxaid.com/shop and asks for
a reply once paid so the operator knows to close the call-log row. Never
solicits a tip amount in either branch."
```

---

## Task 4: Merge to main and push

**Files:** none (git operations only).

**Interfaces:**
- Consumes: the three commits from Tasks 1-3, all on branch `claude/boxaid-call-ops-updates-76d5ff`.
- Produces: `main` updated and pushed to `origin`, which Task 5 reads from when installing into `Boxaid Work`.

This repo is checked out as a git worktree: this worktree (where Tasks 1-3 ran) has `claude/boxaid-call-ops-updates-76d5ff` checked out, but `main` is checked out in the primary repo directory, not here. Git will refuse `git checkout main` run from inside this worktree ("already checked out"). Follow the `superpowers:finishing-a-development-branch` skill's Option 1 (merge locally) procedure, run from the primary repo root, not this worktree. The user already confirmed direct-to-main merge as the target workflow, so no need to re-present the option menu, just execute Option 1's mechanics. This worktree is harness-managed (not created by `superpowers:using-git-worktrees` in this session), so skip the skill's worktree-removal cleanup step entirely: do not run `git worktree remove` on it.

- [ ] **Step 1: Confirm the branch is clean and has exactly the three expected commits, and re-verify tests from this worktree**

```bash
git status
git log --oneline main..claude/boxaid-call-ops-updates-76d5ff
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "boxaid-call-ops/hooks/tests/test-kill-guard.ps1"
```

Expected: `git status` shows a clean working tree; the log shows exactly the three commits from Tasks 1-3 (shutdown fix, four-pattern hardening, payment-link mode), oldest first; the test run reports `35 passed, 0 failed`.

- [ ] **Step 2: Merge into main from the primary repo root**

```bash
MAIN_ROOT=$(git -C "$(git rev-parse --git-common-dir)/.." rev-parse --show-toplevel)
cd "$MAIN_ROOT"
git checkout main
git pull
git merge claude/boxaid-call-ops-updates-76d5ff
```

Expected: `git pull` reports already up to date (nothing else has landed on `origin/main` since this branch was created); the merge is a fast-forward (this worktree's branch started at the same commit as `main` and only moved forward), so no merge commit or conflict.

- [ ] **Step 3: Re-verify tests on the merged result**

Still from `$MAIN_ROOT`:

```bash
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "boxaid-call-ops/hooks/tests/test-kill-guard.ps1"
```

Expected: `35 passed, 0 failed`, confirming the merge landed the same file contents verified in Task 2.

- [ ] **Step 4: Push**

```bash
git push origin main
```

Expected: `main` on `origin` (`themrbeasley/personal-skills-and-plugins`) now includes the three new commits.

- [ ] **Step 5: Verify, then return to the worktree directory**

```bash
git log --oneline -5
git status
cd "$OLDPWD"
```

Expected: the three commits appear at the top of `main`'s log; `git status` shows `Your branch is up to date with 'origin/main'.`; the final `cd` returns to this worktree so Tasks 5-7 run from the expected working directory.

Do NOT run `git worktree remove` or delete the `claude/boxaid-call-ops-updates-76d5ff` branch: this worktree is harness-managed, not something this session created, so its lifecycle is the harness's to own.

---

## Task 5: Install the updated plugin files into Boxaid Work

**Files:**
- Modify (copy, not git-tracked): `C:\Users\jorda\OneDrive\Documents\Claude\Projects\Boxaid Work\.claude\hooks\kill-guard.ps1`
- Modify (copy, not git-tracked): `C:\Users\jorda\OneDrive\Documents\Claude\Projects\Boxaid Work\.claude\hooks\tests\test-kill-guard.ps1`
- Modify (copy, not git-tracked): `C:\Users\jorda\OneDrive\Documents\Claude\Projects\Boxaid Work\.claude\agents\service-report.md`

**Interfaces:**
- Consumes: the final file contents produced by Tasks 1-3 (read from `main` after Task 4's push, or equivalently from the local working tree since they're identical post-merge).
- Produces: `Boxaid Work`'s loose mirrors brought current with the plugin source, per the model documented in `boxaid-call-ops/README.md`'s "Registration (D2: loose mirrors, no install)" section. Task 6 depends on these copies being in place before it edits `teardown-close-out.js` and runs the installed test suite.

- [ ] **Step 1: Copy the three files**

```bash
cp "boxaid-call-ops/hooks/kill-guard.ps1" "/c/Users/jorda/OneDrive/Documents/Claude/Projects/Boxaid Work/.claude/hooks/kill-guard.ps1"
cp "boxaid-call-ops/hooks/tests/test-kill-guard.ps1" "/c/Users/jorda/OneDrive/Documents/Claude/Projects/Boxaid Work/.claude/hooks/tests/test-kill-guard.ps1"
cp "boxaid-call-ops/agents/service-report.md" "/c/Users/jorda/OneDrive/Documents/Claude/Projects/Boxaid Work/.claude/agents/service-report.md"
```

- [ ] **Step 2: Verify the copies are byte-identical to the plugin source**

```bash
diff "boxaid-call-ops/hooks/kill-guard.ps1" "/c/Users/jorda/OneDrive/Documents/Claude/Projects/Boxaid Work/.claude/hooks/kill-guard.ps1"
diff "boxaid-call-ops/hooks/tests/test-kill-guard.ps1" "/c/Users/jorda/OneDrive/Documents/Claude/Projects/Boxaid Work/.claude/hooks/tests/test-kill-guard.ps1"
diff "boxaid-call-ops/agents/service-report.md" "/c/Users/jorda/OneDrive/Documents/Claude/Projects/Boxaid Work/.claude/agents/service-report.md"
```

Expected: no output from any of the three `diff` calls (files identical).

Note: do not `git add` or `git commit` anything in `Boxaid Work` — per this plan's scope, git operations there are out of scope entirely.

---

## Task 6: Update Boxaid Work's verify-prompt and ADR fact, run the installed test suite

**Files:**
- Modify (not git-tracked): `C:\Users\jorda\OneDrive\Documents\Claude\Projects\Boxaid Work\.claude\workflows\teardown-close-out.js:203`
- Modify (not git-tracked): `C:\Users\jorda\OneDrive\Documents\Claude\Projects\Boxaid Work\docs\adr\0002-kill-guard-on-output.md:83`

**Interfaces:**
- Consumes: the installed `service-report.md` from Task 5 (the verify-prompt change below checks the artifact this agent now produces); the final test count of 35 established in Task 2.
- Produces: nothing consumed by a later task (last engineering task; Task 7 is a documentation handoff only).

- [ ] **Step 1: Update the email-body convention check in teardown-close-out.js**

In `Boxaid Work/.claude/workflows/teardown-close-out.js`, replace line 203:

```javascript
    '   - email-body: greeting uses a [first name] placeholder (NO literal client name), subject line present, body is a few plain sentences in the operator voice, no client identity anywhere, operator contact only.',
```

with:

```javascript
    '   - email-body: greeting uses a [first name] placeholder (NO literal client name), subject line present, body is a few plain sentences in the operator voice, no client identity anywhere, operator contact only. Payment line present only when call.paid is false or absent (and in that case asks the client to reply once paid), and absent entirely when call.paid is true. No tip amount is mentioned or solicited anywhere in the email.',
```

- [ ] **Step 2: Update the stale test count in ADR 0002**

In `Boxaid Work/docs/adr/0002-kill-guard-on-output.md`, replace the sentence on line 83:

```markdown
  including the nested `Set-Service -Name "ScreenConnect Client" -StartupType Disabled` case
  where the ScreenConnect name sits inside the `Set-Service` verb span. The installed guard
  passes all 30 test cases in its suite. But coverage is a list of patterns, not a proof, so
```

with:

```markdown
  including the nested `Set-Service -Name "ScreenConnect Client" -StartupType Disabled` case
  where the ScreenConnect name sits inside the `Set-Service` verb span. The installed guard
  passes all 35 test cases in its suite (30 original plus 5 added 2026-07-21 for a
  self-reference false-positive class: several Tier-2 rules could re-fire on Claude's own
  prose explaining a prior block, since the block reason restates the rule's label or
  keyword and Claude's forced retraction naturally echoes it back. Four of five rules were
  tightened to require real invocation syntax; `power off` (`Stop-Computer`) instead
  excludes nearby explanation vocabulary, since it is genuinely dangerous with zero
  arguments and could not safely require a flag, so that one mitigation is best-effort, not
  a complete close of the loop). But coverage is a list of patterns, not a proof, so
```

- [ ] **Step 3: Run the installed test suite in Boxaid Work**

```bash
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "/c/Users/jorda/OneDrive/Documents/Claude/Projects/Boxaid Work/.claude/hooks/tests/test-kill-guard.ps1"
```

Expected: `35 passed, 0 failed`, confirming the installed copy behaves identically to the plugin source verified in Task 2.

- [ ] **Step 4: Verify the JS edit is syntactically valid**

```bash
node --check "/c/Users/jorda/OneDrive/Documents/Claude/Projects/Boxaid Work/.claude/workflows/teardown-close-out.js"
```

Expected: no output (exit code 0), confirming the edited file still parses as valid JavaScript.

Note: do not `git add` or `git commit` anything in `Boxaid Work`.

---

## Task 7: Write the handoff note for Boxaid Work's KB follow-ups

**Files:**
- Create: `C:\Users\jorda\AppData\Local\Temp\claude\C--Users-jorda-OneDrive-Documents-GitHub-claude-skills-and-plugins-homebrew--claude-worktrees-boxaid-call-ops-updates-76d5ff\c1ab3144-20db-4008-973f-745487147a51\scratchpad\boxaid-work-kb-followup-handoff.md`

**Interfaces:**
- Consumes: the finished state of Tasks 1-6 (this task only describes it).
- Produces: a standalone handoff document for a future Claude Code session running inside `Boxaid Work`, per the user's decision to leave `wiki/`, `index.md`, and `log.md` untouched here and defer those updates to a session in that repo.

- [ ] **Step 1: Write the handoff note**

Create the file with this content:

```markdown
# Handoff: Boxaid Work KB follow-ups after the kill-guard fix and payment-link mode

**Scope note:** this handoff covers exactly the KB documentation follow-ups left
after a 2026-07-21 session fixed the kill-guard false-positive bug and added
payment-link mode to the cover email, both in the `boxaid-call-ops` plugin
source and installed here via loose-mirror copy. The code and agent-spec
changes are DONE and already installed in this repo's `.claude/`. This handoff
is KB documentation only.

Read `CLAUDE.md` first if this is a fresh session's first time in this repo.

## What's already done (no action needed)

- `.claude/hooks/kill-guard.ps1` and `.claude/hooks/tests/test-kill-guard.ps1`:
  installed from `boxaid-call-ops`, five Tier-2 patterns hardened against a
  self-reference false-positive class, 35/35 tests passing.
- `.claude/agents/service-report.md`: installed from `boxaid-call-ops`, cover
  email now branches on `call.paid` for the payment-link line.
- `.claude/workflows/teardown-close-out.js`: verify-prompt convention check
  updated for the new payment-link branch.
- `docs/adr/0002-kill-guard-on-output.md`: test count and self-reference
  finding recorded.

None of the above is committed yet in this repo (per the prior session's
scope: only the `boxaid-call-ops` plugin source repo was committed and
pushed). Committing these installed files here, alongside whatever else is
already staged in this repo, is part of this repo's own normal workflow, not
something this handoff prescribes.

## What's left: KB documentation

Per this repo's `CLAUDE.md` "Ingest" workflow, a durable change to the KB's
own tooling calls for an `index.md` update and a `log.md` entry. Neither was
touched by the prior session (out of scope there). Suggested:

1. **`wiki/reference/call-logging.md` and/or `wiki/sops/credit-card-processing.md`**:
   consider a cross-reference note about the new payment-link flow, since it
   changes when a call-log row's Amount Charged (F) and Pay (H) columns
   actually get filled in relative to when the cover email goes out (a
   `call.paid: false` call now prompts the client to pay after the fact, via
   the email, rather than the row being finalized at teardown time). Not
   confirmed necessary, just worth a look per this repo's own conventions.
2. **`index.md`**: no new wiki page was created by the prior session (the
   change was to an agent spec and a hook, not a KB article), so likely no
   entry needed there unless the cross-reference above becomes a new page.
3. **`log.md`**: append an entry noting the kill-guard hardening and the
   payment-link mode addition, per the `## [YYYY-MM-DD] <op> | <subject>`
   convention, since both are durable changes to how this repo's own tooling
   behaves.

## Suggested skill

Follow this repo's own `CLAUDE.md` "Ingest" workflow steps for `index.md` and
`log.md`. No specialized skill is needed beyond normal Read/Edit for the
wiki cross-reference check.
```

- [ ] **Step 2: Verify the file was written**

```bash
ls -la "/c/Users/jorda/AppData/Local/Temp/claude/C--Users-jorda-OneDrive-Documents-GitHub-claude-skills-and-plugins-homebrew--claude-worktrees-boxaid-call-ops-updates-76d5ff/c1ab3144-20db-4008-973f-745487147a51/scratchpad/boxaid-work-kb-followup-handoff.md"
```

Expected: the file exists with a non-zero size.

- [ ] **Step 3: Send the handoff file to the user**

Use the `SendUserFile` tool to deliver `boxaid-work-kb-followup-handoff.md` to the user so they have it ready for the next `Boxaid Work` session, with a caption noting it covers only the KB documentation follow-ups, since the code and agent-spec changes are already installed.
