# Bless — Persistent Golden Aura with Automatic Removal

## Environment check

You're running Foundry v13, DND5e 5.2.5, with Midi-QOL, DAE, TimesUp, and JB2A Patreon. That's the full automation stack — everything we need for a self-managing visual effect.

## What we're building

- A golden pulsing aura attached to each blessed token
- Persists as long as the Bless Active Effect is present
- Automatically removed when Bless expires (TimesUp handles duration, DAE triggers the cleanup macro, Sequencer ends the visual)

The chain is: **TimesUp expires the duration** → **DAE removes the Active Effect** → **DAE fires the macro with "off"** → **Sequencer ends the persistent effect**. Once wired up, it's fully automatic.

## Step 1: Prototype the visual in the console

Select one token on the canvas, then paste this into F12 console. This lets you see the aura before wiring anything up.

```js
const token = canvas.tokens.controlled[0];

new Sequence()
  .effect()
    .file("jb2a.extras.tmfx.border.circle.inpulse.01.normal")
    .attachTo(token, { followRotation: false })
    .scaleToObject(2)
    .persist()
    .name("bless_aura")
    .fadeIn(800)
    .fadeOut(800)
    .tint("#FFD700")
    .opacity(0.7)
    .belowTokens()
    .loopProperty("spriteContainer", "scale.x", {
      from: 0.95, to: 1.05,
      duration: 1500,
      pingPong: true,
      ease: "easeInOutSine"
    })
    .loopProperty("spriteContainer", "scale.y", {
      from: 0.95, to: 1.05,
      duration: 1500,
      pingPong: true,
      ease: "easeInOutSine"
    })
  .play();
```

What this does:
- `jb2a.extras.tmfx.border.circle.inpulse.01.normal` — a clean circular border pulse. Good for buff indicators.
- `.attachTo(token, { followRotation: false })` — follows the token's movement but doesn't spin when the token rotates.
- `.scaleToObject(2)` — sizes the aura to twice the token's dimensions. Adjust to taste (1.5 for tighter, 2.5 for wider).
- `.tint("#FFD700")` — gold. This is what makes it feel like Bless specifically.
- `.opacity(0.7)` — slightly translucent so it doesn't overpower the token art.
- `.belowTokens()` — renders under the token so it frames rather than covers it.
- The two `.loopProperty()` calls create the gentle pulse — scaling between 0.95x and 1.05x over 1.5 seconds with a smooth sine easing, ping-ponging back and forth.

**Clean up after testing:**
```js
await Sequencer.EffectManager.endEffects({ name: "bless_aura" });
```

If the gold tint doesn't pop enough against your map, try `"#FFDF00"` (slightly brighter) or `"#FFC800"` (warmer amber). If the pulse feels too subtle, widen the range to `from: 0.9, to: 1.1`. If it feels busy, narrow to `from: 0.97, to: 1.03` or remove the loopProperty calls entirely for a static glow.

## Step 2: Create the DAE macro

This is the macro that DAE will call when the Active Effect is applied ("on") or removed ("off"). Go to the **Macro Directory** (book icon in the sidebar) → **Create Macro** → name it `Bless_Aura` → set type to **Script**.

Paste this:

```js
// Bless_Aura — DAE macro
// args[0] = "on" or "off"
// args[1] = token ID
// args[args.length - 1] = Active Effect origin (last arg)

if (args[0] === "on") {
  const token = canvas.tokens.get(args[1]);
  if (!token) return;

  new Sequence()
    .effect()
      .file("jb2a.extras.tmfx.border.circle.inpulse.01.normal")
      .attachTo(token, { followRotation: false })
      .scaleToObject(2)
      .persist()
      .name(`bless_aura_${token.id}`)
      .origin(args[args.length - 1])
      .fadeIn(800)
      .fadeOut(800)
      .tint("#FFD700")
      .opacity(0.7)
      .belowTokens()
      .loopProperty("spriteContainer", "scale.x", {
        from: 0.95, to: 1.05,
        duration: 1500,
        pingPong: true,
        ease: "easeInOutSine"
      })
      .loopProperty("spriteContainer", "scale.y", {
        from: 0.95, to: 1.05,
        duration: 1500,
        pingPong: true,
        ease: "easeInOutSine"
      })
    .play();
}

if (args[0] === "off") {
  await Sequencer.EffectManager.endEffects({ origin: args[args.length - 1] });
}
```

Key differences from the prototype:
- **`.name(`bless_aura_${token.id}`)`** — unique name per token, so ending one doesn't kill all three.
- **`.origin(args[args.length - 1])`** — ties the effect to the Active Effect's UUID. The "off" block uses this origin to end exactly the right effect.
- The "off" block uses `origin` instead of `name` to clean up — this is more reliable because it's the same identifier DAE passes both times.

## Step 3: Wire up the Bless spell's Active Effect

Open the Bless spell on the Paladin's character sheet. Go to the **Activities** tab (or **Effects** tab depending on your DND5e version). You need an Active Effect that:

1. **Duration**: Set to match the spell — 1 minute (10 rounds), concentration. TimesUp will track this.
2. **Changes**: Add whatever mechanical bonuses Bless gives (if not already handled by Midi-QOL automation).
3. **Macro Execute**: Set the value to `Bless_Aura` — this is the name of the macro you just created in Step 2.

The "Macro Execute" field is what connects DAE to your Sequencer macro. When the Active Effect is applied to a target, DAE calls `Bless_Aura` with `args[0] = "on"`. When the Active Effect is removed (by TimesUp expiring it, by the caster dropping concentration, or by manual removal), DAE calls it again with `args[0] = "off"`.

### If Midi-QOL is handling the targeting

Midi-QOL should handle applying the Active Effect to all three targets when the spell is cast. The flow is:

1. Paladin casts Bless, targets three allies
2. Midi-QOL resolves the spell and applies the Bless Active Effect to each target
3. DAE detects the Active Effect and calls `Bless_Aura` with `"on"` for each target
4. Each target gets their own golden aura
5. When concentration drops or 1 minute passes, TimesUp removes the Active Effects
6. DAE calls `Bless_Aura` with `"off"` for each, ending each aura

All three auras appear independently and disappear independently. If one target gets Dispel Magic cast on them, only their aura goes away.

## Summary

| Piece | Role |
|---|---|
| Sequencer | Plays and manages the visual effect |
| JB2A | Provides the circle border asset |
| DAE | Connects the Active Effect lifecycle to the macro |
| TimesUp | Tracks spell duration and removes the Active Effect on expiry |
| Midi-QOL | Handles spell targeting and applies the Active Effect to each target |

Once this is set up, every future cast of Bless will automatically show golden auras on all targets, and they'll automatically clean up when the spell ends — no manual intervention needed.
