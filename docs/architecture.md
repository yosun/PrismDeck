# Architecture

PrismDeck is a navigable 3D volume containing ordered, parallel visual surfaces.
The geometry does not attach meaning to those surfaces.

| Term | Responsibility |
| --- | --- |
| Deck | The volume and its current navigation state |
| Pane | One visual surface |
| Axis | The ordered dimension: sequence, depth, time, version, or a numerical position |
| Adapter | Stable keys, labels, optional positions, and application content |
| Actions | Application-defined interactions invoked from focus or selection |

## Layers

```text
Application content and activation actions
                  │
         React binding (optional)
                  │
    DOM renderer  │  Three.js renderer (optional)
            \     │     /
              Core controller
              order · geometry
           focus · zoom · view
```

`@prismdeck/core` is independent of React, the DOM, Three.js, and WebXR.
`@prismdeck/dom` uses CSS 3D transforms and native browser events. The React
binding delegates navigation to the same controller and DOM layer.

The Three.js renderer is a separate entry point. Its `getImage` adapter supplies
image sources for visible panes. It can share a controller with the DOM view so
both views have the same focus, zoom, and camera angle. Arbitrary DOM or React
elements are not automatically rasterized into WebGL or XR; provide an image representation when
using those renderers.

XR helpers live behind the explicit `@prismdeck/three/xr` subpath. The ordinary
page must not load XR code. An application may check
`navigator.xr?.isSessionSupported('immersive-vr')` or the appropriate immersive
mode before loading the helper, or expose an explicit opt-in. Starting an
immersive session still requires the browser's user-gesture and permission flow.

## Ordering

Without `adapter.getPosition`, the item array defines the order. With a position
adapter, numerical positions define a stable ordering; equal positions preserve
their order in the original array. Labels and units describe the axis without
changing its geometry. Stable keys preserve identity when a collection changes.

## Bounded rendering

A deck can describe thousands of items while mounting a bounded set of panes.
Close views use a window around focus; compact overviews sample the full order
while retaining the focused pane and its neighbors. The default `maxVisible` is
40. Zoom changes geometry and density while keeping the rendering budget bounded.
Images are created when their pane mounts and released when it unmounts.

An application should supply thumbnails for browsing and load full-resolution
content when selected. `renderPane` may return an element with a `dispose`
callback to release application-owned resources. Dispose the deck when its host
is removed to release listeners, content, and renderer resources.

## Focus, selection, and presentation

Focus navigates the collection. Selection records a pane's stable key. Presentation
is a renderer concern: the core controller and geometry never know about a modal,
a slide editor, or an application route.

The DOM renderer supplies independent presentation options:

- `layout` defaults to the `'prism'` volume in every preset; the explicit
  `'wallet'` layout remains for compatibility.
- `selectionMode` chooses `'slide-out'`, `'modal'`, or `'none'`.
- `prismLines` controls the perspective rectangular prism outline in prism layout.
- `timelineRails` controls rails along the ordered axis. Their geometry follows
  the axis; it does not require chronological content. Rails apply to prism layout.
- `planeGrid` extends the selected pane's plane into a grid.
- `paneDrag` permits free, horizontal, vertical, or no dragging in that plane.
- `snapToGrid` independently snaps committed drags; `gridSize` sets world spacing.

Version A combines slide-out, prism lines, and rails. Version B combines modal
selection with both line systems hidden. Version C combines prism layout,
slide-out selection, both line systems, an extended plane grid, free dragging, and
snapping. They are presets, so each
explicit option overrides its preset independently. React forwards the same
options into the DOM renderer. No preset changes adapters, ordering, content,
theme, or XR loading.

The slide-out keeps WOMDeck's continuous deck-to-pane interaction: selection
moves the existing pane into a separate presentation layer, translates it along
the perpendicular axis, and interpolates a separate camera to face it. The
archive shrinks into the upper-left portion of the view, preserving context.
It does not replace the pane with a second image or open an overlay dialog.

The extended workspace retains the selected original pane and builds a grid in
its local plane. The camera stays oblique so the grid and prism remain spatial.
Pointer displacement is projected into that plane, allowing motion in every
direction rather than a screen-space slide to the right. A drag may be free or
constrained to one local axis, and release may snap to the nearest grid
intersection. Grid rendering, drag direction, snapping, and spacing are
independent options. Shift/right dragging and the Rotate mode continue to orbit
the camera.

Workspace offsets live in the DOM presentation layer, keyed by stable content
identity. They never change controller ordering or the original prism poses.
Dismissal restores the pane's prism position; reopening restores its workspace
offset. Item removal and disposal release offsets. The user-commit callback
`onPaneMove` reports one final offset after a drag, keyboard move, or centering; programmatic offset changes
are quiet. Grid geometry adds no image resources, framework, WebGL, or XR import.
The examples auto-select C's focused pane for an immediate workspace preview;
the reusable library keeps selection application-controlled.

The explicit wallet layout is retained only for compatibility and is absent from
the current presets and demo controls.

The modal presentation moves the same selected pane into a native dialog.
Dismissal restores the pane and focus. A caller can provide `renderSelection`
when preview and detail content differ; this creates one separately bounded
content resource and disposes it when selection changes or closes. The default
path reuses the pane resource.

`onSelect` observes the selected item. An optional `onActivate` handles another
activation of the already selected pane; an application may use it to open an
editor, inspect a scan, or compare versions. Setting `selectionMode: 'none'`
leaves the entire detail interface to the application. PrismDeck does not choose
routes, application actions, or network requests.

## Shared camera angle

The headless controller owns signed `view: { yaw, pitch }` controls centered on
zero, with yaw bounded to `-60…60` and pitch to `-45…45`. These values are not
absolute Euler angles. The prism maps their full ranges into safe front-facing
azimuth and elevation at the current zoom, avoiding unresponsive slider travel
near the limits. Zero retains the renderer's starting perspective. `setView` changes either
or both components; `resetView` returns both to zero. Focus, selection, zoom, and
presentation changes preserve this state. An adapter does not need to understand
camera controls or assign semantic meaning to an angle.

The DOM renderer turns the prism camera basis for both content and guides. This
keeps the cross section and its pane corners aligned while orbiting. The extended
workspace projects the grid and its pane through that same camera; dragging
therefore follows the pane at any view angle. The regular slide-out and modal
use their reading presentations and retain the collection's angle for dismissal.

The shared **View angle** panel supplies horizontal and vertical sliders, a
**Rotate** drag toggle, and reset. Enabling **Rotate** makes one-finger orbit
available on touchscreens; turning it off preserves normal sequence dragging. Shift-drag
and right-drag provide mouse shortcuts; Alt + Arrow keys and `0` support keyboard
adjustment and reset. Wheel and pinch retain their density behavior.

`cameraControls` controls this UI independently of the navigation toolbar.
Setting it to false hides the panel and disables built-in angle gestures and
shortcuts. Applications can drive the same controller state with their own interface. React forwards these options and callbacks rather than creating a
second camera state. The ordinary DOM camera path uses CSS 3D and core math;
changing the angle never imports Three.js or XR.

## Geometry and neutral themes

Pane content and perspective guides use the same volume geometry. The guide
cross section at any pane's axis position is that pane's full width and height,
so its four corners meet the four prism boundaries. Images retain their intrinsic
aspect ratio inside that surface. Use images matching the pane's aspect ratio
(the default is 16:9) when the image itself should meet all four boundaries; the
shared demo samples use 1600 × 900 SVGs.

Color mode is independent of navigation and presentation. The DOM renderer owns
`theme: 'light' | 'dark' | 'system'`, and React forwards that option. `'system'` is
the default and observes operating system changes. Both explicit modes use
neutral white, gray, and dark colors for surfaces, controls, focus, and guides.
Applications can override documented CSS variables and supply any pane content.
Core and optional spatial modules do not acquire a theme dependency.

The component stores no preference and changes no page-level styles. Demo-only
code shares Day/Night controls, optional local persistence, URL preferences, and
system-theme observation between the vanilla and React examples. A small inline
initializer applies the same preference before the first page paint.

## Accessibility

The DOM renderer provides keyboard navigation, an accessible label, visible focus,
and touch input. Applications should supply meaningful pane labels and retain
the default controls unless equivalent accessible controls are provided. A 3D
view can be paired with an ordinary list or detail panel when a workflow needs a
complete textual view of the collection.
