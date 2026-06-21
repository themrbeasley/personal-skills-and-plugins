# Sequencer Effect Section API

Complete reference for the `.effect()` section — the most-used part of Sequencer.

## Creating an effect

```js
new Sequence()
  .effect()
    // ... chain methods here
  .play()
```

`.effect()` starts a new effect section. Everything chained after it configures that effect until another section-breaking method is called (`.effect()`, `.sound()`, `.animation()`, `.wait()`, `.thenDo()`, `.canvasPan()`, `.crosshair()`).

---

## File and source

### `.file(path, options)`
The effect's visual source. Accepts:
- **String path**: `"jb2a.fireball.beam.orange"` (database path) or `"modules/jb2a_patreon/path/to/file.webm"` (file path)
- **Wildcard**: `"jb2a.explosion.01.*"` — randomly picks a matching entry
- **Array**: `["path1.webm", "path2.webm"]` — random selection
- **Object**: `{ "01": "path1.webm", "02": "path2.webm" }` — random selection

Options: `{ antialiasing: boolean }` for smoothing, `{ trimPath: boolean }` for stripping path components.

Database paths are strongly preferred over file paths — they survive asset reorganization.

### `.baseFolder(path)`
Prepends a folder path to all subsequent `.file()` calls. Convenience for working within one directory.

---

## Positioning

### `.atLocation(target, options)`
Places the effect at a location.
- `target`: Token, Tile, MeasuredTemplate, `{x, y}` coordinates, or a stored position string
- Options: `{ cacheLocation, randomOffset, offset: {x, y}, gridUnits, local }` 
- `randomOffset`: boolean or number. Offsets placement randomly.
- `gridUnits`: if true, offset values are in grid units, not pixels.

### `.attachTo(object, options)`
Attaches the effect to a placeable object — the effect moves with it.
- Options: `{ align, edge, bindVisibility, bindAlpha, bindElevation, followRotation, offset, randomOffset, gridUnits, local }`
- `align`: `"center"`, `"top-left"`, etc.
- `edge`: Attach to object edge
- `bindVisibility`: Effect hides when object hides (default true)
- `followRotation`: Effect rotates with object (default true)

### `.stretchTo(target, options)`
Stretches and rotates the effect from its position toward a target. The core method for projectile effects (A → B).
- Options: `{ attachTo, cacheLocation, randomOffset, offset, gridUnits, local, onlyX, tiling, requiresLineOfSight }`
- `tiling`: tiles the texture to fill the distance rather than stretching it
- `requiresLineOfSight`: won't render if line of sight is blocked

### `.rotateTowards(target, options)`
Rotates the effect to face a target without stretching.
- Options: `{ cacheLocation, randomOffset, offset, gridUnits, rotationOffset, attachTo }`

### `.moveTowards(target, options)`
Animates the effect moving toward a destination.
- Options: `{ ease, rotate }`
- Use `.moveSpeed(ms)` to set the speed.

### `.snapToGrid()`
Snaps the effect position to the nearest grid intersection.

### `.missed()` / `.missed(bool)`
Offsets the targeting slightly — effect lands near but not on the target. Useful for attack-miss visuals.

---

## Scale and size

### `.scale(value)` / `.scale(min, max)` / `.scale({x, y})`
Overall scale multiplier. Two numbers gives a random range. Object form allows non-uniform scaling.

### `.scaleToObject(multiplier, options)`
Scales the effect to match the target object's dimensions.
- Options: `{ uniform, considerTokenScale }`
- `uniform`: scales uniformly by the larger dimension

### `.size(value, options)` / `.size({width, height}, options)`
Sets size in pixels. Options: `{ gridUnits: true }` to use grid units instead.

### `.spriteScale(value)` / `.spriteScale({x, y})`
Scales the sprite independently from its container. The container stays the same size — the visual gets bigger or smaller within it.

### `.anchor({x, y})` / `.anchor(number)`
Sets the container anchor point. `0,0` = top-left, `0.5,0.5` = center, `1,1` = bottom-right.

### `.spriteAnchor({x, y})` / `.spriteAnchor(number)`
Anchor for the sprite within the container.

### `.spriteOffset(offset, options)`
Offsets the sprite relative to its container. Options: `{ gridUnits }`.

### `.center()`
Shorthand for `.anchor(0.5)`.

---

## Rotation and mirroring

### `.rotate(degrees)`
Adds a rotation offset to the effect.

### `.spriteRotation(degrees)`
Rotates the sprite independently from the container.

### `.randomRotation()` / `.randomSpriteRotation()`
Random orientation on play.

### `.zeroSpriteRotation(bool)`
Prevents the sprite from rotating when the container rotates. Useful for effects that should stay upright while the container tracks a target.

### `.mirrorX(bool)` / `.mirrorY(bool)`
Flips the effect horizontally or vertically.

### `.randomizeMirrorX(bool)` / `.randomizeMirrorY(bool)`
50/50 chance of flipping on each play.

---

## Opacity and transitions

### `.opacity(value)`
Static opacity. 0.0 = invisible, 1.0 = fully opaque.

### `.fadeIn(duration, options)` / `.fadeOut(duration, options)`
Smooth opacity transitions. Options: `{ ease, delay }`. See https://easings.net/ for easing names.

### `.scaleIn(scale, duration, options)` / `.scaleOut(scale, duration, options)`
Scale transitions at start/end.

### `.rotateIn(degrees, duration, options)` / `.rotateOut(degrees, duration, options)`
Rotation transitions at start/end.

---

## Timing

### `.duration(ms)`
Override the effect's natural duration. If longer than the source file, the effect loops.

### `.delay(ms)` / `.delay(min, max)`
Delay before the effect plays. Two values = random range.

### `.waitUntilFinished(offset)`
Pauses the sequence until this effect finishes. Optional offset — negative values continue the sequence early while the effect is still playing. This is the key method for chaining: "play effect A, wait, then play effect B."

### `.async()`
When combined with `.repeats()`, each repetition waits for the previous to finish before starting.

### `.startTime(ms)` / `.startTimePerc(decimal)`
Skip to a point in the source. Useful for extracting a specific moment from a longer animation.

### `.endTime(ms)` / `.endTimePerc(decimal)`
Cut the effect at a specific time.

### `.timeRange(start, end)`
Play only a time window.

### `.playbackRate(multiplier)`
Speed up (> 1.0) or slow down (< 1.0) the effect.

---

## Repetition

### `.repeats(count, delayMin, delayMax)`
Repeat the effect. Optional delay between repetitions (random range if two values).

### `.playIf(condition)`
Conditionally play. Accepts boolean or function returning boolean:
```js
.playIf(() => Math.random() < 0.5) // 50% chance
.playIf(workflow.hitTargets.size > 0) // only if something was hit
```

---

## Persistence

### `.persist()` / `.persist(bool, options)`
Makes the effect permanent on the canvas until manually ended. Critical for auras, buffs, ongoing effects.
- Options: `{ persistTokenPrototype }` — if true, applies to the token's prototype (every instance of that actor).
- **Always pair with `.name()`** so you can end the effect later.

### `.name(string)`
Names the effect. Required for managing persistent effects:
```js
Sequencer.EffectManager.endEffects({ name: "my_aura" })
```

### `.origin(uuid)`
Ties the effect to a document UUID. Useful with DAE — when the Active Effect is removed, you can end Sequencer effects by origin.

### `.tieToDocuments(doc | array)`
Automatically ends the effect when the linked document(s) are deleted.

### `.temporary()`
Prevents flag creation even if `.persist()` was called. Edge case — use when you want a persistent effect that doesn't survive page reload.

### `.extraEndDuration(ms)`
When a persistent effect is ended, play the fadeOut/scaleOut for this many extra milliseconds before removal.

---

## Rendering layers

### `.belowTokens(bool)`
Render beneath the token layer.

### `.belowTiles(bool)`
Render beneath the tile layer.

### `.aboveLighting(bool)`
Render above darkness and fog.

### `.aboveInterface(bool)`
Render above all Foundry UI.

### `.zIndex(number)`
Z-order within the same layer.

### `.sortLayer(number)`
Place the effect at a specific point in the canvas hierarchy.

---

## Visibility and distribution

### `.locally(bool)`
Play only on the current client. No network broadcast.

### `.forUsers(userId | array)`
Restrict to specific user(s).

### `.private(bool)`
Hide from the Effect Manager UI.

### `.mask(object | array)`
Restrict effect visibility to within the bounds of specified objects.

### `.xray(bool)`
Ignore vision-based masking.

---

## Animations and property loops

### `.animateProperty(target, property, options)`
Animate a property over time.
- `target`: `"sprite"`, `"spriteContainer"`, or `"effect"`
- `property`: dot-notation property path (e.g., `"rotation"`, `"position.x"`, `"scale.x"`, `"alpha"`)
- Options: `{ from, to, duration, delay, ease, fromEnd, gridUnits, pingPong }`

### `.loopProperty(target, property, options)`
Continuously loop an animation:
- Options: `{ from, to, values, duration, delay, ease, pingPong, gridUnits }`
- `values`: array of keyframes to interpolate between (alternative to from/to)
- `pingPong`: bounce between from and to instead of snapping back

### `.loopOptions(options)`
Control loop behavior: `{ loopDelay, maxLoops, endOnLastLoop }`

---

## Visual effects

### `.filter(type, options)`
Apply PIXI filters. Common types:
- `"ColorMatrix"` with options like `{ brightness, contrast, saturate, hue }`
- `"Glow"` with `{ distance, outerStrength, innerStrength, color }`
- `"Blur"` with `{ strength, blurX, blurY, quality }`

### `.tint(color)`
Apply a color tint. Accepts hex string `"#FF0000"` or decimal `0xFF0000`.

### `.text(string, options)`
Render text on the effect using PixiJS TextStyle properties.

### `.shape(type, options)`
Draw geometric shapes: `"polygon"`, `"rectangle"`, `"circle"`, `"ellipse"`, `"roundedRect"`.

---

## Screen space

### `.screenSpace()`
Position in screen/viewport space instead of world space. The effect stays fixed on screen regardless of canvas pan/zoom.

### `.screenSpaceAboveUI(bool)`
Render above all Foundry interface elements.

### `.screenSpacePosition({x, y})`
Offset from the screen-space anchor.

### `.screenSpaceAnchor({x, y})` / `.screenSpaceAnchor(number)`
Anchor to screen edges. `0` = left/top, `0.5` = center, `1` = right/bottom.

### `.screenSpaceScale({x, y, fitX, fitY, ratioX, ratioY})`
Scale relative to screen dimensions.

---

## Advanced

### `.copySprite(object, options)`
Clone the appearance of a target object.

### `.preset(name)`
Apply a registered preset (see database-and-management.md).

### `.setMustache(object)`
Enable Handlebars template substitution in file paths:
```js
.file("jb2a.{{type}}.{{color}}")
.setMustache({ type: "fireball", color: "orange" })
```

### `.addOverride(asyncFunction)`
Intercept and modify effect data before playback. This is the escape hatch for customization beyond the standard API:
```js
.addOverride(async (effect, data) => {
  data.scale = data.scale * 1.5;
  return data;
})
```

### `.syncGroup(string)`
Synchronize start times across effects sharing the same group name.

### `.template(options)`
Configure grid size, start/end points for range-based effects.

### `.isometric(options)`
Integration with the Isometric module for perspective rendering.

## Audio on effects

Effects can have audio. These are separate from `.sound()` sections.

### `.volume(value)`
0.0 to 1.0. Defaults to 0.0 for effects (silent).

### `.fadeInAudio(duration, options)` / `.fadeOutAudio(duration, options)`
Audio transitions. Options: `{ ease, delay }`.
