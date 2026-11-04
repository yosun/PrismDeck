# Working on PrismDeck

PrismDeck is a standalone, MIT-licensed navigation widget for ordered visual
content. Keep its geometry, navigation, and renderer APIs independent of any
particular application or content domain.

- Keep `@prismdeck/core` free of runtime dependencies and `@prismdeck/dom` dependent
  only on core. Neither should require a third-party framework or renderer.
- Keep Three.js out of the DOM and React dependency graphs.
- Keep XR code in `@prismdeck/three/xr`; dynamically import it only after an
  immersive capability check succeeds or the user explicitly opts in.
- Mount only the bounded visible pane window. Create content and image resources
  lazily, and dispose resources when panes leave that window.
- Preserve input order unless an adapter supplies numerical positions. For equal
  positions, retain the original input order.
- Use neutral terms: deck, pane, axis, adapter, focus, select, and actions.
- Preserve keyboard access, visible focus, touch navigation, and reduced motion.
- Synthetic examples must work without accounts, remote APIs, or remote images.
- Build and run the relevant tests before handing off changes. Include browser
  coverage when changing DOM input handling or virtualization.

Start with [README.md](./README.md), then consult the package source and
[architecture notes](./docs/architecture.md). Run `npm ci`, `npm run build`, and
`npm test` from this repository. `npm run test:browser` checks browser behavior.
`npm run pack` creates distributable tarballs in `.artifacts`.
