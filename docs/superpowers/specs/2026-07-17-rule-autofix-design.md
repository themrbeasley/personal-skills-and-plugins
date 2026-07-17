# Rule autofix design

**Date:** 2026-07-17
**Status:** approved in principle, pending DM review of this document
**Target version:** professor-orb 1.4.0

## Goal

When a KB write trips a rule the DM has marked auto-fixable, the violation gets fixed by a subagent without the DM prompting for it, and the DM sees one line saying what changed.

Today the DM sees a flag and manually says "fix that". This removes the DM from that loop while keeping a model (not a regex) doing the fixing, because the fixes in question need judgment.

## Why a model, not a substitution

The motivating rule is `contentNoEmDashes`. Rolara's CLAUDE.md states four different remedies ("Use commas, colons, parentheses, or restructure the sentence"), which is itself the tell that no single substitution is correct. Real examples from the KB, all needing different answers:

The three rows below quote literal em dashes on purpose: they are specimens of the defect, not prose. They are the only ones in this document.

| Text | A blind comma gives |
|---|---|
| `private guard companies—mercenary outfits and veteran-led bands` | correct |
| `# Archfey — Characters Index` | wrong, wants a colon |
| `a beleaguered mortal—a sorcerer, with pride and ambition` | comma pile-up |

A deterministic in-hook rewrite was considered and rejected on this evidence. The fixer must have judgment.

## Measured scope (2026-07-17, Rolara)

Counts below come from a script that mirrors the hook's own logic: only files the hook actually validates (frontmatter present with a `type` field), body only, table delimiter rows excluded.

- 1634 articles validated of 1637 markdown files under `kbRoot`
- 445 (27.2%) trip `contentNoEmDashes`: 439 via a real em dash (U+2014), 11 via a double hyphen
- 0 em dashes sit inside fenced code blocks, so no Foundry HTML or macro content is at risk today
- 6 articles trip `contentSeeAlsoFooterProhibited`; a further 79 carry an inline "See also:" the rule's line-start anchor does not match

439 of the 445 predate the rule. This design cleans them opportunistically: touching an article fixes that article.

## What a PostToolUse hook can and cannot do

Established from the official hooks reference, not assumed:

- **A hook cannot dispatch a subagent.** The docs do not address hook capabilities either way; it follows from what a hook is (a subprocess handed JSON on stdin, answering with an exit code and output). It has no channel to the Agent tool. The hook can only leave a message that the main agent acts on.
- **Exit 2 shows stderr to Claude.** Quoted: "`PostToolUse` | No | Shows stderr to Claude; the tool already ran". This is the mechanism `block` rules already rely on.
- **Exit 0 stdout reaches nobody.** Quoted: "For most events, stdout is written to the debug log but not shown in the transcript. The exceptions are `UserPromptSubmit`, `UserPromptExpansion`, and `SessionStart`, where stdout is added as context that Claude can see and act on." PostToolUse is not an exception.
- **`hookSpecificOutput.additionalContext` (on exit 0) is the supported way to give PostToolUse a voice.** Quoted placement: "PostToolUse, PostToolUseFailure, and PostToolBatch: next to the tool result". JSON output is only processed on exit 0.
- **`systemMessage` is user-facing only**, not model-facing. Not useful here.
- **The hook can tell it is running inside a subagent.** Quoted: "When running with `--agent` or inside a subagent, two additional fields are included: `agent_id` ... `agent_type`".
- **`timeout` in hooks.json is in seconds.** Quoted: "Seconds before canceling. Defaults: 600 for `command`, `http`, and `mcp_tool`".

### Consequence: every `warn` rule is currently dead

`validate-write.mjs` ends with:

```js
if (warnings.length > 0) {
  process.stdout.write(warnings.join("\n") + "\n");
}
process.exit(0);
```

Warnings therefore reach the debug log and nothing else. Seven of Rolara's twelve rules are `warn` (`frontmatterCategoryRequired`, `frontmatterFieldOrder`, `frontmatterTypeEnum`, `filenameSuffixByType`, `structuralSingleOwnership`, `contentWikilinkPolicy`, `contentTagVocabulary`) and none of them has ever been seen by Claude or by the DM.

`conventions-schema.md` currently documents the opposite, and is wrong:

> | `warn` | Exits 0, prints the violation to stdout. The write proceeds. | Claude sees the warning and may act on it, but nothing is gated. |

This is a pre-existing defect, independent of autofix, but it is load-bearing here: the DM chose "any rule can opt in", and a `warn` rule that opted in would silently never fire. Fixing warn visibility is therefore in scope.

## Architecture

Five pieces. Nothing about em dashes or see-also exists in plugin code; the plugin stays system-agnostic.

### 1. `conventions.json`: a per-rule `autofix` field

A rule opts in by carrying an `autofix` string, holding plain-English guidance for the fixer:

```json
"contentNoEmDashes": {
  "category": "content",
  "check": "prohibitedPattern",
  "enforcement": "block",
  "description": "No em dashes (U+2014) or double-hyphen substitutes anywhere in output, per CLAUDE.md's Global Rules.",
  "autofix": "Replace each em dash or double hyphen with the punctuation that fits the sentence: a comma, a colon, or parentheses. Change only the punctuation and the spacing around it. Do not reword, reorder, or restructure any sentence. Never substitute a double hyphen.",
  "params": { "pattern": "\\u2014|--", "appliesTo": "body", "excludeTableDelimiters": true }
}
```

A string, not an object: the plugin ships exactly one fixer agent, so there is nothing to select. If a later need appears, the field can widen to an object without breaking the string form.

`autofix` is optional and absent by default. A rule without it behaves exactly as today.

### 2. The hook emits a dispatch instruction

When a rule fails, has a non-empty `autofix` string, and the hook is not already running inside the fixer, the hook appends a request naming the file, the rule, and the guidance verbatim. Format:

```
[contentNoEmDashes] Prohibited pattern (\u2014|--) found in body.
AUTOFIX AVAILABLE. Dispatch the professor-orb rule-fixer agent now, once per file, and do not fix this yourself.
  file: rolara-kb/characters/Kivin.md
  rule: contentNoEmDashes
  guidance: Replace each em dash or double hyphen with the punctuation that fits the sentence: ...
The DM pre-approved this fix class by setting autofix on the rule, so do not ask for approval.
```

Delivery depends on whether anything blocked, because the two channels are mutually exclusive (JSON output is only processed on exit 0):

- **Any block violation present:** exit 2, with block violations, warnings, and autofix requests all on stderr. This also fixes the existing behavior where a block silently discarded the warnings.
- **Warnings only:** exit 0, with a JSON body on stdout:
  ```json
  {"hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": "<warnings and any autofix requests>"}}
  ```
- **Nothing to say:** exit 0, no output. Unchanged.

### 3. A new `rule-fixer` agent

`professor-orb/agents/rule-fixer.md`. Modeled on the existing fixer prompt in `validation-sweep.mjs` (`fixPrompt`), which already encodes "apply exactly this one fix, touch nothing else".

- `model: haiku`
- `tools: Read, Edit`
- `color:` any valid enum value (`green`)
- Keep the frontmatter `description` under ~1500 characters, per the repo CLAUDE.md's Cowork constraint.

Its contract:
- Fix only the named rule's violations in the named file, using the supplied guidance.
- Fix every instance in the file, not only the one that triggered the write. Whole-file cleaning as you touch it is the intended behavior.
- Change nothing else: no other rule, no wording, no formatting, no frontmatter.
- Never touch content inside fenced code blocks.
- If an instance cannot be fixed within the guidance, leave it and say so rather than guessing.
- Return one line, and only that line: `Kivin.md: 3 em dashes to commas, 1 to a colon`.

### 4. Recursion guard

The fixer's own Edit re-triggers the hook. The hook reads `agent_type` from its input JSON:

- `agent_type === "rule-fixer"`: validate and report normally, but emit no autofix request. The fixer sees whether its own fix worked and can self-correct inside its own turn.
- otherwise: emit autofix requests as above.

This bounds the system at one dispatch per hook firing, with no loop possible. The re-fire is a feature, not a cost: it is the same self-checking property the validation sweep already relies on ("those writes pass through the consumer project's PostToolUse validator hook like any other edit").

### 5. Rolara config switches two rules on

`contentNoEmDashes` gets the guidance quoted in section 1. `contentSeeAlsoFooterProhibited` gets:

```
Remove the manual See also reference. If the line contains only the See also footer, delete the line and any blank line left behind. If the See also is part of a longer line (for example an entry count), remove only the See also segment and its separator, keeping the rest of the line and its formatting intact.
```

Hand-edited directly. `professor-orb:setup` is never run: it regenerates `conventions.json` wholesale and would discard hand-tuned rules.

## Data flow

1. DM's session edits `rolara-kb/characters/Kivin.md`, fixing an unrelated typo.
2. Write lands. PostToolUse fires. `contentNoEmDashes` fails on 4 pre-existing em dashes.
3. Rule has `autofix`; `agent_type` is absent. Hook exits 2, stderr carries the violation plus the dispatch request.
4. Main agent reads stderr, dispatches `rule-fixer` with file, rule, guidance.
5. Fixer reads the file, replaces 4 em dashes with fitting punctuation, saves via Edit.
6. That Edit fires PostToolUse again. `agent_type` is `rule-fixer`, so no new request is emitted. File is clean, so exit 0, silent.
7. Fixer returns `Kivin.md: 3 em dashes to commas, 1 to a colon`.
8. Main agent relays that one line to the DM and resumes the original task.

## Error handling

| Situation | Behavior |
|---|---|
| `autofix` present but not a non-empty string | Ignored; rule behaves as today. Malformed config never changes enforcement. |
| Fixer cannot fix an instance within its guidance | Leaves it, reports why. The rule still fails on the next write, visibly. No silent corruption. |
| Fixer's rewrite still violates the rule | Hook re-fires inside the fixer, fixer sees it, self-corrects within its own turn. No dispatch loop. |
| Main agent does not dispatch | Degrades exactly to today's behavior: a visible flag the DM can act on. No worse than the status quo. |
| Main agent's view of the file is stale after the fixer edits | Claude Code tracks file state and forces a re-read before a further Edit. Worth watching in verification. |
| Block and warn violations on the same write | Both now reach Claude on stderr. Previously the warnings were dropped. |

## Testing

Extend the existing end-to-end harness pattern (scratch KB fixture, real PostToolUse payloads piped into the hook, assert exit code and output). Do not rely on unit tests: the F1 and F2 defects were both cases where stated intent and actual behavior diverged, which unit tests missed.

Cases the hook side must cover:

1. Rule with `autofix` fails, no `agent_type` in payload: exit 2, stderr contains the rule id, the file path, and the guidance verbatim.
2. Same payload with `agent_type: "rule-fixer"`: exit 2, stderr contains the violation but NOT the dispatch request.
3. Warn-level rule with `autofix` fails: exit 0, stdout parses as JSON, `hookSpecificOutput.additionalContext` contains the request.
4. Warn-level rule with no `autofix`: exit 0, stdout parses as JSON carrying the warning. (Regression guard for the dead-warn defect.)
5. Block and warn on the same file: exit 2, stderr carries both.
6. Block rule with no `autofix` fails, no warnings present: exit 2, stderr identical to 1.3.0 output. (No behavior change for opted-out rules. With warnings present the output differs by design, per case 5.)
7. Malformed `autofix` (number, empty string, object): treated as absent, no crash.
8. Clean file: exit 0, no output at all.

The agent side cannot be asserted deterministically. Verify it by driving one real dispatch against a scratch fixture article containing all three em dash shapes from the evidence table, and read the resulting prose.

## Also in scope

**Hook timeout units.** `hooks/hooks.json` sets `"timeout": 10000` on validate-write and `"timeout": 5000` on pipeline-next. The field is seconds, so these are 2.8 hours and 1.4 hours. Intent was clearly milliseconds. Set to `10` and `5`. This matters more than it looks: `checkWikilinkPolicy` walks the entire KB once per wikilink target, so a 43-link index triggers 43 full recursive scans of 1637 files, and nothing would cut that off.

## Out of scope

- **Widening the see-also rule to catch the 79 inline instances.** The DM declined this (as F7) because 79 files would start erroring. This design removes that objection, since those files would auto-clean on touch. Worth revisiting as a separate change once autofix exists, not bundled here.
- **`contentDmEyesOnlyUnpublished` autofix.** "Add `publish: false`" is mechanical and safe, but whether a leak should be fixed by gating the article or by removing the DM-only block is a judgment the DM should make per instance. Leave it opted out.
- **A one-time sweep of all 445 files.** The DM chose opportunistic cleaning. The sweep's existing fix phase remains available if a big-bang migration is ever wanted.
- **The validation sweep's missing `indexParity` aggregation.** Separate known defect, already tracked.
- **Moving validation to PreToolUse.** Unrelated open question (F4 option b), still undecided.

## Constraints

- No em dashes in any output, including code comments, commit messages, rule descriptions, and this document. A double hyphen is not a substitute.
- Node built-ins only in the hook.
- Never edit the marketplace cache under `~/.claude/plugins/cache/`. Change source, bump version, republish.
- Never run `professor-orb:setup`.
- The plugin stays system-agnostic: no Rolara rule ids, no em dash logic, no see-also logic in plugin code.
