import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const core = new URL('../packages/core/', import.meta.url);
const [major, minor] = process.versions.node.split('.').map(Number);
// Earlier Node 22 releases can run the published JS but cannot execute TS source.
const nativeTypeStripping = major > 22 || (major === 22 && minor >= 6);

async function isolatedDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), 'prismdeck-core-runtime-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function checkCoreImport(specifier, cwd, flags = []) {
  const result = spawnSync(process.execPath, [...flags, '--input-type=module', '--eval', `
    import assert from 'node:assert/strict';
    const { createDeckController, getPrismGeometry, getWalletLayout } = await import(${JSON.stringify(specifier)});
    const controller = createDeckController({ items: ['first', 'second'], initialFocus: 1 });
    assert.equal(controller.getKey(controller.getSnapshot().focus), 'second');
    const geometry = getPrismGeometry({ count: 2, focus: 1, zoom: 0, width: 800, height: 600 });
    assert.ok(geometry.paneWidth > 0);
    const wallet = getWalletLayout({ count: 2, focus: 1, zoom: 0, width: 800, height: 600, indices: [1] });
    assert.equal(wallet.panes[0].index, 1);
    controller.dispose();
  `], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.error?.stack ?? `${result.stdout}\n${result.stderr}`);
}

test('native Node imports core TypeScript source without generated JavaScript siblings', {
  skip: nativeTypeStripping ? false : 'Native TypeScript execution requires Node 22.6 or newer',
}, async (t) => {
  const directory = await isolatedDirectory(t);
  const source = join(directory, 'src');
  await writeFile(join(directory, 'package.json'), JSON.stringify({ type: 'module' }));
  // Include only source files so an old generated wallet.js cannot mask a bad specifier.
  await cp(new URL('src/', core), source, {
    recursive: true,
    filter: (path) => !/\.[^/]+$/.test(path) || path.endsWith('.ts'),
  });
  checkCoreImport(pathToFileURL(join(source, 'index.ts')).href, directory, ['--experimental-strip-types']);
});

test('published core entry point runs and typechecks with only its compiled distribution installed', async (t) => {
  const directory = await isolatedDirectory(t);
  const installed = join(directory, 'node_modules', '@prismdeck', 'core');
  await mkdir(installed, { recursive: true });
  await cp(new URL('package.json', core), join(installed, 'package.json'));
  await cp(new URL('dist/', core), join(installed, 'dist'), { recursive: true });
  // Running from outside the workspace proves package exports and emitted relative
  // imports work without TypeScript source or workspace resolution fallbacks.
  checkCoreImport('@prismdeck/core', directory);
  const consumer = join(directory, 'consumer.mts');
  await writeFile(consumer, `
    import { createDeckController, getWalletLayout, type WalletLayout, type WalletPaneLayout } from '@prismdeck/core';
    const controller = createDeckController({ items: ['first', 'second'] });
    const layout: WalletLayout = getWalletLayout({ count: 2, focus: 1, zoom: 0, width: 800, height: 600, indices: [1] });
    const pane: WalletPaneLayout | undefined = layout.panes[0];
    controller.focus(pane?.index ?? 0);
  `);
  const typecheck = spawnSync(process.execPath, [
    fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url)),
    '--strict', '--module', 'NodeNext', '--moduleResolution', 'NodeNext',
    '--target', 'ES2022', '--lib', 'ES2023,DOM', '--noEmit',
    '--allowImportingTsExtensions', 'false', '--skipLibCheck', 'false', consumer,
  ], { cwd: directory, encoding: 'utf8' });
  assert.equal(typecheck.status, 0, typecheck.error?.stack ?? `${typecheck.stdout}\n${typecheck.stderr}`);
});
