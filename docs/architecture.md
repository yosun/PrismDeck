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

## Focus, selection, and presentation

Focus navigates the collection. Selection records a pane's stable key. Presentation
is a renderer concern: the core controller and geometry never know about a modal,
a slide editor, or an application route.

The DOM renderer supplies independent presentation options:

- `selectionMode` chooses `'slide-out'`, `'modal'`, or `'none'`.
- `prismLines` controls the perspective rectangular prism outline.
- `timelineRails` controls rails along the ordered axis. Their geometry follows
  the axis; it does not require chronological content.

Version A combines slide-out, prism lines, and rails. Version B combines modal
selection with both line systems hidden. They are presets, so each explicit
option overrides its preset independently. React forwards the same options into
the DOM renderer. Neither preset changes adapters, navigation, content, or XR
loading.

The slide-out keeps WOMDeck's continuous deck-to-pane interaction: selection
moves the existing pane into a separate presentation layer, translates it along
the perpendicular axis, and interpolates a separate camera to face it. The
archive shrinks into the upper-left portion of the view, preserving context.
It does not replace the pane with a second image or open an overlay dialog.

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

## Accessibility

The DOM renderer provides keyboard navigation, an accessible label, visible focus,
and touch input. Applications should supply meaningful pane labels and retain
the default controls unless equivalent accessible controls are provided. A 3D
view can be paired with an ordinary list or detail panel when a workflow needs a
complete textual view of the collection.
