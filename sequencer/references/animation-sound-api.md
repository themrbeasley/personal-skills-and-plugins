# Animation and Sound Section APIs

## Animation Section

The `.animation()` section operates on existing scene objects (tokens, tiles) — it moves, rotates, fades, and teleports them. This is different from `.effect()`, which creates new visual elements.

### Starting an animation

```js
new Sequence()
  .animation()
    .on(token) // required — the target token or tile
    // ... chain methods
  .play()
```

### `.on(target)`
**Required.** The token or tile to animate. Accepts a Token, Tile, or their document/ID.

### Movement

#### `.moveTowards(target, options)`
Animate the object toward a location over the animation's duration.
- `target`: Token, Tile, or `{x, y}` coordinates
- Options: `{ ease: "linear", delay: 0, relativeToCenter: false }`

#### `.moveSpeed(ms)`
Set movement speed when using `.moveTowards()`. Alternative to `.duration()` — the animation takes as long as needed at this speed.

#### `.teleportTo(target, options)`
Instantly relocate the object. No animation — it just appears at the new position.
- Options: `{ delay, relativeToCenter }`

#### `.offset({x, y})`
Offset the destination of `.moveTowards()` or `.teleportTo()`.

#### `.closestSquare(bool)`
Target the nearest non-intersecting grid square.

#### `.snapToGrid(bool)`
Align the final position to the grid.

### Rotation

#### `.rotateTowards(target, options)`
Rotate the object to face a target.
- Options: `{ duration, ease, delay, rotationOffset, towardsCenter, cacheLocation }`

#### `.rotate(degrees)`
Add a flat rotation offset.

#### `.rotateIn(degrees, duration, options)` / `.rotateOut(degrees, duration, options)`
Rotation transitions at start/end of the animation.

### Opacity

#### `.opacity(value)`
Set the object's opacity (0.0–1.0).

#### `.fadeIn(duration, options)` / `.fadeOut(duration, options)`
Fade transitions. Options: `{ ease, delay }`.

### Visibility

#### `.show(bool)` / `.hide(bool)`
Show or hide the object.

### Styling

#### `.tint(color)`
Apply a color tint. Hex string or decimal.

### Timing

#### `.duration(ms)`
Set the animation length. Note: not supported for token movement in some contexts — use `.moveSpeed()` instead.

#### `.delay(ms)` / `.delay(min, max)`
Delay before the animation starts.

#### `.waitUntilFinished(offset)` / `.waitUntilFinished(min, max)`
Pause the sequence until this animation finishes. Negative offset = continue early.

#### `.async()`
Each repetition completes before the next starts.

#### `.repeats(count, delayMin, delayMax)`
Repeat with optional delays.

#### `.playIf(condition)`
Conditional execution.

### Presets

#### `.preset(name)`
Apply a registered preset.

---

## Sound Section

The `.sound()` section plays audio. Supports spatial positioning, wall occlusion, and channel routing.

### Starting a sound

```js
new Sequence()
  .sound()
    .file("path/to/audio.wav")
    // ... chain methods
  .play()
```

### File

#### `.file(path)`
The audio file. Accepts:
- String path: `"Audio/Effects/explosion.wav"`
- Database path: `"jb2a.explosion.sound"`
- Wildcard: `"Audio/Effects/Magic/Ice/*.wav"` (random selection)
- Array: random selection from list

#### `.baseFolder(path)`
Prepend a base directory to file paths.

### Playback

#### `.volume(value)`
0.0–1.0. Defaults to 0.8. Affected by the client's Foundry volume settings.

#### `.duration(ms)`
Set playback duration. Loops if longer than the source.

#### `.startTime(ms)` / `.startTimePerc(decimal)`
Skip ahead.

#### `.endTime(ms)` / `.endTimePerc(decimal)`
Set an end point.

#### `.timeRange(start, end)`
Play a specific time window.

### Audio effects

#### `.fadeInAudio(duration, options)` / `.fadeOutAudio(duration, options)`
Audio transitions. Options: `{ ease, delay }`.

#### `.baseEffect(options)`
Apply effects during normal hearing: `{ type: "lowpass" | "highpass" | "reverb", intensity: number }`. Requires `.atLocation()`.

#### `.muffledEffect(options)`
Apply effects when sound passes through walls. Same options. Requires `.atLocation()` and `.constrainedByWalls(false)`.

### Spatial audio

#### `.atLocation(target, options)`
Anchor the sound to a location. Same targeting as effect `.atLocation()`.

#### `.attachTo(object, options)`
Attach to a moving object. Options: `{ bindVisibility, bindElevation }`.

#### `.radius(units)`
Limit audibility to a distance in scene units. Requires `.atLocation()`.

#### `.constrainedByWalls(bool)`
Whether walls block the sound entirely. Default false. Requires `.atLocation()`.

#### `.distanceEasing(bool)`
Ease volume by distance from origin. Default true. Requires `.atLocation()`.

#### `.alwaysForGMs(bool)`
GMs hear at full volume regardless of distance. Default false.

### Distribution

#### `.locally(bool)`
Play only on the local client.

#### `.forUsers(userId | array)`
Restrict to specific users.

#### `.audioChannel(string)`
Route to a specific channel: `"music"`, `"environment"`, or `"interface"` (default).

### Persistence

#### `.persist(bool, options)`
Make the sound permanent on canvas. Options: `{ persistTokenPrototype }`.

#### `.loopOptions(options)`
Control looping: `{ loopDelay, maxLoops, endOnLastLoop }`.

### Timing

#### `.delay(ms)` / `.delay(min, max)`
Delay before playback.

#### `.waitUntilFinished(delay, randomDelay)`
Pause sequence until sound finishes.

#### `.async()`
Each repetition finishes before the next starts.

#### `.repeats(count, delayMin, delayMax)`
Repeat with delays.

#### `.playIf(condition)`
Conditional execution.

### Advanced

#### `.setMustache(object)`
Template substitution in file paths.

#### `.addOverride(asyncFunction)`
Custom logic before playback.

#### `.preset(name)`
Apply a registered preset.

---

## Scrolling Text Section

Displays floating text on the canvas (damage numbers, status text, etc.).

### Basic usage

```js
new Sequence()
  .scrollingText(token, "My Text")
  .play()
```

The first argument is the target, the second is the text content.

### `.text(string, styleObject)`
Set content and PixiJS text style properties.

### `.anchor(string | number)`
Anchor point: `"CENTER"`, `"BOTTOM"`, `"TOP"`, `"LEFT"`, `"RIGHT"`.

### `.direction(string | number)`
Movement direction. Same values as anchor.

### `.jitter(number)`
Random positional offset (0–1 range).

### `.atLocation(target, options)`
Position at a token, template, or coordinates.

### `.duration(ms)`
Animation length.

### Standard timing methods
`.delay()`, `.waitUntilFinished()`, `.async()`, `.repeats()`, `.playIf()`, `.locally()`, `.forUsers()` — all work the same as other sections.
