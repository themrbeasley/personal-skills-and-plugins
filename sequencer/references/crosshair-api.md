# Crosshair / Interactive Targeting API

The crosshair system lets users pick a location on the canvas before an effect plays. Essential for targeted spells, area effects, and anything that asks "where do you want to put this?"

## Basic usage

```js
const location = await Sequencer.Crosshair.show();
// location is a placement object with x, y, and other properties

new Sequence()
  .effect()
    .file("jb2a.explosion.01.orange")
    .atLocation(location)
  .play();
```

The call returns a Promise that resolves when the user confirms placement (left-click) and rejects/returns null on cancel (right-click or Escape).

## Within a Sequence

You can also use `.crosshair()` as a section within a Sequence:

```js
new Sequence()
  .crosshair()
    // crosshair configuration methods
  .effect()
    .atLocation("crosshair") // references the crosshair result
    .file("jb2a.explosion.01.orange")
  .play()
```

---

## `Sequencer.Crosshair.show(config, callbacks)`

### Config object

**Visual properties:**
- `t` — Template type. See `CONST.MEASURED_TEMPLATE_TYPES`. Defaults to CIRCLE.
- `distance` — Radius in grid units. Defaults to half canvas grid size.
- `width` — Template width. Defaults to canvas grid size.
- `angle` — Starting rotation angle.
- `direction` — Starting direction.
- `borderAlpha` — Border transparency (0–1, default 0.75).
- `borderColor` — Border color string.
- `fillColor` — Fill color string.
- `fillAlpha` — Fill transparency (0–1, default 0.5).
- `texture` — Interior texture path.
- `textureAlpha` — Texture transparency (0–1, default 0.5).
- `textureScale` — Texture scaling relative to template (default 1).

**Icon:**
- `icon.texture` — Icon texture path.
- `icon.borderVisible` — Whether the icon has a border.

**Grid and snapping:**
- `gridHighlight` — Toggle grid cell highlighting.
- `snap.position` — Snap mode: `VERTEX` or `CENTER`.
- `snap.resolution` — Sub-grid precision (default 1).
- `snap.direction` — Direction snapping in degrees.
- `lockManualRotation` — Prevent user rotation.

**Size constraints:**
- `distanceMin` — Minimum crosshair size.
- `distanceMax` — Maximum crosshair size.
- `lockDrag` — Prevent drag-to-resize.

**Label:**
- `label.text` — Display text.
- `label.dx` — Horizontal offset in pixels.
- `label.dy` — Vertical offset in pixels.

**Location and range:**
- `location.obj` — Token/object to anchor range calculations to.
- `location.limitMinRange` — Minimum distance from anchor (grid units).
- `location.limitMaxRange` — Maximum distance from anchor (grid units).
- `location.showRange` — Show distance indicator.
- `location.lockToEdge` — Snap crosshair to token edge.
- `location.lockToEdgeDirection` — Align along token normal when locked to edge.
- `location.offset` — `{x, y}` pixel offset from anchor.
- `location.wallBehavior` — Placement restrictions (see constants below).
- `location.displayRangePoly` — Render the range polygon visualization.
- `location.rangePolyFillColor` / `rangePolyLineColor` — Polygon colors.
- `location.rangePolyFillAlpha` / `rangePolyLineAlpha` — Polygon transparency.

---

### Callbacks object

Use `Sequencer.Crosshair.CALLBACKS` constants as keys:

| Constant | When it fires |
|---|---|
| `SHOW` | Crosshair first appears |
| `MOUSE_MOVE` | Every mouse movement |
| `MOVE` | Crosshair position updates |
| `COLLIDE` | Crosshair hits a wall/collision boundary |
| `STOP_COLLIDING` | Collision clears |
| `INVALID_PLACEMENT` | User tries to place in an invalid location |
| `PLACED` | Before placement is confirmed. Return `false` to cancel. |
| `CANCEL` | Before user cancellation. Return `false` to prevent cancel. |

Each callback receives a `crosshair` object with:
- `crosshair.updateCrosshair(config)` — Modify the crosshair configuration live
- `crosshair.isValid` — Boolean, whether current placement is valid
- `crosshair.range` — Current distance from location object in grid units

---

### Wall behavior constants

`Sequencer.Crosshair.PLACEMENT_RESTRICTIONS`:

| Constant | Behavior |
|---|---|
| `ANYWHERE` | No restrictions |
| `LINE_OF_SIGHT` | Requires sight line from the location object |
| `NO_COLLIDABLES` | No walls of any kind between location and crosshair |

---

## Examples

**Range-limited spell targeting:**
```js
const location = await Sequencer.Crosshair.show({
  location: {
    obj: token,
    limitMaxRange: 60,
    showRange: true,
    wallBehavior: Sequencer.Crosshair.PLACEMENT_RESTRICTIONS.LINE_OF_SIGHT
  },
  gridHighlight: true,
  snap: { position: "CENTER" }
});

if (!location) return; // user cancelled

new Sequence()
  .effect()
    .file("jb2a.fireball.beam.orange")
    .atLocation(token)
    .stretchTo(location)
    .waitUntilFinished(-500)
  .effect()
    .file("jb2a.explosion.01.orange")
    .atLocation(location)
    .scale(1.5)
  .play();
```

**Dynamic icon on wall collision:**
```js
const location = await Sequencer.Crosshair.show({
  location: {
    obj: token,
    limitMaxRange: 30,
    wallBehavior: Sequencer.Crosshair.PLACEMENT_RESTRICTIONS.NO_COLLIDABLES
  },
  icon: { texture: "icons/svg/target.svg" }
}, {
  [Sequencer.Crosshair.CALLBACKS.COLLIDE]: (crosshair) => {
    crosshair.updateCrosshair({ "icon.texture": "icons/svg/cancel.svg" });
  },
  [Sequencer.Crosshair.CALLBACKS.STOP_COLLIDING]: (crosshair) => {
    crosshair.updateCrosshair({ "icon.texture": "icons/svg/target.svg" });
  }
});
```
