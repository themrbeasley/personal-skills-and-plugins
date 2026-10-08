# foundryvtt live-test: both sides, and Claude runs Foundry

- **Date:** 2026-10-08
- **Branch:** `claude/live-test-skill-player-side-a826ed`
- **Status:** live proof passed (`docs/superpowers/reports/2026-10-08-live-test-skill-proof.md`); three skill fixes from it applied; waiting for the user's approval to land.

This file is the spec and the progress tracker.

## Defects

1. **The player side was never tested.** The Data-folder command was written for Gamemaster only, and Claude packaged it word for word in `9e41c10` (2026-09-30), with changes to its steps out of scope. Claude worked around the gap three times instead of fixing it: 2026-10-01 (the user signed in as Matt), 2026-10-04 (Starry Form SPEC item 13, "Fall's own browser is not tested live"), 2026-10-08 (Horatio/Holly asked for a player account). Unreported until 2026-10-08.
2. **The skill told Claude to ask the user to start, sign in to and close Foundry.** The user's standing word of 2026-10-06 says Claude does all three. Claude recorded it only in the Data folder's `CLAUDE.md` (`60bc01f`) and `/foundry-join`, which sessions in module repos never load. The tested procedure was pasted into each house-automation plan instead of the skill.

## Decisions

1. **Test Player account:** permanent, one per world, Trusted Player role, no password. The skill creates it if the world has none (the user's call, 2026-10-08). Real players' accounts are never used.
2. **Second sign-in at `http://127.0.0.1:8678`.** Browsers keep sign-ins per address, so the GM tab on localhost stays signed in. Checked 2026-10-08: the address loads in the built-in browser with no "Allow" prompt.
3. **The GM tab stays signed in during player tests,** because modules carry out player actions in the GM's browser.
4. **Every test runs on both sides.** A GM-only feature records "n/a" on the player side, with the reason.
5. **Start, close, join, ready and popup commands come from house-automation's 2026-10-07 plan,** where they were run live, so every project gets them from the skill. Close uses `CloseMainWindow`, never a kill, so the databases flush.
6. **The Test Player reaches the scratch scene through `scene.pullUsers`,** which moves only that user's view (Foundry v14 `client/documents/scene.mjs`). The active scene doesn't change.
7. **Version 1.1.0:** a new capability, so the minor number goes up.

## Out of scope

- Removing the pasted procedure from finished house-automation plans.
- Changing `/foundry-join` or the Data folder's `CLAUDE.md`.

## Tracker

- [x] Scope approved (2026-10-08, with the permanent Test Player change)
- [x] Skill rewritten; version 1.1.0 in `plugin.json` and `marketplace.json`; `CLAUDE.md` and `README.md` lines
- [x] Live proof in Rolara-Wednesday (2026-10-08, passed): Claude starts or joins Foundry, both tabs signed in at once, Test Player created as Trusted, pulled to a scratch scene, one player-side action through Midi, cleanup back to the starting lists
- [x] Fixes from the live proof (F1 character picker, F2 v14 targeting, F3 hidden-pane recovery)
- [ ] The user approves; `/land`
- [ ] After landing: correct house-automation's memory `live-test-player-and-gm.md`. It lists signing in and closing Foundry as faults, and it asks the user for a player account; both conflict with 1.1.0.
