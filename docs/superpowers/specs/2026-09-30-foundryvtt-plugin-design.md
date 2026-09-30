# foundryvtt plugin: package the live-test skill

- **Date:** 2026-09-30
- **Branch:** `claude/foundry-packaging-handoff-3952a2`
- **Status:** approved; built and checked, awaiting /land
- **Source handoff:** `%TEMP%\foundry-live-test-packaging-handoff-2026-09-30.md`

This file is the spec, the step list, and the progress tracker.

## Goal

The `foundry-live-test` skill is currently a project command in the Foundry Data folder (`%LOCALAPPDATA%\FoundryVTT\Data\.claude\commands\foundry-live-test.md`). It only works in sessions started there. This work moves it into this repo as a plugin, so any Foundry project (the Data folder, or a module repo in `GitHub\`) can switch it on, and every project gets improvements from one source.

Success looks like this:

- In a project with the plugin switched on, Claude starts the skill by itself when a plan reaches live testing, and `/foundryvtt:live-test` also works.
- In any other session, the skill isn't loaded at all.
- One copy exists: the one in this repo.

## Decisions (settled 2026-09-30)

1. **Name and scope.** Plugin `foundryvtt`, listed in the existing `professor-orb-marketplace`. It holds one skill, `live-test`, invoked as `/foundryvtt:live-test`. It can take more Foundry skills later; nothing else goes in now. The name avoids clashing with other "foundry" tools.
2. **Skill, model-invoked.** It's a skill folder, and Claude may start it on its own. There's no `disable-model-invocation`. Its description is worded to match the testing stage of a plan.
3. **Table-specific details stay in the skill.** These are port 8678, the LAN address to avoid, the "testing grounds" actors, and the Midi, Epic Rolls, Combat Booster and Levels notes. The plugin is tuned for this table, not built for general sharing. Checked: no personal information; the LAN address is private to the home network.
4. **Per-project install at local scope.** Each project installs with the "this repo only" option, which writes `.claude/settings.local.json`. That matches how the Data folder already enables superpowers, and it keeps the setting out of files that module repos share on GitHub. Never user level.
5. **Retire the Data-folder copy** once the plugin is installed and working there, with the user's go-ahead at that time.

**Considered and rejected:**

- **Reading the port and Data folder from Foundry's `Config/options.json` at run time, plus a separate per-module notes file.** It added lookups to every run and slowed it down.
- **A setup skill.** It needs a setup run for each install.
- **User-level placement.** It loads Foundry context into unrelated sessions.

## What gets built

| File | Change |
|---|---|
| `foundryvtt/.claude-plugin/plugin.json` | New. Name, description, author, `"version": "1.0.0"`. |
| `foundryvtt/skills/live-test/SKILL.md` | New. A copy of the Data-folder command with the four edits below; everything else is word for word. |
| `.claude-plugin/marketplace.json` | Add a `foundryvtt` entry, `"source": "./foundryvtt"`, version `1.0.0`. |
| `CLAUDE.md` | Add a `foundryvtt/` section: what it is, local-scope installs, the version rule, and "edit the skill here, not an installed copy." |
| `README.md` | Add a `foundryvtt/` line under Contents. |

### Edits to the skill

1. **Frontmatter.**
   - Add `name: live-test`.
   - Replace `description` with a trigger-shaped one: use it when a Foundry VTT module, macro or automation change is ready to try in a live world (the testing stage of a plan), or when the user hands over a signed-in world.
   - Keep `argument-hint` and the `allowed-tools` list unchanged.
2. **Context.** It currently opens with the user handing over a world. The new wording: a change is ready to test live, or the user has handed over a world. Test target: `$ARGUMENTS`; if that's empty, take the target from the plan or conversation. When Claude starts the skill itself, `$ARGUMENTS` is empty.
3. **Step 1 (point Foundry at the code).** Add one line for a new module repo. If `%LOCALAPPDATA%\FoundryVTT\Data\modules\<id>` doesn't exist yet, ask the user to close Foundry, then create it with `cmd /c mklink /J`, pointing at the repo's main checkout. The Data path is written with `%LOCALAPPDATA%`, which keeps the username out of the file.
4. **Step 2 (connect).** The user connects; Claude doesn't. The new steps:
   1. Ask the user to open **http://localhost:8678** in the built-in browser, sign in as Gamemaster, and say go once the world has loaded. Claude doesn't open it or wait on it, because load times vary by world and module set.
   2. Keep "never 192.168.1.11". Add the reason: its per-action "Allow once" prompt blocks auto mode.
   3. After "go", confirm that the tab's `location.origin` is localhost, which world is loaded, and that Claude is signed in as Gamemaster.
   4. Keep the existing "fetch a changed file to prove Foundry serves the code under test" check.

Linked tokens: the skill doesn't tell agents to avoid them, and that stays true. Its only token rule is about casting from a token copy of a *real* character, and backup copies are allowed.

## How updates reach projects

Installs are copied into a store labelled by version (`~\.claude\plugins\cache\professor-orb-marketplace\<plugin>\<version>\`). This machine shows professor-orb installs pinned at older versions. So a change ships only when the version goes up:

1. Edit `foundryvtt/skills/live-test/SKILL.md` in this repo. Edits made to an installed copy are lost.
2. Raise `version` in both `foundryvtt/.claude-plugin/plugin.json` and the `foundryvtt` entry in `marketplace.json`. They must match. `/land` doesn't do this for foundryvtt (a separate task is generalizing `/land`).
3. Land it on `main`.
4. In each project, update the plugin from the `/plugin` menu.

## Install, for the user, per project

Run these in a Claude Code session started in the project folder:

```
/plugin marketplace update professor-orb-marketplace
/plugin install foundryvtt@professor-orb-marketplace
```

When the installer asks where to install, choose the **local** option ("this repo only"). Restart the session, then check that `/foundryvtt:live-test` appears.

## Out of scope

- Moving `ddb-reimport` or `resume-handoff` into the plugin.
- Generalizing `/land` (it's a separate task).
- Support for other browsers or other machines.
- Any other change to the skill's steps or guardrails.

## Steps and tracker

- [x] 1. The user approves this spec
- [x] 2. Create `foundryvtt/.claude-plugin/plugin.json`
- [x] 3. Create `foundryvtt/skills/live-test/SKILL.md` from the Data copy with the four edits (the Data copy is untouched)
- [x] 4. Add the `marketplace.json` entry
- [x] 5. Add the `CLAUDE.md` section and the `README.md` line
- [x] 6. Check the work:
  - both JSON files parse
  - the versions match
  - a diff of `SKILL.md` against the Data copy shows only the four edits
  - `claude plugin validate foundryvtt`, if the command exists
- [ ] 7. Finish the branch with `/land` (merge to local `main`; push after the user confirms)
- [ ] 8. The user installs in the Data folder (local scope) and confirms that `/foundryvtt:live-test` is listed
- [ ] 9. With the user's go-ahead, delete `Data\.claude\commands\foundry-live-test.md`
- [ ] 10. The user installs in module repos as needed
