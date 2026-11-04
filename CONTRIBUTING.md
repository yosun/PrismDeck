# Contributing

PrismDeck welcomes focused improvements to geometry, navigation, accessibility,
rendering, adapters, and documentation. Open an issue or pull request explaining
the observable behavior you want to improve.

## Develop

Use a current Node.js LTS release and npm. From a clone of this repository:

```sh
npm ci
npm run dev
```

The default demo uses the dependency-free DOM renderer. Run `npm run dev:react`
for the React example. Both examples generate their content locally.

Before submitting:

```sh
npm run build
npm test
npm run test:browser
npm run pack
```

For browser tests, install the browser requested by Playwright if it is not
already available. Build output and the `.artifacts` tarballs are generated files.

## Design constraints

- Core owns ordering, geometry, focus, zoom, and navigation. Adapters own the
  meaning of the content. Applications own selection actions.
- The default path must never import Three.js or XR. Optional spatial rendering
  should share the same controller with the on-screen renderer.
- Large collections must keep a bounded number of mounted panes and live image
  resources. Test collection replacement, boundary navigation, and disposal.
- Do not couple an adapter to a specific backend, file format, or application.
- Treat keyboard, touch, reduced motion, and screen-reader behavior as part of
  the component API.

Include a small reproduction or regression test for a behavior change. Keep
examples and the public API documentation aligned with the implementation.

By contributing, you agree that your contributions are licensed under the
[MIT License](./LICENSE).
