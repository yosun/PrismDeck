# API reference

All packages are ES modules with TypeScript declarations. Import the stylesheet
once when using DOM or React:

```ts
import '@prismdeck/dom/style.css';
```

## Core

```ts
import {
  createDeckController,
  getPrismGeometry,
  visibleIndices,
  densityForZoom,
  prismSpacing,
  clamp,
} from '@prismdeck/core';
```

Core does not require a DOM, React, Three.js, or XR.

### `createDeckController<T>(options)`

| Option | Type / behavior |
| --- | --- |
| `items` | Required `readonly T[]` |
| `getKey` | Optional `(item: T) => string \| number` |
| `adapter` | Optional `{ getKey, getPosition?, getLabel? }` |
| `initialFocus` | Initial index, rounded and clamped; defaults to `0` |
| `initialZoom` | Initial zoom in `0…1`; defaults to `0` |
| `initialView` | Optional signed view controls `{ yaw?: number, pitch?: number }`; defaults to `{ yaw: 0, pitch: 0 }` |
| `onFocus` | `(item: T, orderedIndex: number) => void` |
| `onSelect` | `(item: T, orderedIndex: number) => void` |
| `onViewChange` | `(view: ViewAngle) => void`; observes camera angle changes |
| `axis` | Optional `{ label?: string, unit?: string }` metadata |

Keys must be unique strings or finite numbers. Key resolution uses `getKey`, then
`adapter.getKey`, then a default: a primitive string/number item, its `id`, its
`key`, or its input index. Supply explicit stable keys for collections that change.

`adapter.getPosition(item, inputIndex)` supplies finite numerical coordinates and
enables stable sorting. Equal positions retain input order. Without this adapter,
input order is preserved and the coordinate is the input index.
`adapter.getLabel(item, orderedIndex)` supplies the accessible label; the default
is the key converted to text.

### Controller

| Method | Behavior |
| --- | --- |
| `getSnapshot()` | Returns the current immutable snapshot |
| `getItems()` | Returns the immutable array in view order |
| `getPositions()` | Returns immutable coordinates in view order |
| `getKey(index)` | Returns the key, or `undefined` outside the collection |
| `getLabel(index)` | Returns a label, or `''` outside the collection |
| `focus(index)` | Rounds/clamps index, changes focus, calls `onFocus` when focus changes |
| `focusKey(key)` | Focuses an existing key; otherwise does nothing |
| `move(delta)` | Moves relative to the focused index |
| `select(index?)` | Focuses and selects a pane; defaults to current focus |
| `dismiss()` | Clears selection |
| `setZoom(amount)` | Clamps zoom to `0…1`; ignores non-finite values |
| `setView({ yaw?, pitch? })` | Sets signed view controls; clamps yaw to `-60…60`, pitch to `-45…45`; omitted components retain their current value; ignores non-finite input |
| `resetView()` | Restores `{ yaw: 0, pitch: 0 }` |
| `setItems(items)` | Replaces items through `configure` |
| `configure(partialOptions)` | Updates content, adapters, metadata, or callbacks |
| `subscribe(listener)` | Registers `() => void`; returns an unsubscribe function |
| `dispose()` | Stops updates and releases subscriptions |

Snapshot fields are `{ focus, zoom, view, selectedKey, count, revision }`. `view`
is an immutable `{ yaw, pitch }` pair of signed view controls centered on the
default camera at `0`. They are not absolute Euler angles. The prism maps the
full control ranges into safe front-facing azimuth and elevation at the current
zoom, so all slider travel remains useful. An empty deck has `focus: -1`, `count: 0`, and `selectedKey: null`. `zoom: 0` is the close view;
`zoom: 1` is the compact overview. `revision` increases when state is published.
Subscribers read the current state with `getSnapshot()`.

Focus navigates. Selection invokes an application action. Calling `select` on an
already selected pane still calls `onSelect`, so an application can reopen its
detail view. `dismiss` clears selection without changing focus. Initial focus
does not trigger `onFocus`; read `getSnapshot()` to initialize custom controls.

Collection updates retain focus by key when possible, otherwise clamp the old
index. Selection is retained only if its key still exists. Keys and positions are
validated before configuration is committed: an invalid update throws while
preserving the previous controller state. `initialFocus`, `initialZoom`, and
`initialView` apply at creation; use `setView` or `resetView` for later camera
changes. Camera angle is independent of collection focus,
selection, zoom, and presentation presets.

### Geometry

`getPrismGeometry({ count, focus, zoom, view?, width, height, paneWidth?, paneHeight?, positions? })`
returns:

| Field | Meaning |
| --- | --- |
| `positionAt(index)` | `[x, y, z]` center of a pane; accepts fractional indices |
| `paneWidth`, `paneHeight` | Cross-section dimensions; default approximately `533.33 × 300` |
| `spacing` | Distance between normalized adjacent coordinates |
| `length` | Extent along the ordering axis |
| `camera` | `{ position, direction, right, up, focalLength }` |

Viewport width and height use one consistent unit, normally CSS pixels.
The cross-section lies in YZ, and panes are ordered along X. Explicit `positions`
must be sorted, finite, and match `count`; gaps are normalized by the smallest
positive gap. Geometry does not allocate browser or renderer resources.
The optional `view` applies the controller's camera angle to the geometry. Feed
the same geometry to panes and guide lines so their corners remain aligned.

`getPrismViewAngles(zoom, view?)` returns `{ azimuth, elevation }` in radians for a
custom renderer that owns its camera placement. It uses exactly the same signed
view mapping as `getPrismGeometry`, so applications can share PrismDeck's angle
controls without replacing their own content or selection animations. Normalize
view state through the controller; use its snapshot's `view` and current zoom.

`visibleIndices(count, focus, maxVisible = 40, zoom = 0)` returns bounded ordered
indices. Close views use a contiguous focus window; overviews sample the full
collection while retaining focus and its nearest neighbors.
`densityForZoom(zoom)` returns the spacing compression factor.
`prismSpacing(width, azimuth?)` computes close-view spacing; azimuth is radians.
`clamp(value, min = 0, max = 1)` clamps a number.

Exported types include `PrismKey`, `PrismVector3`, `PrismAxis`, `PrismAdapter<T>`,
`PrismSnapshot`, `DeckControllerOptions<T>`, `DeckController<T>`,
`PrismGeometryOptions`, `PrismCamera`, `PrismGeometry`, `PrismViewAngles`, and `ViewAngle`. Naming aliases include
`Axis`, `DeckSnapshot`, `DeckOptions<T>`, `PrismDeckSnapshot`, and
`PrismDeckController<T>`.

## DOM

```ts
import { createPrismDeck, PRISMDECK_PRESETS, resolvePresentationOptions } from '@prismdeck/dom';
```

### `createPrismDeck<T>(mount, options)`

`mount` is a sized `HTMLElement`. Options include all core options plus:

| Option | Behavior |
| --- | --- |
| `renderPane(item, index)` | Returns a `Node`, plain text string, or `{ element: Node, dispose?: () => void }` |
| `variant` | `'A'` (default), `'B'`, or `'C'`; selects presentation defaults |
| `layout` | `'prism'` for all presets; `'wallet'` remains an explicit compatibility layout |
| `theme` | `'system'` (default), `'light'` (Day), or `'dark'` (Night); independent of presentation presets |
| `selectionMode` | `'slide-out'`, `'modal'`, or `'none'`; overrides the preset |
| `prismLines` | Boolean override for the perspective rectangular prism outline; applies to prism layout |
| `timelineRails` | Boolean override for rails along the ordered axis; applies to prism layout |
| `planeGrid` | Extend a grid across the selected pane's plane in slide-out selection; Version C enables it |
| `paneDrag` | `'free'`, `'horizontal'`, `'vertical'`, or `'none'`; allowed drag directions in the selected pane's plane |
| `snapToGrid` | Snap a released pane to the grid; independent of grid visibility |
| `gridSize` | Grid spacing in pane world units; finite values in `[8, 1024]`, default `80` |
| `onPaneMove(item, index, offset)` | Committed user-placement callback, with `{ x, y }` world-coordinate offset in the pane plane |
| `transitionDuration` | Approximate slide-out settling time in milliseconds; finite and nonnegative, default `700`; `0` is instant |
| `renderSelection(item, index)` | Optional detail content, with the same return types as `renderPane`; otherwise the selected pane's content is reused |
| `onActivate(item, index)` | Optional second activation of the already selected pane |
| `maxVisible` | Maximum preview panes; defaults to `40` |
| `controls` | Built-in keyboard-accessible toolbar; defaults to `true` |
| `cameraControls` | Built-in **View angle** panel with sliders, drag mode, and reset; defaults to `true` |
| `view` | Optional signed `{ yaw?, pitch? }` controls; applies partial view state through creation or `update` |
| `label` | Accessible widget label; defaults to `'PrismDeck'` |
| `className` | Additional root CSS class |
| `onDismiss()` | Optional callback when the built-in selection presentation closes |

### Presentation presets and overrides

| Version | `layout` | `selectionMode` | `prismLines` | `timelineRails` |
| --- | --- | --- | --- | --- |
| `'A'` (default) | `'prism'` | `'slide-out'` | `true` | `true` |
| `'B'` | `'prism'` | `'modal'` | `false` | `false` |
| `'C'` | `'prism'` | `'slide-out'` | `true` | `true` |

| Preset | `planeGrid` | `paneDrag` | `snapToGrid` | `gridSize` |
| --- | --- | --- | --- | --- |
| A / B | `false` | `'none'` | `true` | `80` |
| C | `true` | `'free'` | `true` | `80` |

Snapping stays inert while pane dragging is disabled. Enable dragging on A or B
without changing the other preset features.

`PRISMDECK_PRESETS` exports the immutable preset values.
`resolvePresentationOptions(options)` returns the resolved variant, layout, mode,
line options, pane-workspace options, and transition duration, and validates these
presentation options.
Reduced motion always takes precedence over `transitionDuration`.

Every explicit option takes precedence over its preset independently. Change a
preset or individual options through `update`; pass `undefined` to clear an
override and use the current preset again. These options belong to the DOM and
React presentation layers; the headless controller has no UI version.
Prism lines and rails are hidden in wallet layout even when their options are
enabled. Returning to prism layout restores their configured values.

```ts
const deck = createPrismDeck(mount, {
  items, getKey, renderPane,
  variant: 'B',
  timelineRails: true, // Modal selection with rails; prism lines stay hidden.
});
deck.update({ selectionMode: 'slide-out' });
deck.update({ selectionMode: undefined }); // Return to Version B's modal.
deck.update({ variant: 'C' }); // Prism with a draggable snap-grid workspace.
deck.update({ planeGrid: false, snapToGrid: false }); // Drag freely without a visible grid or snapping.
```

`'slide-out'` moves the selected pane perpendicular to its surface into a separate
presentation layer while the viewing camera turns to face it. The archive stays
visible as a compact prism. `'modal'` presents the selected pane in a native dialog.
Both reuse the mounted pane by default. Escape dismisses either view. **Back to
deck** dismisses slide-out selection; the modal close button or backdrop also dismisses it. Closing restores the
pane to the deck and keyboard focus to browsing.

Version C enables `planeGrid: true`, `paneDrag: 'free'`, `snapToGrid: true`,
and `gridSize: 80`. Its grid extends the selected pane's own plane. Dragging
projects pointer movement into that plane, so diagonal, leftward, and vertical
motion work at oblique viewing angles. The ordered prism stays visible. The
library does not select automatically; the examples open C's focused pane on
initial load and when choosing the preset.

`paneDrag: 'horizontal'` constrains movement to the pane's horizontal axis;
`'vertical'` constrains it to the vertical axis; `'none'` disables plane dragging.
These are local plane axes, not screen directions. Snapping happens on release,
uses the nearest grid intersection, and can be enabled without rendering the
grid. The options apply to slide-out selection; modal and app-defined selection
retain their own presentation. Shift-drag, right-drag, and **Rotate** retain
camera control.

With a selected workspace and enabled pane dragging, Arrow keys move the pane by
`gridSize` along its local axes. Shift + Arrow keys move four grid spacings;
**Home** or **Center pane** resets its offset. Axis constraints apply to keyboard
motion. Escape dismisses selection and restores ordinary sequence navigation.

Workspace offsets are stored by stable pane key. Dismissing selection restores
the pane's original ordered location in the prism; reopening restores its
workspace offset. Focus, density, camera, and theme changes preserve offsets.
Removing an item or disposing the widget releases its offset. `onPaneMove` fires
once after a committed user placement (drag, keyboard, or **Center pane**);
programmatic changes do not fire it.

The explicit `layout: 'wallet'` option remains for compatibility; none of the
current presets use it. It adds no rendering or image dependency.

When an application button outside the widget opens a slide-out, focus
`deck.element` with `{ preventScroll: true }` so the widget receives keyboard
navigation and Escape. Programmatic selection itself preserves application focus.

`'none'` supplies no selection presentation. The controller still records
`selectedKey` and invokes callbacks, allowing an application to supply its own
view. In the widget, initial selection calls `onSelect`; repeating activation of
the selected pane calls optional `onActivate`. The headless controller's
`select()` semantics remain as documented above.

Use `renderSelection` for a different detail body, such as a higher-resolution
image. It is called lazily for one selected item and disposed when that selection
changes or closes. Its content is separately bounded to one additional resource;
`maxVisible` remains the preview budget. Content renderers never load Three.js or
XR automatically.

Without a renderer, items are converted to plain text. Strings are never inserted
as HTML. Content is created lazily and disposed when it leaves the visible window
or the widget is disposed. Put independent controls inside panes normally; their
events are preserved. Add `data-prismdeck-interactive` to custom interactive
regions that need to receive their own input.

The returned `PrismDeckInstance<T>` exposes:

- `element`: the widget root.
- `controller`: the headless controller.
- `update(partialOptions)`: updates the existing widget and reconciles its content.
- `getPaneOffset(key: PrismKey): PaneOffset`: returns a fresh `{ x, y }` object,
  defaulting to zero. `PrismKey` is a stable string or number key, not an ordered index.
- `setPaneOffset(key: PrismKey, offset: PaneOffset): void`: stores exact finite
  world-coordinate offsets. Unknown keys and nonfinite values are ignored. It
  neither snaps coordinates nor invokes `onPaneMove`.
- `dispose()`: releases content, offsets, listeners, observer, pending frames, and controller.

Invalid key/position updates preserve the previous widget. A pane's application
cleanup should release resources it owns; the library does not revoke your
object URLs or cancel your subscriptions automatically.

### Camera angle

Every presentation preset uses the same controller camera state. Open **View
angle** (**Angle** on small screens) for the horizontal (yaw) and vertical (pitch)
sliders, a **Rotate**
drag toggle, and **Reset view**. The panel's sliders support keyboard and touch.
Enable **Rotate** for one-finger rotation; turn it off for ordinary sequence
browsing. Shift-drag or right-drag rotates directly with a mouse. Alt + Arrow
keys adjust the angle; `0` restores the default view. Wheel and pinch continue to
control density.

```ts
const deck = createPrismDeck(mount, {
  items, getKey, renderPane,
  initialView: { yaw: 15, pitch: -5 },
  onViewChange: ({ yaw, pitch }) => updateAngleDisplay(yaw, pitch),
});
deck.controller.setView({ pitch: 10 }); // Keep the current yaw.
deck.update({ view: { yaw: -15 } });
deck.controller.resetView();
deck.update({ cameraControls: false });
```

`cameraControls: false` hides the built-in camera controls and disables angle
gestures and keyboard shortcuts. The controller remains available for custom UI. `controls` configures the navigation toolbar
separately. Neither option changes the current angle. `initialView` applies only
at creation. Use `view`, `controller.setView`, or `controller.resetView` later.

Focus, zoom, layout changes, and switching Versions A/B/C retain the current
angle. Version A's prism boundaries and rails use the same camera as its panes;
Version C's grid and dragged pane use the same projected plane. Selection presents a
readable pane while retaining the collection's angle for the return to browsing.
The camera adds no renderer dependencies or image resources.

### Theme

`theme: 'system'` follows the operating system's color preference, including live
changes. `'light'` gives the widget white Day surfaces; `'dark'` gives it dark
Night surfaces. All default colors are neutral. Use `deck.update({ theme: 'dark' })`
to change the mode without rebuilding the widget. The resolved mode is exposed as
`data-prismdeck-theme="light"` or `"dark"` on its root. The widget never stores a
preference or changes the application page's theme.

Optional CSS variables override individual colors:

| Variable | Controls |
| --- | --- |
| `--prismdeck-background` | Main background and selection surfaces |
| `--prismdeck-color` | Text |
| `--prismdeck-accent` | Focus and selection outlines, input controls |
| `--prismdeck-border` | Pane, control, and selection borders |
| `--prismdeck-pane-background` | Empty pane surface |
| `--prismdeck-button-background` | Navigation buttons |
| `--prismdeck-guide-color` | Perspective boundary lines |
| `--prismdeck-rail-color` | Axis rails and ticks |

Use opaque background colors when overriding `--prismdeck-background`, because
selection dialogs use that surface too. Custom pane content retains its own
colors. The demo's Day/Night control and persistence are application code in
[the shared theme helper](../examples/shared/theme.ts).

Size the mount with CSS. The widget supports reduced motion,
arrow keys, Home/End, PageUp/PageDown, plus/minus, Enter, Escape, pointer drag,
wheel density changes, and touch pinch.

The default DOM entry point does not import Three.js or XR.

## React

```ts
import { PrismDeck, Pane, usePrismDeck } from '@prismdeck/react';
```

`PrismDeck<T>` accepts the DOM options with `renderPane(item, index): ReactNode`
and optional `renderSelection(item, index): ReactNode`. This includes `variant`,
`layout`, `selectionMode`, `prismLines`, `timelineRails`, `planeGrid`, `paneDrag`,
`snapToGrid`, `gridSize`, `onPaneMove`, `theme`, `cameraControls`,
`view`, `onViewChange`, and `onActivate`. These props can change without remounting
the widget. `initialView`, like `initialFocus` and `initialZoom`, sets the initial
state only.
It also accepts `style`, `id`, and `onReady(instance)`. `className` and `style`
apply to the React mount. React content is portaled into the bounded visible
panes and, when supplied, the single selection view; offscreen content unmounts,
so put persistent application state outside a
pane component when needed.

`Pane` is an optional full-size content wrapper accepting ordinary div attributes.
It does not create another deck.

`usePrismDeck(controller)` subscribes through React's external-store API and
returns the current snapshot. It returns `null` when no controller is provided or
when server-rendering. Get a live controller through `onReady` to drive custom
React controls or another renderer.

React also exports `PRISMDECK_PRESETS` and the presentation option types:
`PrismDeckVariant`, `PrismDeckLayout`, `PrismDeckSelectionMode`, `PrismDeckPresentationOptions`, and
`PrismDeckTheme`.
The React entry point does not import Three.js or XR.

## Optional Three.js renderer

```ts
const { createThreePrismDeck } = await import('@prismdeck/three');
```

### `createThreePrismDeck<T>(mount, options)`

| Option | Behavior |
| --- | --- |
| `controller` | Required shared `DeckController<T>` |
| `getImage(item, index)` | Required image URL or `{ url, width?, height? }` |
| `maxVisible` | Bounded image/texture budget; defaults to `40` |
| `getPosition(item, index)` | Optional geometry coordinate override; must be sorted in controller order |
| `paneWidth`, `paneHeight` | Optional cross-section dimensions |
| `physicalWidth` | Physical pane width in meters for XR |
| `pixelRatio` | Optional rendering pixel ratio, bounded to `0.5…2` |
| `label` | Accessible canvas label |
| `crossOrigin` | Image loader setting; defaults to `'anonymous'` |
| `rendererOptions` | Additional Three.js WebGL renderer options, excluding `canvas` |
| `onError(error)` | Optional image loading/error callback |

Returns `{ renderer, scene, camera, resize, dispose }`. Disposal releases GPU
resources and ends this renderer's immersive session, if any; the shared
controller remains application-owned. Desktop frames are demand-driven. XR uses
continuous frames while presenting.

This renderer consumes images. It does not automatically rasterize arbitrary DOM
or React content. Provide a thumbnail, page rendering, or other image adapter.

## Optional XR helpers

```ts
const { isXRSupported, enterXR } = await import('@prismdeck/three/xr');
```

- `isXRSupported(mode = 'immersive-vr'): Promise<boolean>` checks support and
  returns false when unavailable. It does not start a session.
- `enterXR(renderer, mode = 'immersive-vr', init = {}): Promise<XRSession>` starts
  a session from a user gesture or returns the renderer's existing session.
- `ImmersiveMode` is `'immersive-vr' | 'immersive-ar'`.

None of these helpers runs on default DOM or React startup. Use native
`navigator.xr?.isSessionSupported(mode)` before an automatic optional import, or
load after explicit user opt-in. Call `enterXR` directly in an action handler
after the module is ready so browser user activation is retained. Immersive
sessions require browser support, a secure context, and any browser permission.

The optional `@prismdeck/dom/xr` subpath also exports
`loadSpatialRenderer({ optIn?: boolean, mode?: ImmersiveMode } = {})`. It checks
native immersive support and returns a dynamically imported Three.js renderer
module when supported or explicitly opted in; otherwise it returns `null`.
Importing this helper does not itself start an immersive session.

See the [XR loading example](../README.md#optional-threejs-and-xr) and the
[standalone demo](../examples/vanilla/main.ts).
