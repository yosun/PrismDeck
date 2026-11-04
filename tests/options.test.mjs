import test from 'node:test';
import assert from 'node:assert/strict';
import { PRISMDECK_PRESETS, resolvePresentationOptions, resolveTheme } from '../packages/dom/dist/options.js';
test('A and B are independent presentation presets with explicit overrides',()=>{
 assert.deepEqual(resolvePresentationOptions({}),{variant:'A',selectionMode:'slide-out',prismLines:true,timelineRails:true,transitionDuration:700});
 assert.deepEqual(resolvePresentationOptions({variant:'B'}),{variant:'B',selectionMode:'modal',prismLines:false,timelineRails:false,transitionDuration:700});
 assert.deepEqual(resolvePresentationOptions({variant:'B',prismLines:true,selectionMode:'none'}),{variant:'B',selectionMode:'none',prismLines:true,timelineRails:false,transitionDuration:700});
 assert.equal(Object.isFrozen(PRISMDECK_PRESETS.A),true);
 assert.throws(()=>resolvePresentationOptions({variant:'C'}),RangeError);
 assert.throws(()=>resolvePresentationOptions({selectionMode:'popup'}),RangeError);
 assert.throws(()=>resolvePresentationOptions({transitionDuration:-1}),RangeError);
});

test('neutral themes follow the system or explicit day/night selection',()=>{
 assert.equal(resolveTheme(), 'light');
 assert.equal(resolveTheme('system', true), 'dark');
 assert.equal(resolveTheme('light', true), 'light');
 assert.equal(resolveTheme('dark', false), 'dark');
 assert.throws(()=>resolveTheme('green'),RangeError);
});
