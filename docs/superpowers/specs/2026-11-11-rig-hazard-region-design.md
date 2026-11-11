# foundryvtt: the rig-hazard-region skill

- **Date:** 2026-11-11
- **Branch:** `worktree-foundryvtt-condense-and-hazards`
- **Status:** design, awaiting the user's OK.
- **Ships in:** foundryvtt 1.2.0, with `condense-scenes-to-levels` and the live-test lessons (those two are fully specified by the handoff brief and have no design of their own).

## Intent

The user wants to set up a 2024 DMG hazard or trap on a map quickly: draw a region where it belongs, and have it go off on its own when a creature walks in, using the effect the Multitrap token already carries. Midi-QOL already ships a region behavior that does this, so the baseline needs no code. Sometimes the user will want more, the way the quicksand region got a stop, a pause and a view jump. Those extras are small scripts: built only after approval, tested well, recorded in the macro library, and offered again the next time the same hazard comes up.

## Goals

- One skill for hazards and traps. They run on the same machinery; what differs fits in one table row per item.
- Baseline: a region, the Midi Region Activity behavior, and a nearby Multitrap token whose item activity fires. No script.
- Ask for the danger level whenever the item has level bands, and fire the matching activity.
- Extras on request: propose, wait for the user's OK, build, test live, record. Recorded extras are offered again by hazard name.
- Nothing gets created in a world before the user approves the setup.

## Non-goals

- Ongoing effects stay manual: sinking, suffocation, escape checks, moving through floors. The user automates only the moment a hazard or trap goes off.
- Touch hazards stay manual (Yellow Mold's Touch Mold, Green Slime's contact). A region can't tell when someone touches something.
- Detecting and disarming traps stay at the table. The GM disables the behavior when a trap is disarmed.
- Nothing goes into House Automation. Its patch-only rule (2026-10-08) keeps new automation out, and the user agreed this isn't its territory.

## Anti-goals

- A shared engine or a configurable mega-script. The user asked for something simple.
- Building an extra the user didn't approve.
- Rebuilding a recorded extra from scratch. Quicksand should keep working the way it does now.

## Decisions (settled with the user, 2026-11-11)

1. **One skill** covers hazards and traps.
2. **Baseline is Midi Region Activity** (`midi-qol.regionActivity`, Midi-QOL 14.0.12) pointed at an activity on a Multitrap token placed near the region.
3. **Level.** When the user gives a level (or a band), pick the activity for that band; when they don't and the item has bands, ask.
4. **Extras are macro scripts** on the same region, an Execute Script behavior beside Midi's, like `Data/macros/quicksand-region-trigger.js`. They can be anything: animations (Sequencer and JB2A are installed), conditional effects, a pause for everyone, a view jump.
5. **Approval, testing, tracking.** An extra is described and approved before it is written, tested with `foundryvtt:live-test` as Gamemaster and as Test Player, then saved to `Data/macros/` with the house header and a row in `macros/INDEX.md`, committed in the Data repo with explicit paths. Its `Tags:` line names the hazard, so a later run finds it by name.
6. **Flyers are the GM's call at the table.** The baseline fires on any entry, whatever the creature is doing. The GM raises a flying creature's elevation (a shallow region lets it pass over) and waves off a result when one sets something off anyway. No region gets a flyer-skipping script as part of the baseline.

## Facts the builder needs

### Midi Region Activity (read from `modules/midi-qol/midi-qol.js`, not yet tested live)

- Fields: `sourceItemUuid`, `sourceActorUuid`, `rules[]` of `{trigger, action, targetUuid}`, `dispositionFilter` (-1 enemies, 0 all, 1 allies; default -1), `castLevel`, `excludeSource` (default true), `oncePerTurn` (default true), `wallRestriction`. It has its own config sheet with an Add Rule button.
- Triggers: `entry`, `exit`, `turnStart`, `turnEnd`. Actions: `useActivity`, `applyEffect`, `removeEffect` (an effect uuid).
- `entry` and `exit` run on the mover's client: Midi pauses the movement, runs the rules, then resumes it, so the token finishes its move. `turnStart` and `turnEnd` run on the active GM.
- `useActivity` targets only the token that triggered it. An area activity (the statue's cone) does not reach other creatures standing in the area.
- `oncePerTurn` only counts during an active combat. Outside combat a rule fires every time.
- Hidden or secret tokens never trigger it (`isValidTarget`).
- It listens to core's Token Enter event, which fires on any entry, including a displace placement.
- Set `dispositionFilter` to 0 (all). The default skips creatures that share the source token's disposition.

### The Multitrap (Rolara-Wednesday actor `B7nyDrAjQ3MXDVmm`, token "Multitrap (1)" on the Laboratory level)

Items with one activity per level band (1-4, 5-10, 11-16, 17-20): Collapsing Roof, Falling Net (plus escape checks and Set Trap), Spiked Pit, Hidden Pit, Poisoned Needle, Poisoned Darts, Fire-Casting Statue (cone), Poisonous Gas ("Level 1-4 Save" and so on, plus Place Gas), Vicious Vine ("Save Level 1-4", plus Persuade Plant Check), Rockslide ("Rockslide Level 1-4", plus Escape Check).

Items with one version: Brown Mold, Fireball Fungus (sphere), Webs (plus Escape Check), Razorvine, Rolling Stone (plus Slow), Green Slime (Avoid, Contact Damage, Wood/Metal Damage), River Styx, Inferno (Place Inferno plus damage), Yellow Mold (Place Mold, Touch Mold, Start of Turn Damage), Quicksand Pit (Place and two checks only: no activity for stepping in, which is why quicksand is all extra).

"Place ..." utility activities lay down the hazard's area template; they are not what a region fires. Each item's description (from the DMG module) states its trigger, for example the statue: "moves onto this trap's pressure plate for the first time on a turn or starts its turn there".

### Other pieces

- Core Pause Game behavior is a no-code option: it stops the token and pauses the game, but only when a player moves it, never a GM. The quicksand-style pause whoever moved is an extra.
- On a v14 scene with Levels, a region needs `levels` set to its floor's level and its elevation starting at that level's bottom. A shallow region (top about a foot above the floor) should let flying tokens pass over; confirm live.
- Execute Script behaviors run on every client. Gate each action the way the quicksand script does (`event.user.isSelf`, `game.user.isActiveGM`).
- Other worlds may have no Multitrap actor. Ask the user where to get one; never build one.

## The skill's flow

1. Take the request: which hazard or trap, which scene and level, where, and the danger level if the item has bands. The user marks the spot in Foundry: a region they drew (the skill adopts it and sets its level and elevation instead of making a second one), or a token or tile it sits next to (the skill proposes squares around it). The skill never picks squares from the map art.
2. Read the item's description and fill its table row: region placement (on the hazard, or on the trigger squares like the statue's pressure plate), triggers, once per turn or every time, single target or area.
3. Look in `macros/INDEX.md` for recorded extras tagged with this hazard.
4. Propose the setup in one message: region squares and level, the Multitrap token's spot (for the statue, on the statue, so it reads as the source), the Midi rules with the chosen activity, Pause Game yes or no, any area-effect gap, and recorded extras to reuse. Wait for the OK.
5. Build what was approved: Multitrap token (hidden, same level), region, Midi behavior, and any approved extra.
6. Test with `foundryvtt:live-test`: each trigger, moved by the GM and by the Test Player, walking in and walking through; the save prompt reaches the right client; damage and effects land; the Multitrap token doesn't set it off, and a token raised above the region passes over it. Place test tokens outside the region first, then drag them in, because a displace placement inside the region also fires it.
7. Record any new extra in the macro library and commit it in the Data repo.
8. Report what was built, what passed, and anything left manual.

## Left to the builder

- The per-item table itself, built from each item's description.
- The command blocks (create the region, the behavior, place the Multitrap token), in live-test's style.
- How to handle an area activity (cone, sphere, square) once it fires. Midi passes `configure: false`, but a template prompt may still open. Check this live and write down what happens.
- My calls, for the user to check:
  - The name stays `rig-hazard-region` as briefed, and its description names traps too.
  - The Multitrap token goes on the region's level and is hidden from players.
  - Where it goes comes from the user marking the spot in Foundry (flow step 1), never from reading the map art. (The user agreed, 2026-11-11.)
  - It is a prep-time skill (the user agreed, 2026-11-11). It follows live-test's rule: with anyone but the GM connected it stops and asks, because testing drops tokens, chat cards and maybe a pause onto a scene players can see.

## Considered and rejected

- **A House Automation "Spring Hazard" behavior.** It would break the module's patch-only rule, and Midi already covers the baseline.
- **A configurable script pasted into every region.** Midi's form covers the baseline without code; scripts are kept for extras.
- **Enhanced Region Behavior's Trap type.** The save DC and damage are typed into each region by hand instead of coming from the trap item.
- **Separate hazard and trap skills.** They would repeat the same setup, testing and tracking.
