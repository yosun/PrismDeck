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

- `layout` chooses the `'prism'` volume or `'wallet'` card fan.
- `selectionMode` chooses `'slide-out'`, `'modal'`, or `'none'`.
- `prismLines` controls the perspective rectangular prism outline in prism layout.
- `timelineRails` controls rails along the ordered axis. Their geometry follows
  the axis; it does not require chronological content. Rails apply to prism layout.

Version A combines slide-out, prism lines, and rails. Version B combines modal
selection with both line systems hidden. Version C combines wallet layout and
slide-out selection with both line systems hidden. They are presets, so each
explicit option overrides its preset independently. React forwards the same
options into the DOM renderer. No preset changes adapters, ordering, content,
theme, or XR loading.

The slide-out keeps WOMDeck's continuous deck-to-pane interaction: selection
moves the existing pane into a separate presentation layer, translates it along
the perpendicular axis, and interpolates a separate camera to face it. The
archive shrinks into the upper-left portion of the view, preserving context.
It does not replace the pane with a second image or open an overlay dialog.

Wallet layout presents the same bounded content window as cards fanned out of a
pocket. Its slide-out raises the selected card into the reading layer and keeps
its slot in the wallet; dismissal returns the card to its place. The collection
stays ordered. Zoom adjusts the fan's density, and existing keyboard, pointer,
and touch controls retain their navigation semantics. The pocket is rendered
with CSS and uses no image resources or renderer dependencies. Prism outlines
and rails stay hidden while wallet layout is active, with their configuration
retained for a return to prism layout.

The demo's wildcard action is application code using the shared controller. It
focuses a different random index and selects that card without shuffling or
reordering the collection. An application can supply its own discovery strategy;
the library does not attach meaning or randomness to the ordered axis.

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
keeps the cross section and its pane corners aligned while orbiting. Wallet
layout applies the same user angle to a volume containing the fan and pocket,
so its cards remain inside a coherent object. Selection uses its own reading
presentation and retains the collection's angle for dismissal.

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
