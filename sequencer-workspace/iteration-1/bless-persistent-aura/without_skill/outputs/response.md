# Persistent Golden Bless Aura with Auto-Removal (Sequencer + DAE + TimesUp)

## Overview

This setup places a golden pulsing aura on each Bless target and automatically removes it when the spell's concentration ends. The integration chain is:

- **Midi-QOL** handles the spell cast and applies the Bless active effect to each target.
- **DAE** runs a macro when the effect is applied (`On`) and when it is removed (`Off`).
- **TimesUp** tracks the spell duration and removes the active effect when the timer expires or concentration drops.
- **Sequencer** draws and manages the persistent visual effect tied to each token.

When TimesUp or Midi-QOL removes the Bless active effect (timer expiry, concentration loss, or manual deletion), DAE fires the macro in "off" mode, which tells Sequencer to end the visual.

---

## Step 1: Create the DAE ItemMacro

Create a macro in Foundry (type: `script`, any name you like -- e.g., `Bless VFX`). Paste the following:

```js
// Bless VFX — DAE ItemMacro
// Called by DAE with args[0] === "on" when applied, "off" when removed.
// 'token' is provided by DAE as the affected token.

const mode = args[0];

if (mode === "on") {
  new Sequence()
    .effect()
      .file("jb2a.divine_smite.caster.yellowwhite")
      .attachTo(token)
      .scaleToObject(1.8)
      .fadeIn(500)
      .fadeOut(500)
      .opacity(0.6)
      .persist()
      .name(`bless-${token.id}`)
      .origin(args[args.length - 1])
    .play();
}

if (mode === "off") {
  Sequencer.EffectManager.endEffects({ name: `bless-${token.id}`, origin: args[args.length - 1] });
}
```

### What each Sequencer call does

| Method | Purpose |
|---|---|
| `.file("jb2a.divine_smite.caster.yellowwhite")` | JB2A asset -- a golden/white radiant glow that loops cleanly. This is from the JB2A Patreon pack. If you have the free pack, substitute `jb2a.divine_smite.caster.yellow` or another available golden effect. |
| `.attachTo(token)` | Anchors the effect to the token so it moves with it. |
| `.scaleToObject(1.8)` | Scales the effect to 1.8x the token size -- creates a visible aura ring around the token. Adjust to taste. |
| `.fadeIn(500)` / `.fadeOut(500)` | Half-second fade on application and removal for a smooth look. |
| `.opacity(0.6)` | Keeps the glow semi-transparent so it does not obscure the token art. |
| `.persist()` | Keeps the effect running indefinitely (no duration limit) -- it stays until explicitly ended. |
| `.name(\`bless-${token.id}\`)` | Tags the effect with a unique name per token so we can target it for removal later. |
| `.origin(args[args.length - 1])` | DAE passes the origin item UUID as the last argument. This ties the effect to the specific spell cast, so only this cast's effects get cleaned up. |

### Alternative JB2A assets

If you want a different look, these JB2A paths also work well for a golden aura:

- `jb2a.markers.light_orb.loop.yellowwhite` -- soft orbiting light particles
- `jb2a.template_circle.aura.01.yellowwhite` -- a circular aura ring on the ground
- `jb2a.extras.tmfx.outflow.circle.01` -- radial energy outflow (use with `.tint("#FFD700")`)

Preview them in the Sequencer Effect Player (the film-reel button in the token controls) before committing.

---

## Step 2: Configure DAE on the Bless Spell Item

1. Open the **Bless** spell in the actor's spellbook (or your shared Items folder).
2. Go to the **Effects** tab.
3. If there is no Active Effect for Bless yet, create one. Midi-QOL / DAE should already have one that grants the `1d4` bonus.
4. On the Active Effect, set **Duration** so that TimesUp can track it:
   - **Duration (seconds):** `60` (Bless lasts 1 minute / 10 rounds).
   - Alternatively, **Duration (rounds):** `10` and **turns:** `start` or `end` based on your table's preference.
5. In the Active Effect's **Effects** tab (the DAE fields), add a line:
   - **Key:** `macro.itemMacro`
   - **Mode:** `Custom`
   - **Value:** *(leave blank -- DAE auto-calls the item's embedded macro)*
6. On the Bless item's **Details** or **Macro** tab, click **ItemMacro** and paste the same script from Step 1 into the item macro field.

> **Why `macro.itemMacro`?** This tells DAE to execute the macro embedded in the item itself (the ItemMacro) whenever the active effect is applied or removed. DAE passes `"on"` or `"off"` as `args[0]` and the origin UUID as the final argument.

---

## Step 3: Verify TimesUp + Midi-QOL Settings

Make sure your modules are configured to work together:

### TimesUp
- **Game Settings > TimesUp > Enable:** checked.
- **Expire effects on turn end/start:** set to match your table's convention.
- TimesUp will count down the 60-second (or 10-round) duration you set in Step 2 and automatically delete the Active Effect when it reaches zero.

### Midi-QOL
- **Game Settings > Midi-QOL > Workflow > Concentration:** make sure concentration automation is enabled. When the Paladin loses concentration (damage, casting another concentration spell, or voluntary drop), Midi-QOL removes the Bless active effect from all targets.
- **Remove active effects on spell expiry:** should be enabled (this is the default).

### DAE
- **Game Settings > DAE > Use DAE active effect evaluation:** enabled.
- Confirm DAE is set to call ItemMacros (this is the default behavior when a `macro.itemMacro` effect key is present).

---

## Step 4: Test the Full Loop

1. **Cast Bless** with the Paladin targeting three allies. Midi-QOL processes the spell and applies the Active Effect to each target.
2. **Verify the aura appears** on all three tokens -- you should see the golden glow fade in on each one.
3. **Move a blessed token** -- the aura should follow it.
4. **End the spell** by any of these methods to confirm auto-removal:
   - Advance rounds until the duration expires (TimesUp removes the effect).
   - Have the Paladin take concentration damage and fail the save (Midi-QOL removes the effect).
   - Right-click the Bless effect on a token and delete it manually.
5. **Verify the aura disappears** with a smooth fade-out on each affected token.

---

## How the Auto-Removal Chain Works

```
Spell expires (TimesUp) ──┐
Concentration lost (Midi) ─┤──> Active Effect removed from token
Manual deletion ───────────┘
                                     │
                                     ▼
                          DAE fires ItemMacro with args[0] = "off"
                                     │
                                     ▼
                          Sequencer.EffectManager.endEffects()
                          removes the named persistent effect
                                     │
                                     ▼
                          Golden aura fades out on the token
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Effect does not appear | Open the Sequencer Effect Player and search for the asset path to confirm your JB2A pack includes it. Free vs. Patreon packs have different assets. |
| Effect appears but does not move with token | Make sure you are using `.attachTo(token)` and not `.atLocation(token)`. |
| Effect does not disappear when spell ends | Confirm `macro.itemMacro` is in the Active Effect keys. Check that the effect has a duration set for TimesUp to track. Open the console (F12) and look for errors in the macro. |
| Effect disappears but no fade-out | The `.fadeOut(500)` in the Sequence handles this, but if the effect is force-removed (e.g., via `Sequencer.EffectManager.endEffects`), the fade should still trigger. If not, increase to `.fadeOut(1000)`. |
| Multiple overlapping auras on one token | The `.name()` and `.origin()` combo prevents duplicates from the same cast. If you are getting duplicates, make sure you are not also calling the macro from a separate hook or trigger. |
| Console error about `args` being undefined | If running the macro standalone (not via DAE), `args` will not exist. This macro is designed to be called only through DAE's ItemMacro system. |
