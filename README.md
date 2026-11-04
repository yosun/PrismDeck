# PrismDeck

A lightweight, open-source 3D navigation component for large collections of
ordered images and visual content. Browse a volume of parallel panes, focus one,
and bring it into view with a seamless slide-out or a modal.

Use it for slide decks, photo archives, PDF pages, video frames, version histories,
medical slices, scientific datasets, or spatial galleries. An axis can mean
sequence, depth, time, version, or any numerical position.

- **Small default path:** no third-party runtime dependencies in core or DOM.
- **Bounded rendering:** thousands of items, up to 40 preview panes by default.
- **Modular presentation:** choose seamless slide-out or modal; switch prism lines
  and timeline rails independently.
- **Content stays yours:** render DOM or React content; supply your own actions.
- **Progressive spatial support:** Three.js and XR are separate, optional imports.
- **Built for input:** keyboard, pointer, touch, pinch, and zoom controls.
- **MIT licensed:** use it in personal, open-source, and commercial applications.

[Live demo](https://yosun.github.io/PrismDeck/) ·
[Source](https://github.com/yosun/PrismDeck) ·
[Release downloads](https://github.com/yosun/PrismDeck/releases)

## Try it locally

Requires Node.js 22 or newer.

```sh
git clone https://github.com/yosun/PrismDeck.git
cd PrismDeck
npm ci
npm run build
npm run dev
```

Open the local Vite URL. The demo generates 1,000 slides locally and can switch to
10,000 items. No account, image service, API key, or external image host is needed.
The default is **Version A**. Try the **Version B** switch for modal selection, or
share a demo URL ending in `?variant=A` or `?variant=B`. The checkboxes and selection
menu let you mix each option independently. Run `npm run dev:react` for the React
example.

## Drop into any page

The standalone browser bundle needs no build tool or framework:

```html
<link rel="stylesheet" href="https://yosun.github.io/PrismDeck/prismdeck.css" />
<div id="slides" style="height: 560px"></div>
<script type="module">
  import { createPrismDeck } from 'https://yosun.github.io/PrismDeck/prismdeck.js';

  const deck = createPrismDeck(document.querySelector('#slides'), {
    items: [
      { id: 'one', title: 'First slide', image: './slide-1.jpg' },
      { id: 'two', title: 'Second slide', image: './slide-2.jpg' },
    ],
    getKey: (item) => item.id,
    renderPane: (item) => {
      const image = new Image();
      image.src = item.image;
      image.alt = item.title;
      return image;
    },
    variant: 'A', // Seamless slide-out, prism lines, and timeline rails.
    onSelect: (item) => console.log('Selected', item.id),
    onActivate: (item) => console.log('Activate', item.id),
  });
</script>
```

For production, download and self-host the browser bundle and stylesheet from a
[pinned release](https://github.com/yosun/PrismDeck/releases/tag/v0.2.0). GitHub
Pages follows the current demo build. The bundle contains the DOM widget and core;
it does not include React, Three.js, or XR. The current standalone build is about
8 KB of gzipped JavaScript plus a 1.7 KB gzipped stylesheet.

## Packages

| Package | Purpose | Runtime dependencies |
| --- | --- | --- |
| `@prismdeck/core` | Ordering, geometry, camera, focus, zoom, navigation | None |
| `@prismdeck/dom` | CSS 3D widget and browser input | Core only |
| `@prismdeck/react` | React component, pane, and state hook | Core, DOM; React peer |
| `@prismdeck/three` | Optional WebGL image renderer | Core; Three.js peer |
| `@prismdeck/three/xr` | Explicit, lazy XR helpers | Optional Three.js renderer |

The packages are prepared as version **0.2.0**. This repository does not imply
that the names are available from the npm registry. Build local distributable
tarballs with:

```sh
npm run pack
```

Install the generated tarballs in your application. Install core first, then the
renderer or binding you use:

```sh
npm install /path/to/PrismDeck/.artifacts/prismdeck-core-0.2.0.tgz
npm install /path/to/PrismDeck/.artifacts/prismdeck-dom-0.2.0.tgz
# For React applications:
npm install react react-dom
npm install /path/to/PrismDeck/.artifacts/prismdeck-react-0.2.0.tgz
# For optional Three.js rendering:
npm install three
npm install /path/to/PrismDeck/.artifacts/prismdeck-three-0.2.0.tgz
```

## React

```tsx
import { PrismDeck } from '@prismdeck/react';
import '@prismdeck/dom/style.css';

export function SlideBrowser({ items, handleFocus, handleSelect, openEditor }) {
  return (
    <PrismDeck
      items={items}
      getKey={(item) => item.id}
      renderPane={(item) => <MyContent item={item} />}
      variant="A"
      onFocus={handleFocus}
      onSelect={handleSelect}
      onActivate={openEditor}
    />
  );
}
```

Give the widget a sized parent. A pane can contain an image, a slide preview, or
other React content. Keep expensive editors and full-resolution imagery in the
selection view rather than every preview.

The package also exports `Pane` for pane content and `usePrismDeck(controller)`
for subscribing a custom interface to a shared controller. See the
[React example](./examples/react/main.tsx).

## Vanilla JavaScript or TypeScript

```ts
import { createPrismDeck } from '@prismdeck/dom';
import '@prismdeck/dom/style.css';

const deck = createPrismDeck(document.querySelector('#deck'), {
  items: slides,
  getKey: (slide) => slide.id,
  renderPane: (slide) => {
    const image = new Image();
    image.src = slide.thumbnail;
    image.alt = slide.title;
    image.draggable = false;
    return image;
  },
  onFocus: (slide, index) => updateStatus(slide, index),
  variant: 'A',
  onSelect: (slide) => updateSelection(slide),
  onActivate: (slide) => openEditor(slide),
  maxVisible: 40,
  label: 'Browse presentation slides',
});

// Replace content while retaining the widget.
deck.update({ items: nextSlides });

// Release event listeners and mounted content when leaving the view.
deck.dispose();
```

`renderPane` is called only for mounted content. It can return a `Node`, a plain
text string, or `{ element: Node, dispose?: () => void }`. Strings are treated as
text. Use the cleanup callback for application resources such as media streams,
object URLs, or custom subscriptions.

## Two versions, independent options

**Version A — Seamless slide-out** follows WOMDeck's original DeckStream flow.
The selected pane slides out along its perpendicular axis while the view turns
to face it. The collection stays in view as a compact prism, with vanishing-point
rectangular prism lines and timeline rails. The pane itself becomes the detail
view; no modal interrupts the transition.

**Version B — Modal** opens the selected pane in a modal and hides prism lines
and timeline rails. Escape, the backdrop, or the close button returns to browsing.

| Preset | Selection | Prism lines | Timeline rails |
| --- | --- | --- | --- |
| `variant: 'A'` (default) | `'slide-out'` | `true` | `true` |
| `variant: 'B'` | `'modal'` | `false` | `false` |

Versions are convenience presets on the same component. Each explicit option
independently overrides its preset, so a modal can have rails or a slide-out can
hide the prism outline:

```ts
const deck = createPrismDeck(mount, {
  items,
  getKey: (item) => item.id,
  renderPane,
  variant: 'B',
  prismLines: true,
  timelineRails: true,
  // selectionMode: 'slide-out' | 'modal' | 'none',
});

// Change individual options without rebuilding the widget.
deck.update({ timelineRails: false, selectionMode: 'slide-out' });
// Clear an override to return that option to the current preset.
deck.update({ selectionMode: undefined });
```

`selectionMode: 'none'` keeps selection state and callbacks while leaving its
presentation to your application. `onSelect` observes selection; an optional
`onActivate` handles a second activation of the selected pane, such as opening an
editor. PrismDeck itself does not attach application meaning to either event.

By default, both presentations reuse the selected pane's mounted content. Supply
`renderSelection(item, index)` only when its detail view needs different content,
such as a full-resolution image. DOM uses the same return types as `renderPane`;
React accepts React content. This optional detail renderer creates at most one
additional content resource and disposes it when selection closes or changes.

## Widget options

| Option | Meaning |
| --- | --- |
| `items` | The collection, in input order unless `getPosition` is supplied |
| `getKey(item)` | Stable, unique string or number identity |
| `renderPane(item, index)` | Lazily creates content for a visible pane |
| `onFocus(item, index)` | Called when navigation focuses a pane |
| `onSelect(item, index)` | Called when a pane is selected |
| `onActivate(item, index)` | Optional action when the selected pane is activated again |
| `variant` | `'A'` (default) or `'B'`; selects presentation defaults |
| `selectionMode` | `'slide-out'`, `'modal'`, or `'none'`; overrides the preset |
| `prismLines` | Show the vanishing-point rectangular prism outline; overrides the preset |
| `timelineRails` | Show rails along the ordered axis; overrides the preset |
| `transitionDuration` | Approximate slide-out settling time in milliseconds; defaults to `700`, or `0` for instant |
| `renderSelection(item, index)` | Optional lazy detail content; defaults to reusing the selected pane |
| `onDismiss()` | Called when the built-in selection view is dismissed |
| `adapter` | Optional `{ getKey, getPosition?, getLabel? }` metadata adapter |
| `axis` | Optional `{ label, unit }` description of the ordered dimension |
| `maxVisible` | Maximum preview panes; defaults to `40` |
| `initialFocus` | Initial focused index |
| `initialZoom` | Initial navigation zoom: `0` for close view, `1` for compact overview |
| `controls` | Whether to show the built-in navigation controls |
| `label` | Accessible label for the widget |

Supply `getKey` directly or through `adapter`. Keep keys unique and stable across
updates. Indices refer to the ordered view. Without `getPosition`, input order is
preserved. With `getPosition`, panes are stably sorted by numerical position, and
equal positions retain input order.

```ts
createPrismDeck(mount, {
  items: slices,
  adapter: {
    getKey: (slice) => slice.id,
    getPosition: (slice) => slice.depth,
    getLabel: (slice) => `Slice at ${slice.depth} mm`,
  },
  axis: { label: 'Depth', unit: 'mm' },
  renderPane: (slice) => makeSlicePreview(slice),
  onActivate: (slice) => inspectSlice(slice),
});
```

The returned instance has `element`, `controller`, `update(options)`, and
`dispose()`. Controller state can drive a custom toolbar, details panel, or a
second renderer:

```ts
const { controller } = deck;
const unsubscribe = controller.subscribe(() => {
  const { focus, zoom, count, selectedKey } = controller.getSnapshot();
  updateToolbar({ focus, zoom, count, selectedKey });
});

controller.move(1);
controller.focus(250);
controller.setZoom(0.6);
controller.select();
controller.dismiss();

unsubscribe();
```

## Headless geometry

Use core without a browser, framework, or renderer when building a custom view:

```ts
import { createDeckController, getPrismGeometry } from '@prismdeck/core';

const controller = createDeckController({
  items,
  getKey: (item) => item.id,
  axis: { label: 'Version' },
});

const { count, focus, zoom } = controller.getSnapshot();
const geometry = getPrismGeometry({
  count, focus, zoom,
  width: 1200,
  height: 700,
  positions: controller.getPositions(),
});

const panePosition = geometry.positionAt(focus);
// Your renderer uses panePosition, geometry.camera, and the pane dimensions.
controller.dispose();
```

Core creates no DOM nodes, images, GPU objects, animation loops, or XR sessions.
Subscribe to its controller to update a renderer only when state changes.

## Navigation

Focus the widget, then use:

| Input | Action |
| --- | --- |
| Arrow keys | Move through the ordered panes |
| Home / End | First / last pane |
| `+` / `-` | Change zoom and pane density |
| Enter | Select the focused pane; activate it again for the optional app action |
| Escape | Dismiss selection |
| Pointer or touch | Focus and activate a pane |
| Pinch or zoom slider | Adjust the prism's density |

Zoom lets a collection occupy a more compact volume while preserving navigation.
The preview rendering budget remains bounded by `maxVisible`. Applications can offer a
larger budget when the device and content can support it. Respect reduced motion
and provide meaningful item labels through the adapter.

## Optional Three.js and XR

DOM and React imports load **zero Three.js or XR code**. Use the optional renderer
only when your application needs WebGL or immersive display. Share the controller
so spatial and on-screen views stay synchronized:

```ts
// Run from a user-requested spatial-view action, not on ordinary page load.
const { createThreePrismDeck } = await import('@prismdeck/three');
const spatial = createThreePrismDeck(spatialMount, {
  controller: deck.controller,
  getImage: (slide) => slide.thumbnail,
});
```

Arbitrary DOM and React panes are not automatically rasterized into XR. Supply
`getImage(item)` with a suitable image representation, such as a slide thumbnail
or rendered document page. The Three.js renderer loads images for its visible
window and disposes textures as they leave that window.

Check a real immersive capability before automatically loading XR. An explicit
opt-in can also trigger the optional import; browser session support is still
required to enter an immersive session:

```ts
// Capability detection itself does not import an XR framework.
const xr = navigator.xr;
const supported = xr && await xr.isSessionSupported('immersive-vr');

if (supported) {
  // Expose an Enter XR button. Its click handler must retain a user gesture.
  const { enterXR } = await import('@prismdeck/three/xr');
  enterButton.onclick = () => enterXR(spatial.renderer);
}
```

Avoid user-agent checks: a phone, desktop, or headset browser name does not prove
that an immersive session is available. `isXRSupported(mode?)` is also exported by
the optional XR subpath for applications that have already opted into loading it.
Dispose the spatial renderer when leaving that view.

## Build, test, and contribute

```sh
npm run build
npm test
npm run test:browser
npm run pack
```

See [architecture](./docs/architecture.md), [contributing](./CONTRIBUTING.md), and
[agent instructions](./AGENTS.md). Source packages include TypeScript types.
The project is licensed under [MIT](./LICENSE).
