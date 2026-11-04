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
Application content and selection actions
                  │
         React binding (optional)
                  │
    DOM renderer  │  Three.js renderer (optional)
            \     │     /
              Core controller
              order · geometry
              focus · zoom
```

`@prismdeck/core` is independent of React, the DOM, Three.js, and WebXR.
`@prismdeck/dom` uses CSS 3D transforms and native browser events. The React
binding delegates navigation to the same controller and DOM layer.

The Three.js renderer is a separate entry point. Its `getImage` adapter supplies
image sources for visible panes. It can share a controller with the DOM view so
both views have the same focus and zoom. Arbitrary DOM or React elements are not
automatically rasterized into WebGL or XR; provide an image representation when
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

## Focus and selection

Focus navigates the collection. Selection invokes an optional application action:
opening a slide, inspecting a scan, or comparing a version. PrismDeck does not
open routes, dialogs, editors, or network requests on behalf of the application.
The demos implement a selection dialog to show where this behavior belongs.

## Accessibility

The DOM renderer provides keyboard navigation, an accessible label, visible focus,
and touch input. Applications should supply meaningful pane labels and retain
the default controls unless equivalent accessible controls are provided. A 3D
view can be paired with an ordinary list or detail panel when a workflow needs a
complete textual view of the collection.
