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
| `onFocus` | `(item: T, orderedIndex: number) => void` |
| `onSelect` | `(item: T, orderedIndex: number) => void` |
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
| `setItems(items)` | Replaces items through `configure` |
| `configure(partialOptions)` | Updates content, adapters, metadata, or callbacks |
| `subscribe(listener)` | Registers `() => void`; returns an unsubscribe function |
| `dispose()` | Stops updates and releases subscriptions |

Snapshot fields are `{ focus, zoom, selectedKey, count, revision }`. An empty deck
has `focus: -1`, `count: 0`, and `selectedKey: null`. `zoom: 0` is the close view;
`zoom: 1` is the compact overview. `revision` increases when state is published.
Subscribers read the current state with `getSnapshot()`.

Focus navigates. Selection invokes an application action. Calling `select` on an
already selected pane still calls `onSelect`, so an application can reopen its
detail view. `dismiss` clears selection without changing focus. Initial focus
does not trigger `onFocus`; read `getSnapshot()` to initialize custom controls.

Collection updates retain focus by key when possible, otherwise clamp the old
index. Selection is retained only if its key still exists. Keys and positions are
validated before configuration is committed: an invalid update throws while
preserving the previous controller state. `initialFocus` and `initialZoom` apply
at creation; use navigation methods for later changes.

### Geometry

`getPrismGeometry({ count, focus, zoom, width, height, paneWidth?, paneHeight?, positions? })`
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

`visibleIndices(count, focus, maxVisible = 40, zoom = 0)` returns bounded ordered
indices. Close views use a contiguous focus window; overviews sample the full
collection while retaining focus and its nearest neighbors.
`densityForZoom(zoom)` returns the spacing compression factor.
`prismSpacing(width, azimuth?)` computes close-view spacing; azimuth is radians.
`clamp(value, min = 0, max = 1)` clamps a number.

Exported types include `PrismKey`, `PrismVector3`, `PrismAxis`, `PrismAdapter<T>`,
`PrismSnapshot`, `DeckControllerOptions<T>`, `DeckController<T>`,
`PrismGeometryOptions`, `PrismCamera`, and `PrismGeometry`. Naming aliases include
`Axis`, `DeckSnapshot`, `DeckOptions<T>`, `PrismDeckSnapshot`, and
`PrismDeckController<T>`.

## DOM

```ts
import { createPrismDeck } from '@prismdeck/dom';
```

### `createPrismDeck<T>(mount, options)`

`mount` is a sized `HTMLElement`. Options include all core options plus:

| Option | Behavior |
| --- | --- |
| `renderPane(item, index)` | Returns a `Node`, plain text string, or `{ element: Node, dispose?: () => void }` |
| `maxVisible` | Maximum mounted panes; defaults to `40` |
| `controls` | Built-in keyboard-accessible toolbar; defaults to `true` |
| `label` | Accessible widget label; defaults to `'PrismDeck'` |
| `className` | Additional root CSS class |
| `onDismiss()` | Optional callback when Escape dismisses selection in the widget |

Without a renderer, items are converted to plain text. Strings are never inserted
as HTML. Content is created lazily and disposed when it leaves the visible window
or the widget is disposed. Put independent controls inside panes normally; their
events are preserved. Add `data-prismdeck-interactive` to custom interactive
regions that need to receive their own input.

The returned `PrismDeckInstance<T>` exposes:

- `element`: the widget root.
- `controller`: the headless controller.
- `update(partialOptions)`: updates the existing widget and reconciles its content.
- `dispose()`: releases content, listeners, observer, pending frames, and controller.

Invalid key/position updates preserve the previous widget. A pane's application
cleanup should release resources it owns; the library does not revoke your
object URLs or cancel your subscriptions automatically.

Theme variables are `--prismdeck-accent`, `--prismdeck-background`, and
`--prismdeck-color`. Size the mount with CSS. The widget supports reduced motion,
arrow keys, Home/End, PageUp/PageDown, plus/minus, Enter, Escape, pointer drag,
wheel density changes, and touch pinch.

The default DOM entry point does not import Three.js or XR.

## React

```ts
import { PrismDeck, Pane, usePrismDeck } from '@prismdeck/react';
```

`PrismDeck<T>` accepts the DOM options with `renderPane(item, index): ReactNode`.
It also accepts `style`, `id`, and `onReady(instance)`. `className` and `style`
apply to the React mount. React content is portaled into the bounded visible
panes; offscreen content unmounts, so put persistent application state outside a
pane component when needed.

`Pane` is an optional full-size content wrapper accepting ordinary div attributes.
It does not create another deck.

`usePrismDeck(controller)` subscribes through React's external-store API and
returns the current snapshot. It returns `null` when no controller is provided or
when server-rendering. Get a live controller through `onReady` to drive custom
React controls or another renderer.

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
