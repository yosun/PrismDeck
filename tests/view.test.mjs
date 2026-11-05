import test from 'node:test';
import assert from 'node:assert/strict';
import { clampView, createDeckController, getPrismGeometry, getPrismViewAngles } from '../packages/core/dist/index.js';

const near = (actual, expected, epsilon = 1e-8) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} ≈ ${expected}`);
const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);
const defaults = { count: 50, focus: 25, zoom: 0, width: 1200, height: 700 };
const project = (geometry, point, width = defaults.width, height = defaults.height) => {
  const relative = point.map((value, index) => value - geometry.camera.position[index]);
  const depth = dot(relative, geometry.camera.direction);
  return { x: width / 2 + dot(relative, geometry.camera.right) * geometry.camera.focalLength / depth,
    y: height / 2 - dot(relative, geometry.camera.up) * geometry.camera.focalLength / depth, depth };
};

test('view state is finite, clamped, frozen, stable, and independent of navigation', () => {
  const changes = [], focused = [], selected = [];
  const controller = createDeckController({ items: ['a', 'b', 'c'], onViewChange: (view) => changes.push(view),
    onFocus: (item) => focused.push(item), onSelect: (item) => selected.push(item) });
  const original = controller.getSnapshot();
  assert.deepEqual(original.view, { yaw: 0, pitch: 0 });
  assert.ok(Object.isFrozen(original.view));
  assert.equal(controller.getSnapshot().view, original.view);
  controller.setView({});
  controller.resetView();
  assert.equal(controller.getSnapshot(), original);
  assert.deepEqual(changes, []);
  controller.select(1);
  const before = controller.getSnapshot(), items = controller.getItems(), positions = controller.getPositions();
  controller.setView({ yaw: 25 });
  const moved = controller.getSnapshot();
  assert.deepEqual(moved.view, { yaw: 25, pitch: 0 });
  assert.equal(moved.focus, before.focus);
  assert.equal(moved.selectedKey, before.selectedKey);
  assert.equal(moved.zoom, before.zoom);
  assert.equal(controller.getItems(), items);
  assert.equal(controller.getPositions(), positions);
  assert.equal(changes[0], moved.view);
  assert.ok(Object.isFrozen(moved.view));
  assert.deepEqual(focused, ['b']);
  assert.deepEqual(selected, ['b']);
  controller.move(1);
  controller.setZoom(0.7);
  controller.dismiss();
  controller.setItems(['c', 'b', 'a']);
  assert.equal(controller.getSnapshot().view, moved.view, 'navigation retains the exact view object');
  controller.setView({ yaw: 100, pitch: -100 });
  assert.deepEqual(controller.getSnapshot().view, { yaw: 60, pitch: -45 });
  const selectedSnapshot = controller.getSnapshot();
  const resetItems = controller.getItems();
  controller.select(0);
  controller.resetView();
  assert.deepEqual(controller.getSnapshot().view, { yaw: 0, pitch: 0 });
  assert.equal(controller.getSnapshot().focus, selectedSnapshot.focus);
  assert.equal(controller.getSnapshot().selectedKey, 'c', 'reset changes only the view');
  assert.equal(controller.getItems(), resetItems, 'reset retains the stable item array');
});

test('invalid angle commands are atomic, initialization is safe, and callback changes are live', () => {
  const calls = [];
  const controller = createDeckController({ items: ['a'], initialView: { yaw: 80, pitch: NaN },
    onViewChange: (view) => calls.push(['initial', view]) });
  assert.deepEqual(controller.getSnapshot().view, { yaw: 60, pitch: 0 });
  assert.deepEqual(calls, [], 'initialization does not emit an interaction');
  const before = controller.getSnapshot();
  for (const view of [{ yaw: NaN, pitch: 20 }, { yaw: 10, pitch: Infinity }, { yaw: -Infinity }, { pitch: '20' }]) {
    controller.setView(view);
    assert.equal(controller.getSnapshot(), before);
  }
  controller.configure({ initialView: { yaw: 0, pitch: 0 }, onViewChange: (view) => calls.push(['next', view]) });
  assert.equal(controller.getSnapshot(), before, 'initialView is a seed, not a controlled update');
  controller.setView({ pitch: 22 });
  assert.deepEqual(controller.getSnapshot().view, { yaw: 60, pitch: 22 });
  assert.deepEqual(calls, [['next', controller.getSnapshot().view]]);
  const disposed = controller.getSnapshot();
  controller.dispose();
  controller.resetView();
  controller.setView({ yaw: -40 });
  assert.equal(controller.getSnapshot(), disposed);
  assert.deepEqual(clampView({ yaw: NaN, pitch: -99 }), { yaw: 0, pitch: -45 });
});

test('zero viewing angles preserve existing camera geometry exactly', () => {
  for (const zoom of [0, 0.3, 1]) {
    const geometry = getPrismGeometry({ ...defaults, zoom });
    const explicit = getPrismGeometry({ ...defaults, zoom, view: { yaw: 0, pitch: 0 } });
    assert.deepEqual(geometry.camera, explicit.camera);
    const azimuth = (24 + (58 - 24) * zoom) * Math.PI / 180;
    const elevation = (6 + (18 - 6) * zoom) * Math.PI / 180;
    assert.deepEqual(geometry.camera.direction, [Math.cos(azimuth) * Math.cos(elevation), -Math.sin(elevation), -Math.sin(azimuth) * Math.cos(elevation)]);
    assert.deepEqual(getPrismGeometry({ ...defaults, zoom, view: { yaw: NaN, pitch: Infinity } }).camera, geometry.camera);
  }
});

test('shared view angles preserve zoom defaults and normalize partial, invalid, and bounded inputs', () => {
  for (const zoom of [0, 0.3, 1]) {
    assert.deepEqual(getPrismViewAngles(zoom), {
      azimuth: (24 + (58 - 24) * zoom) * Math.PI / 180,
      elevation: (6 + (18 - 6) * zoom) * Math.PI / 180,
    });
    assert.deepEqual(getPrismViewAngles(zoom, { yaw: NaN, pitch: Infinity }), getPrismViewAngles(zoom));
    near(getPrismViewAngles(zoom, { yaw: -600, pitch: -450 }).azimuth, -75 * Math.PI / 180);
    near(getPrismViewAngles(zoom, { yaw: -600, pitch: -450 }).elevation, -60 * Math.PI / 180);
    near(getPrismViewAngles(zoom, { yaw: 600, pitch: 450 }).azimuth, 75 * Math.PI / 180);
    near(getPrismViewAngles(zoom, { yaw: 600, pitch: 450 }).elevation, 60 * Math.PI / 180);
    assert.equal(getPrismViewAngles(zoom, { yaw: 20 }).elevation, getPrismViewAngles(zoom).elevation);
    assert.equal(getPrismViewAngles(zoom, { pitch: 20 }).azimuth, getPrismViewAngles(zoom).azimuth);
  }
  for (const zoom of [NaN, Infinity, -Infinity, -5]) assert.deepEqual(getPrismViewAngles(zoom), getPrismViewAngles(0));
  assert.deepEqual(getPrismViewAngles(5), getPrismViewAngles(1));
});

test('shared view angles exactly match camera geometry throughout the view controls', () => {
  for (const zoom of [0, 0.3, 1]) for (const yaw of [-60, -30, 0, 30, 60]) for (const pitch of [-45, -20, 0, 20, 45]) {
    const view = { yaw, pitch };
    const { azimuth, elevation } = getPrismViewAngles(zoom, view);
    const { direction, right, up } = getPrismGeometry({ ...defaults, zoom, view }).camera;
    assert.deepEqual(direction, [Math.cos(azimuth) * Math.cos(elevation), -Math.sin(elevation), -Math.sin(azimuth) * Math.cos(elevation)]);
    assert.deepEqual(right, [Math.sin(azimuth), 0, Math.cos(azimuth)]);
    assert.deepEqual(up, [Math.cos(azimuth) * Math.sin(elevation), Math.cos(elevation), -Math.sin(azimuth) * Math.sin(elevation)]);
  }
});

test('view controls rotate an orthonormal camera without moving panes or changing navigation', () => {
  const original = getPrismGeometry(defaults);
  for (const yaw of [-60, -30, 0, 30, 60]) for (const pitch of [-45, -20, 0, 20, 45]) {
    const options = { ...defaults, view: { yaw, pitch } };
    const geometry = getPrismGeometry(options);
    assert.equal(geometry.length, original.length);
    assert.equal(geometry.spacing, original.spacing);
    for (const index of [0, 25, 49]) assert.deepEqual(geometry.positionAt(index), original.positionAt(index));
    const { direction, right, up } = geometry.camera;
    for (const axis of [direction, right, up]) near(dot(axis, axis), 1);
    near(dot(direction, right), 0); near(dot(direction, up), 0); near(dot(right, up), 0);
    assert.ok(direction[0] > 0, 'orbit cannot cross behind the panes');
    const traversed = getPrismGeometry({ ...options, focus: 26.5 });
    assert.deepEqual(traversed.camera.direction, direction);
    near(traversed.camera.position[0] - geometry.camera.position[0], geometry.spacing * 1.5);
    near(traversed.camera.position[1], geometry.camera.position[1]);
    near(traversed.camera.position[2], geometry.camera.position[2]);
  }
});

test('every angle control step responds throughout close and overview ranges', () => {
  for (const zoom of [0, 0.5, 1]) for (const axis of ['yaw', 'pitch']) {
    const limit = axis === 'yaw' ? 60 : 45;
    let previous;
    for (let angle = -limit; angle <= limit; angle += 5) {
      const geometry = getPrismGeometry({ ...defaults, zoom, view: { [axis]: angle } });
      const direction = geometry.camera.direction;
      const effective = axis === 'yaw' ? Math.atan2(-direction[2], direction[0]) : Math.asin(-direction[1]);
      if (previous !== undefined) assert.ok(effective > previous, `${axis} slider responds at ${angle}, zoom ${zoom}`);
      previous = effective;
    }
  }
});

test('rotated overviews fit all volume corners and pane corners retain their prism boundaries', () => {
  for (const [width, height] of [[1440, 900], [390, 844], [844, 390]]) {
    for (const count of [0, 1, 40, 10000]) for (const yaw of [-60, -30, 0, 30, 60]) for (const pitch of [-45, 0, 45]) {
      const geometry = getPrismGeometry({ count, focus: Math.floor(count / 2), zoom: 1, width, height, view: { yaw, pitch } });
      for (const x of [0, geometry.length]) for (const y of [0, geometry.paneHeight]) for (const z of [-geometry.paneWidth / 2, geometry.paneWidth / 2]) {
        const point = project(geometry, [x, y, z], width, height);
        assert.ok(Object.values(point).every(Number.isFinite));
        assert.ok(point.depth > 0);
        assert.ok(point.x >= 0 && point.x <= width && point.y >= 0 && point.y <= height,
          `rotated volume fits ${width}×${height}: ${JSON.stringify({ count, yaw, pitch, point })}`);
      }
      if (count < 2) continue;
      for (const y of [0, geometry.paneHeight]) for (const z of [-geometry.paneWidth / 2, geometry.paneWidth / 2]) {
        const from = project(geometry, [0, y, z], width, height);
        const to = project(geometry, [geometry.length, y, z], width, height);
        const length = Math.hypot(to.x - from.x, to.y - from.y);
        for (const index of [0, Math.floor(count / 2), count - 1]) {
          const corner = project(geometry, [geometry.positionAt(index)[0], y, z], width, height);
          const distance = Math.abs((to.x - from.x) * (from.y - corner.y) - (from.x - corner.x) * (to.y - from.y)) / length;
          near(distance, 0, 1e-6);
        }
      }
    }
  }
});
