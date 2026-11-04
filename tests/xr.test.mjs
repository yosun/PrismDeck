import assert from 'node:assert/strict';
import test from 'node:test';
import { enterXR, isXRSupported } from '../packages/three/dist/xr.js';

function installNavigator(t, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
    else delete globalThis.navigator;
  });
}

class Session extends EventTarget {
  endCount = 0;
  async end() {
    this.endCount++;
    this.dispatchEvent(new Event('end'));
  }
}

function mockRenderer({ enabled = false, session = null, setSession } = {}) {
  return {
    xr: {
      enabled,
      referenceSpace: undefined,
      getSession: () => session,
      setReferenceSpaceType(type) { this.referenceSpace = type; },
      async setSession(next) { await setSession?.(next); session = next; },
    },
  };
}

test('XR capability detection is safe without a device and never requests permission', async (t) => {
  installNavigator(t, undefined);
  assert.equal(await isXRSupported(), false);
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
  assert.equal(await isXRSupported(), false);
  const queries = [];
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { xr: {
    async isSessionSupported(mode) { queries.push(mode); return mode === 'immersive-ar'; },
    requestSession() { assert.fail('Capability detection must not request a session'); },
  } } });
  assert.equal(await isXRSupported(), false);
  assert.equal(await isXRSupported('immersive-ar'), true);
  assert.deepEqual(queries, ['immersive-vr', 'immersive-ar']);
});

test('XR capability query failures resolve to false', async (t) => {
  installNavigator(t, { xr: { isSessionSupported: async () => { throw new Error('Policy blocked'); } } });
  assert.equal(await isXRSupported(), false);
});

test('enterXR requests immediately and restores renderer state when the session ends', async (t) => {
  const session = new Session();
  const renderer = mockRenderer();
  const calls = [];
  const init = { optionalFeatures: ['hand-tracking'] };
  installNavigator(t, { xr: {
    isSessionSupported() { assert.fail('Do not consume click activation with a capability await'); },
    requestSession(mode, options) { calls.push({ mode, options }); return Promise.resolve(session); },
  } });
  const entering = enterXR(renderer, 'immersive-ar', init);
  assert.deepEqual(calls, [{ mode: 'immersive-ar', options: init }]);
  assert.equal(renderer.xr.enabled, true);
  assert.equal(await entering, session);
  assert.equal(renderer.xr.getSession(), session);
  assert.equal(renderer.xr.referenceSpace, 'local');
  await session.end();
  assert.equal(renderer.xr.enabled, false);
});

test('enterXR ends a created session if renderer setup fails', async (t) => {
  const failure = new Error('GL context unavailable');
  const session = new Session();
  const renderer = mockRenderer({ setSession: async () => { throw failure; } });
  installNavigator(t, { xr: { requestSession: async () => session } });
  await assert.rejects(enterXR(renderer), (error) => error === failure);
  assert.equal(session.endCount, 1);
  assert.equal(renderer.xr.enabled, false);
});

test('enterXR restores preexisting XR configuration on request rejection', async (t) => {
  const renderer = mockRenderer({ enabled: true });
  installNavigator(t, { xr: { requestSession: async () => { throw new Error('User denied'); } } });
  await assert.rejects(enterXR(renderer), /User denied/);
  assert.equal(renderer.xr.enabled, true);
});

test('enterXR reuses an existing session without a second permission request', async (t) => {
  const session = new Session();
  installNavigator(t, { xr: { requestSession() { assert.fail('Already presenting'); } } });
  assert.equal(await enterXR(mockRenderer({ session })), session);
});

test('enterXR gives a useful error when WebXR is unavailable', async (t) => {
  installNavigator(t, {});
  await assert.rejects(enterXR(mockRenderer()), /WebXR is unavailable/);
});
