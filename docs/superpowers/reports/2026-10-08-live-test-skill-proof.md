# Live proof of live-test 1.1.0 (2026-10-08)

World: rolara-wednesday. Following `foundryvtt/skills/live-test/SKILL.md` step by step. Problems are logged here and fixed after the wave.

| # | Step | Expected | Result | Notes |
|---|---|---|---|---|
| 1 | WHO, CLOSE, START (`--world=rolara-wednesday`), wait | Foundry up on the named world, nobody connected | Working | Foundry had been closed; up in under a minute, `users: 0` |
| 2 | GM tab: JOIN Gamemaster, READY, POPUPS | `gm: true`, `others: []`, popups closed | Working, with F3 | Canvas false at first (pane hidden); reload fixed it. Popups closed: 2 dialogs, Simple Sockets, Potato Or Not |
| 3 | Find or create Test Player | Trusted, no password | Working | Created `4ODdTsnB9fSgz8h3`, role 2, no password |
| 4 | Second tab at 127.0.0.1: JOIN Test Player, READY | Test Player signed in while the GM tab stays signed in | Working, with F1 | GM tab still Gamemaster and connected, each tab lists the other online |
| 5 | Starting ids, temp hero and dummy, scratch scene, ownership, character, pull | Test Player views the scratch scene, owns the hero only; active scene unchanged | Working | 165 actors, 93 items, 108 messages, 139 folders, 38 scenes recorded |
| 6 | Player side: Test Player attacks the dummy (Midi, damage auto-applied) | Hit lands; damage applied through the GM | Working, with F2 and F4 | Hit 6 vs AC 5, 8 damage, dummy 50 to 42 read from the GM tab. Player sees the attack card, not the GM's whispered damage card |
| 7 | GM side: same attack | Hit lands | Working, with F4 | 14 vs AC 5, 9 damage, 42 to 33 |
| 8 | Cleanup | Id lists match the start; Test Player kept with no character | Working | 2 actors, 1 scene, 5 messages deleted; all five lists, modules, active scene and pause match; CLOSE `running: 0`, `port: False` |

## Findings

- **F1 (skill):** POPUPS left Foundry's character picker (`UserConfig`) open on the Test Player's first sign-in. Fixed after the wave: POPUPS closes `UserConfig` too.
- **F2 (skill):** `game.user.updateTokenTargets` doesn't exist in Foundry 14 (TypeError). Fixed after the wave: `canvas.tokens.setTargets([...tokenIds])` (v14 `client/canvas/layers/tokens.mjs`).
- **F3 (skill):** the hidden-pane recovery's screenshot timed out twice; the reload alone drew the canvas. Fixed after the wave: the skill says the screenshot can time out and to reload anyway.
- **F4 (world, not the skill):** Automated Conditions 5e 14.533.19.3 throws "Cannot read properties of undefined (reading 'toClipperPoints')" on `dnd5e.preUseActivity`, `preRollAttack` and `preRollDamage` in whichever browser rolls, GM or player (`scripts/helpers/ac5e-helpers-distance.mjs`, `t.shape.toClipperPoints()`). Both attack cards read "ADV: Attacker not detected / DIS: Defender not detected". Seen on a bare scratch scene; not checked on a real scene. Flagged as a separate task.
- Note: also on the player side only, statuscounter 3.1.2 throws on `renderVisualActiveEffects` ("reading 'querySelectorAll'"). Cosmetic as far as this test shows.
