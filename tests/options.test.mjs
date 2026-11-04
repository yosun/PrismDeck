import test from 'node:test';
import assert from 'node:assert/strict';
import { PRISMDECK_PRESETS, resolvePresentationOptions, resolveTheme } from '../packages/dom/dist/options.js';

test('A, B, and C are independent presentation presets with explicit overrides', () => {
  assert.deepEqual(resolvePresentationOptions({}), {
    variant: 'A', layout: 'prism', selectionMode: 'slide-out', prismLines: true,
    timelineRails: true, transitionDuration: 700,
  });
  assert.deepEqual(resolvePresentationOptions({ variant: 'B' }), {
    variant: 'B', layout: 'prism', selectionMode: 'modal', prismLines: false,
    timelineRails: false, transitionDuration: 700,
  });
  assert.deepEqual(resolvePresentationOptions({ variant: 'C' }), {
    variant: 'C', layout: 'wallet', selectionMode: 'slide-out', prismLines: false,
    timelineRails: false, transitionDuration: 700,
  });
  assert.deepEqual(resolvePresentationOptions({ variant: 'B', prismLines: true, selectionMode: 'none' }), {
    variant: 'B', layout: 'prism', selectionMode: 'none', prismLines: true,
    timelineRails: false, transitionDuration: 700,
  });
  assert.deepEqual(resolvePresentationOptions({ variant: 'C', layout: 'prism', selectionMode: 'modal', prismLines: true, timelineRails: true, transitionDuration: 0 }), {
    variant: 'C', layout: 'prism', selectionMode: 'modal', prismLines: true,
    timelineRails: true, transitionDuration: 0,
  });
  assert.deepEqual(resolvePresentationOptions({ variant: 'A', layout: 'wallet' }), {
    variant: 'A', layout: 'wallet', selectionMode: 'slide-out', prismLines: true,
    timelineRails: true, transitionDuration: 700,
  });
  for (const preset of Object.values(PRISMDECK_PRESETS)) assert.equal(Object.isFrozen(preset), true);
  assert.equal(Object.isFrozen(PRISMDECK_PRESETS), true);
  assert.throws(() => resolvePresentationOptions({ variant: 'D' }), RangeError);
  assert.throws(() => resolvePresentationOptions({ layout: 'carousel' }), RangeError);
  assert.throws(() => resolvePresentationOptions({ selectionMode: 'popup' }), RangeError);
  assert.throws(() => resolvePresentationOptions({ transitionDuration: -1 }), RangeError);
});

test('neutral themes follow the system or explicit day/night selection', () => {
  assert.equal(resolveTheme(), 'light');
  assert.equal(resolveTheme('system', true), 'dark');
  assert.equal(resolveTheme('light', true), 'light');
  assert.equal(resolveTheme('dark', false), 'dark');
  assert.throws(() => resolveTheme('green'), RangeError);
});
