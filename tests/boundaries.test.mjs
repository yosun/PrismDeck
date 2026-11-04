import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';

test('default browser bundle contains no Three, React, XR, or other runtime dependency', async () => {
  const result = await build({entryPoints:['packages/dom/dist/index.js'],bundle:true,minify:true,format:'esm',target:'es2022',write:false,metafile:true});
  const inputs = Object.keys(result.metafile.inputs);
  assert.ok(inputs.every(file => /packages\/(core|dom)\/dist\/(index|options|guides|wallet|wallet-view)\.js$/.test(file)), inputs.join('\n'));
  assert.ok(gzipSync(result.outputFiles[0].contents).length < 12288, 'core + DOM stays under the 12 KiB gzip budget');
  const module = await import('../dist/prismdeck.js');
  assert.equal(typeof module.createPrismDeck, 'function');
});

test('optional spatial loader refuses to load the renderer without support or opt-in', async () => {
  const {loadSpatialRenderer} = await import('../packages/dom/dist/xr.js');
  assert.equal(await loadSpatialRenderer(),null);
});

test('package manifests expose independent typed ESM entry points and optional peers', async () => {
  for (const name of ['core','dom','react','three']) {
    const pkg=JSON.parse(await readFile(new URL(`../packages/${name}/package.json`,import.meta.url)));
    assert.equal(pkg.license,'MIT');
    assert.ok(pkg.exports['.'].types);
    assert.equal(pkg.type,'module');
  }
  const dom=JSON.parse(await readFile(new URL('../packages/dom/package.json',import.meta.url)));
  assert.deepEqual(Object.keys(dom.dependencies),['@prismdeck/core']);
  assert.equal(dom.peerDependenciesMeta['@prismdeck/three'].optional,true);
});
