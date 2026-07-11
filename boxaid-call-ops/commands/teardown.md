---
description: Close out a finished, already-secured Boxaid support call. Fan out the KB page, call-log row, service report, and cover email, verify each, then write the safe artifacts and hand back the manual ones.
---

# /teardown

You are closing out a support call that has FULLY ENDED and whose machine is already secured. Firing this command IS the operator's attestation that the human Session Teardown checklist is done at the machine. Do not walk or re-check that checklist, and do not push back. Your job is to assemble the call facts, run the close-out workflow, and split the results into what you write and what you hand back.

## Step 1: assemble the call shape (no PII)

Gather the call facts from THIS session only: the scratchpad, this conversation, and any handoff document written during context-clearing on a long call. Do not read the machine and do not invent facts.

Assemble a `call` object with the technical facts: `symptom`, `rootCause`, `fixSteps`, `verification`, `tier` (the tier NAME, for example "30 min"), `amountCharged`, `tip`, `paid`, and the security-review items checked and found. NO client PII enters `args`: no client name, phone, address, email, or any identifying detail. Refer to the client generically. Privacy is fireable.

Decide three routing fields:

- `outcome`: one of `fixed`, `incomplete`, `no-charge`, `unfixable`.
- `pageType`: `fix` (default) or `playbook` (a repeatable multi-step job).
- `hasFileableLesson`: true if there is a concrete technical lesson worth a KB page even when the outcome is not `fixed`. A KB page is drafted when the outcome is fileable. The service report and cover email are drafted on every call regardless.

## Step 2: read the session date

Read the session date from context and pass it as `callDate` in YYYY-MM-DD form. Never guess it or carry an old one forward. The workflow cannot read the clock, so this field is required.

## Step 3: run the close-out workflow

Invoke the workflow by name:

    Workflow({ name: "teardown-close-out", args: { callDate, outcome, pageType, hasFileableLesson, call } })

If the host cannot resolve the workflow by name, fall back to its path with `scriptPath: ".claude/workflows/teardown-close-out.js"`. The workflow fans out the jobs over a for-loop (the call-log row, the service report, and the cover email always; the KB page when fileable), verifies each adversarially, and returns a bundle. It writes nothing.

## Step 4: apply the write / return split

For each returned artifact:

WRITE for the operator (reversible and hook-guarded, so it is safe for you to write):

- `kb-page` (unless `skip` is true): write `content` to its `filename` under `wiki/`, then hand back a click-to-open path. If `skip` is true, tell the operator which existing page to update instead and write nothing.
- `client-report`: write `reportHtml` to `reportPath` under the gitignored `reports/` folder using PowerShell (the HTML is large), then hand back a click-to-open path.

RETURN as copy blocks (irreversible, external, or PII, so the operator commits them by hand):

- `call-log-row`: one copy-button code block per cell in Tab-entry order, D issue, E fix, F amount, G notes, H pay. Label columns B (name), C (phone), and I (yearly) as "you type this," not blocks. On an unpaid or incomplete call (F and H blank), render an explicit "leave blank" line for F and H. Never `$0`, never an empty copy block.
- `email-body`: two copy blocks, a subject block and a body block. The body opens with a `Hi [first name],` placeholder the operator personalizes (never a literal client name, which is what the verifier checks for) and ends without a formal signature or contact block (the operator's mail signature supplies that). Never send the email yourself.

## Step 5: surface any PII flag

If any verifier returned `piiLeak: true`, tell the operator plainly and prominently. PII reaching the pipeline means something leaked into context upstream, and he needs to know. Do not write or hand back an artifact that failed verification until it is fixed and re-verified.

## Hard rules

- No client PII anywhere in the repo, in `args`, or in memory. Refer to clients generically. Privacy is fireable.
- The call log is the external Google Sheet only, append-only, human-committed. Existing rows are never edited. Columns B, C, and I stay the operator's. F and H are blank (never $0) on unpaid or incomplete calls.
- No outbound email without the operator's explicit go-ahead. Return the email as text; never send it.
- No em dashes anywhere (a PostToolUse hook rejects the write otherwise).
- Follow the project's scratchpad convention for any intermediate work.
