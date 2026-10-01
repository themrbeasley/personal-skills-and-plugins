# professor-orb: no present status in staged articles, items only when they were in the story, one lore agent, and a stricter correction search

Design, 2026-10-01. Source: `rolara-project/docs/professor-orb-report-2026-10-01.md`,
compiled after the Big Guy's Gang session of 2026-09-30 and its `debrief`. Scope
approved by the DM in conversation on 2026-10-01.

The report raised four items. Every quote in it matches the plugin source. Checking
them turned up two causes the report missed, one suggested fix that cannot work, and
one recurrence that traces to an incomplete earlier fix.

| # | Report item | Cause found | Ships |
| --- | --- | --- | --- |
| 1 | Staged articles carry status lines, and a stale one sent a wrong location to the table | Chronicler's article test has no rule for present status and its "where it sits" invites it; the lore agent proposes updating status instead of deleting it; nothing checks at write time. Also, rolara's own `CLAUDE.md` line 154 names "Current Status" as a model section header | Change 1 |
| 2 | Equipment questions reach the DM | The lore agent raises item possession questions, and debrief's interview checklist asks about inventory every session, which is the "always" the DM described | Change 2 |
| 3 | Debrief tells the lore agent to fan out, and it cannot | Claude Code does not let a subagent start subagents, whatever tools it has, so the fan-out step has never run | Change 3 |
| 4 | The correction hook fired on common words again | Defect of commit `d4e6717` (2026-09-30, written by Claude): it shipped two of the 09-29 report's four hook fixes and left the search keyed on common words, without saying so | Change 4 |

## Change 1: a staged article carries no present status

**The rule, in the DM's words:** "Staged articles can't have current statuses, their
status is entirely in reports and preps and nowhere else as a law."

Present status means where the subject is now, what it is doing now, and its
condition now. Its forms in a staged article: a `Current Status` or `Status`
heading, a `**Status:**` field, an "as of Day N" sentence, and a lede that says where
someone is. An article changes only when chronicler runs, so each of these freezes
on the day it was written while the reports move on.

Vault articles (under `kbRoot`) are out of scope. The rolara vault uses Current
Status sections on purpose (32 articles), and the DM's rule names staged articles.

### Chronicler (`skills/chronicler/SKILL.md`, "What an article is")

- "where it sits" becomes "where it is fixed in place (a fortress's site, an order's
  seat)", so the positive instruction stops inviting a mobile subject's position.
- After the four kinds of campaign sentence, add a fifth that applies in a staged
  article only: **the present**, defined as above, naming its forms. Its home is the
  session reports and prep briefs. The history that led to the present state still
  belongs in the article's History; only the present-tense state leaves.
- Name the validator rule below so chronicler knows a status heading, field, or
  "as of Day N" sentence will be refused.

### Lore agent (`agents/lore.md`)

- Step 2: the session report is the record of where each entity is now and what
  condition it is in.
- When a staged article states present status, put a deletion of that passage in the
  edit bucket. Compare nothing against it and raise no contradiction over it.
- Location and status contradictions stay as they are for vault articles.

### SHARED-PRINCIPLES, Principle 14 (look it up before you ask)

Add one sentence: where something is now and what condition it is in come from the
campaign's most recent session report and prep brief. This is the lookup that went
wrong at the table on 2026-09-30.

### The validator rule

A new base rule in `references/base-rules.json`:

```json
"contentStagedNoPresentStatus": {
  "provenance": "professor-orb",
  "category": "content",
  "check": "prohibitedPattern",
  "scope": "staged",
  "enforcement": "block",
  "description": "A staged article carries no present-status heading, Status field, or as-of-Day sentence.",
  "params": {
    "pattern": "^#{1,6}[ \\t]*(?:current[ \\t]+)?status[ \\t]*:?[ \\t]*$|^[ \\t]*(?:[-*][ \\t]+)?\\*\\*(?:current[ \\t]+)?status:?\\*\\*|\\bas of day[ \\t]+\\d",
    "flags": "im",
    "appliesTo": "body",
    "message": "A staged article carries no present status: where its subject is now, what it is doing now, or its condition now. That lives in the campaign's session reports and prep briefs. Delete the heading or field and the status under it rather than renaming or moving it; a past event that sat under it belongs in History."
  }
}
```

The pattern catches `## Current Status`, `### Status`, `**Status:** Free`,
`- **Status:** Free`, `**Status**: Free`, and "as of Day 293". It passes
`## Status Effects`, "the status of the treaty", and "as of the Day of Ash". A lede
that places someone is prose and stays chronicler's and the lore agent's to catch.
Run over all 160 of rolara's staged files on 2026-10-01, it flags exactly one: the
Deck of Many Things file the cleanup missed. No handout, setpiece, or index trips it.

**Decision: a new `scope` value, `"staged"`, rather than a new check kind.** The
existing `prohibitedPattern` check does the matching, so no new check code is
needed, and the glossary already describes staged articles by how `scope` treats
them. A `"staged"` rule applies only when the file sits in a setting's
`sessionReportsRoot` and its name does not end in `-REPORT.md` or `-PREP.md` (case
insensitive). Those suffixes are professor-orb's own naming for reports and briefs,
and rolara's files follow them even where its `type` values differ ("Report",
"Prep"). Everything else in the campaign folder, handouts and setpieces included, is
covered, which matches "nowhere else".

**Decision: block, not warn.** The DM called it a law. The validator runs after the
write, so "block" means Claude is told the write broke the rule and has to fix it
before moving on.

**Decision: no autofix.** A status section can hold a past event worth keeping, and
deleting text is not a fix class to pre-approve. The writer removes it with the
message above as its guide.

**`prohibitedPattern` gains an optional `message` param.** Today it reports
`Prohibited pattern (<regex>) found in body.`, which for this rule is an unreadable
regex. With `message` set it reports the message plus the matched line, trimmed to
120 characters. The em dash rule sets no `message` and keeps its current output.
This matters beyond readability: a writer blocked by a bare regex can satisfy it by
renaming the heading, and the message says to delete instead.

**The sweep ignores `"staged"` rules.** `/sweep` checks vault articles only, and
staged articles sit outside it (glossary, "staging area"). `validation-sweep.mjs`
drops every `scope: "staged"` rule from a setting's rules after parsing them, so the
checker never applies this rule to the vault's 32 Current Status sections.

### Files

- `hooks/validate-write.mjs`: the `"staged"` scope gate beside the `"kb"` one; the
  `message` param in `checkProhibitedPattern`.
- `references/base-rules.json`: the rule above.
- `workflows/validation-sweep.mjs`: drop `"staged"` rules after parse.
- `skills/setup/references/conventions-schema.md`: "Note on `scope`" gains
  `"staged"`; the `prohibitedPattern` params row gains `message`; the base-rule
  table gains the new rule.
- `CONTEXT.md`, "staging area": a `scope: "staged"` rule applies to staged articles
  alone.
- `skills/chronicler/SKILL.md`, `agents/lore.md`, `skills/SHARED-PRINCIPLES.md` as
  above.

## Change 2: an item is recorded when it was part of the story

**The rule, in the DM's words:** an item that is "a narrative piece of the scene is
worth logging in the session report," like the party buying the *Kitani*. A
character's full kit is not reviewed item by item, an item that did not come up is
not asked about, and once the DM settles a group of items, it is settled.

### Debrief (`skills/debrief/SKILL.md`)

Interview checklist item 5, "Notable inventory updates", becomes **items in the
story**: an item that took part in a scene this session (bought, found, lost,
destroyed, transformed, identified, or used in a way that mattered). Ask about an
item only when it came up in the session and what the DM said leaves its fate
unclear. A blanket answer ("everything he carried went with him") settles every item
it covers. A character's kit belongs to the table and the character sheet.

The default report outline's "inventory" becomes "items in the story". A project
template's own section name (rolara's "Notable Inventory Updates") is left alone.

### Lore agent (`agents/lore.md`)

Report on an item only what it is and what it does. Who holds it and where it is
belong to the table and the character sheets, so they produce no question,
contradiction, edit, or Deferred item.

**Decision: no matching filter in debrief Phase 4** (the report suggested one for
both status edits and item questions). It would be a second prose copy of the lore
agent's rule. The lore agent is the only source of these items, and for status the
validator catches what reaches a write.

## Change 3: one lore agent, reading one entity at a time

Claude Code gives a subagent no way to start subagents, so the lore agent's Step 4
has never run: every lore check so far took its "fan-out unavailable" fallback. The
fallback is the real design and becomes the only one.

- `agents/lore.md`: description and first example lose the fan-out; Steps 3 to 5
  become one step that reads, for each listed entity in turn, the report and that
  entity's article(s), checking content exclusion before each read, then does the
  cross-entity synthesis over its own findings. The output's `Mode` line goes. The
  "Keep subagent scope narrow" rule becomes: read the report and the listed
  entities' articles, nothing wider. (On 2026-09-30 the agent read Mundarr, the
  Farhold, Caliban, and Urso, which were not on its list, and those reads produced
  the item 1 and item 2 proposals.)
- `skills/debrief/SKILL.md`: Phase 4 passes the report path and entity list and
  drops both fan-out bullets; the "Spawns" line drops "fanned out per entity".
- `CONTEXT.md`: the "lore fan-out" entry is renamed "lore check" and rewritten to
  match, keeping its quote-anchoring rules.

**Decision: debrief does not launch one lore agent per entity instead.** It would
cut the wait (10.5 minutes for 19 entities on 2026-09-30), but each agent re-reads
the conventions, the project's `CLAUDE.md`, and the report, so cost grows with the
entity count. The wait happens after the session, not at the table. Revisit if the
DM says the wait is a problem.

## Change 4: the correction hook matches more strictly and says less

### What changes in `hooks/dm-correction.mjs`

1. **A line must hold at least half the search words** (rounded up, and never
   fewer than two when there are two or more), instead of any two.
2. **Contractions join the stoplist:** `youre`, `thats`, `dont`, `isnt`, `wasnt`,
   `arent`, `werent`, `theyre`, `theres`, `cant`, `wont`, `hasnt`, `havent`. The
   tokenizer strips apostrophes, so "you're wrong" turned "youre" into a search word
   that never matches anything and only raises the bar for the real words.
3. **The output says what it searched.** "in the campaign lane" becomes "in this
   project", in both the hit and no-hit messages and the file's header comment.
   SHARED-PRINCIPLES Principle 3 gets the same correction.
4. **The instruction asks only about copies.** "Report this list to the DM and ask
   once whether to fix them all" becomes: read each line against what the DM
   corrected; put to the DM only the lines that repeat the corrected claim and ask
   once whether to fix them all; a line that only shares words with the correction
   is not a copy; when no line repeats it, say nothing about the search.
5. **The no-hit message covers a chat claim:** when what the DM corrected was
   something Claude said in chat, no file holds it and nothing needs fixing.

### Measured on the rolara project (2026-10-01)

| DM message | Today | With 1 and 2 |
| --- | --- | --- |
| The 2026-09-30 correction ("Every single report since he was encountered at the underwater temple has tracked his status and location...") | 20 unrelated lines (an amulet, a deity, homebrew) | No lines; the hook tells Claude to find it itself |
| "No, Aethon was aboard the Twilight's Vigil, not at the Stone of Endurance. You're wrong." | 20 lines, led by homebrew items naming the Stone | 17 lines, all about Aethon, the *Vigil*, or the Stone |
| The 2026-09-18 founding case ("the reporter never asked what the team was called") | Finds the report line and the NPC line | Unchanged: four search words, so the bar stays at two |

### Decisions

- **Not names-only, though the scope approved in conversation said so.** Tested,
  it breaks the founding case: "the reporter never asked what the team was called"
  holds no name, so the hook would search nothing for the very incident it exists
  for. Lowercase typing would defeat it too. The half-the-words bar removes the
  observed noise and keeps that case.
- **The search stays project-wide.** A wrong claim can spread into vault and
  homebrew articles, so narrowing to one campaign would hide real copies. The label
  was the false part, and it is fixed.
- **The 20-line cap stays.** Since 1.21.1 each line is a 200-character snippet, so
  20 fit inline. The stricter match does the rest.

## Testing

Node built-ins, as for every suite here.

- `hooks/validate-write.test.mjs`, for the new rule: a staged article with
  `## Current Status` is blocked, and the message carries the matched line; the same
  body in a `-REPORT.md` and a `-PREP.md` file passes; the same body under `kbRoot`
  passes; `**Status:** Free` and "as of Day 293" are blocked; `## Status Effects`
  passes. The em dash rule's output is unchanged with no `message`.
- `hooks/dm-correction.test.mjs`: a new fixture holding the two noise lines from
  2026-09-30 ("Every amulet guards against a single form of harm", "Every temple,
  every prayer, every sunrise"), searched with the 2026-09-30 message, yields no hit
  lines. The two assertions on "in the campaign lane" follow the new wording. Every
  existing case passes unchanged.
- All suites pass.
- **Live check on rolara before landing:** run the new hook on the three messages in
  the table above and match the table; run the validator on the leftover
  `Deck-of-Many-Things-Rolara-Provenance.md` and see it blocked.

## Release and rollout

- **Version 1.22.0**, in both `professor-orb/.claude-plugin/plugin.json` and the
  root `.claude-plugin/marketplace.json` (a new rule, so a minor version).
- **The code reaches rolara when it lands on main.** The marketplace is a directory
  source pointing at this repo's main checkout, and the 2026-09-30 session ran the
  1.21.x debrief text without that version ever being copied to the plugin cache.
- **The rule reaches rolara's `conventions.json` one of two ways**, the DM's choice
  at rollout: a full setup resync (the 14-step migration with its snapshot), or
  adding the rule entry above to both settings by hand and setting `generatedBy` to
  `"manual"`. Setup's drift check names the rule as missing until one of them is
  done. The hand edit is the lighter path for a single rule.
- **Two fixes in the rolara repo**, separate from this release: `CLAUDE.md` line 154
  marks "Current Status" as a vault-only header, and the leftover Current Status
  section in `Big-Guys-Gang/content/references/Deck-of-Many-Things-Rolara-Provenance.md`
  (and its status lede, "Currently depleted of the cards pulled by the party") is
  removed, with the DM's go-ahead on that file's text.

## Out of scope

The report's own scope note lists failures that were Claude's, against
instructions it already had: the wrong location from a stale article, the claim that
no report tracked it, a self-computed calendar label, a repeated payment question,
an unrequested `CLAUDE.md` edit. Change 1 removes the stale source behind the first,
and Principle 14's new sentence names the right one. The rest stay prose that
already exists.
