import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeckController, densityForZoom, getPrismGeometry, prismSpacing, visibleIndices } from '../packages/core/dist/index.js';

const near = (actual, expected, epsilon = 1e-8) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} ≈ ${expected}`);
const dot = (a, b) => a.reduce((value, component, index) => value + component * b[index], 0);

test('store preserves input order, exposes stable snapshots, and separates focus from selection', () => {
  const focus = [], select = [];
  const controller = createDeckController({ items: ['c', 'a', 'b'], onFocus: (item, index) => focus.push([item, index]), onSelect: (item, index) => select.push([item, index]) });
  const original = controller.getSnapshot();
  assert.equal(original, controller.getSnapshot());
  assert.deepEqual(controller.getItems(), ['c', 'a', 'b']);
  assert.deepEqual(focus, []);
  let changes = 0;
  const unsubscribe = controller.subscribe(() => changes++);
  controller.focus(0);
  assert.equal(controller.getSnapshot(), original);
  controller.move(1);
  assert.deepEqual(focus, [['a', 1]]);
  assert.deepEqual(select, []);
  controller.select();
  controller.select();
  assert.deepEqual(select, [['a', 1], ['a', 1]]);
  assert.equal(controller.getSnapshot().selectedKey, 'a');
  assert.equal(changes, 2);
  controller.dismiss();
  assert.equal(controller.getSnapshot().selectedKey, null);
  unsubscribe();
  controller.setZoom(1);
  assert.equal(changes, 3);
});

test('numeric adapters stably sort without assuming dates or equal spacing', () => {
  const items = [{ id: 'c', position: 90 }, { id: 'b', position: 10 }, { id: 'a', position: 10 }];
  const controller = createDeckController({ items, adapter: { getKey: (item) => item.id, getPosition: (item) => item.position, getLabel: (item) => `Version ${item.id}` } });
  assert.deepEqual(controller.getItems().map((item) => item.id), ['b', 'a', 'c']);
  assert.deepEqual(controller.getPositions(), [10, 10, 90]);
  assert.equal(controller.getPositions(), controller.getPositions());
  assert.equal(Object.isFrozen(controller.getPositions()), true);
  assert.equal(controller.getLabel(0), 'Version b');
  assert.equal(controller.getKey(2), 'c');
  assert.equal(controller.getLabel(99), '');
  assert.equal(controller.getKey(99), undefined);
});

test('item updates preserve identities and invalid replacements are atomic', () => {
  const focused = [];
  const controller = createDeckController({ items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], onFocus: (item) => focused.push(item.id) });
  controller.select(1);
  controller.setItems([{ id: 'c' }, { id: 'a' }, { id: 'b' }]);
  assert.equal(controller.getSnapshot().focus, 2);
  assert.equal(controller.getSnapshot().selectedKey, 'b');
  controller.setItems([{ id: 'a' }]);
  assert.equal(controller.getSnapshot().focus, 0);
  assert.equal(controller.getSnapshot().selectedKey, null);
  assert.deepEqual(focused, ['b', 'b', 'a']);
  const previous = controller.getSnapshot();
  assert.throws(() => controller.setItems([{ id: 'a' }, { id: 'a' }]), /Duplicate pane key/);
  assert.equal(controller.getSnapshot(), previous);
  assert.throws(() => createDeckController({ items: [NaN] }), /finite number/);
  assert.throws(() => createDeckController({ items: ['a'], adapter: { getKey: (item) => item, getPosition: () => NaN } }), /position.*finite/);
});

test('bounds, empty collections, invalid commands, and disposal are safe', () => {
  const controller = createDeckController({ items: ['a', 'b'], initialFocus: 100, initialZoom: -2 });
  assert.equal(controller.getSnapshot().focus, 1);
  assert.equal(controller.getSnapshot().zoom, 0);
  controller.focusKey('missing');
  controller.move(Infinity);
  controller.setZoom(NaN);
  assert.equal(controller.getSnapshot().revision, 0);
  controller.focus(-200);
  assert.equal(controller.getSnapshot().focus, 0);
  controller.setItems([]);
  assert.equal(controller.getSnapshot().focus, -1);
  controller.select();
  controller.move(1);
  assert.equal(controller.getSnapshot().selectedKey, null);
  controller.setItems(['c']);
  assert.equal(controller.getSnapshot().focus, 0);
  const snapshot = controller.getSnapshot();
  controller.dispose();
  controller.select();
  controller.focus(100);
  controller.setZoom(1);
  controller.setItems(['d']);
  assert.equal(controller.getSnapshot(), snapshot);
});

test('geometry translates the camera during traversal while pane poses remain fixed', () => {
  const options = { count: 50, focus: 10, zoom: 0, width: 1440, height: 900 };
  const before = getPrismGeometry(options);
  const after = getPrismGeometry({ ...options, focus: 11.5 });
  for (let index = 0; index < options.count; index++) assert.deepEqual(before.positionAt(index), after.positionAt(index));
  assert.deepEqual(before.camera.direction, after.camera.direction);
  near(after.camera.position[0] - before.camera.position[0], before.spacing * 1.5);
  near(after.camera.position[1], before.camera.position[1]);
  near(after.camera.position[2], before.camera.position[2]);
  near(dot(before.camera.right, before.camera.up), 0);
  near(dot(before.camera.direction, before.camera.up), 0);
  near(dot(before.camera.direction, before.camera.right), 0);
  near(dot(before.camera.direction, before.camera.direction), 1);
  assert.ok(densityForZoom(1) < densityForZoom(0));
  assert.throws(() => prismSpacing(0), /positive/);
});

test('overview fits finite collection corners on desktop, portrait, and landscape screens', () => {
  for (const [width, height] of [[1440, 900], [390, 844], [844, 390]]) {
    for (const count of [0, 1, 32, 10000]) {
      const geometry = getPrismGeometry({ count, focus: Math.floor(count / 2), zoom: 1, width, height });
      for (const x of [0, geometry.length]) for (const y of [0, geometry.paneHeight]) for (const z of [-geometry.paneWidth / 2, geometry.paneWidth / 2]) {
        const relative = [x - geometry.camera.position[0], y - geometry.camera.position[1], z - geometry.camera.position[2]];
        const depth = dot(relative, geometry.camera.direction);
        assert.ok(depth > 0);
        const screenX = width / 2 + dot(relative, geometry.camera.right) * geometry.camera.focalLength / depth;
        const screenY = height / 2 - dot(relative, geometry.camera.up) * geometry.camera.focalLength / depth;
        assert.ok(screenX >= 0 && screenX <= width, `${count} panes fit width ${width}: ${screenX}`);
        assert.ok(screenY >= 0 && screenY <= height, `${count} panes fit height ${height}: ${screenY}`);
      }
    }
  }
});

test('arbitrary numeric positions retain normalized gaps and interpolate fractional focus', () => {
  const geometry = getPrismGeometry({ count: 4, focus: 1.5, zoom: 0.2, width: 800, height: 600, positions: [-100, -90, -60, -60] });
  near(geometry.positionAt(1)[0], geometry.spacing);
  near(geometry.positionAt(2)[0], geometry.spacing * 4);
  near(geometry.positionAt(1.5)[0], geometry.spacing * 2.5);
  near(geometry.length, geometry.spacing * 4);
  assert.throws(() => getPrismGeometry({ count: 2, focus: 0, zoom: 0, width: 800, height: 600, positions: [1, 0] }), /sorted/);
  assert.throws(() => getPrismGeometry({ count: 2, focus: 0, zoom: 0, width: 800, height: 600, positions: [1] }), /one coordinate/);
});

test('visibility stays bounded for large collections and samples the entire overview', () => {
  for (const focus of [0, 4999, 9999]) {
    const close = visibleIndices(10000, focus, 40, 0);
    assert.equal(close.length, 40);
    assert.ok(close.includes(focus));
    assert.equal(close.at(-1) - close[0], 39);
    const overview = visibleIndices(10000, focus, 40, 1);
    assert.equal(overview.length, 40);
    assert.ok(overview.includes(focus));
    if (focus > 0) assert.ok(overview.includes(focus - 1));
    if (focus < 9999) assert.ok(overview.includes(focus + 1));
    assert.equal(overview[0], 0);
    assert.equal(overview.at(-1), 9999);
    assert.equal(new Set(overview).size, overview.length);
  }
  assert.deepEqual(visibleIndices(0, 0), []);
  assert.deepEqual(visibleIndices(1, 0), [0]);
  assert.deepEqual(visibleIndices(100, 50, 1, 1), [50]);
  assert.deepEqual(visibleIndices(100, 50, 0, 1), []);
});

test('frozen coordinates normalize once across animation frames while mutable coordinates stay live', () => {
  let reads = 0;
  const positions = new Proxy(Object.freeze([10, 20, 50]), {
    get(target, property, receiver) {
      if (typeof property === 'string' && /^\d+$/.test(property)) reads++;
      return Reflect.get(target, property, receiver);
    },
  });
  const options = { count: 3, focus: 1, zoom: 0.5, width: 800, height: 600, positions };
  getPrismGeometry(options);
  const firstPassReads = reads;
  getPrismGeometry({ ...options, focus: 1.5 });
  assert.ok(firstPassReads > 0);
  assert.equal(reads, firstPassReads);
  const mutable = [10, 20, 50];
  const before = getPrismGeometry({ ...options, positions: mutable });
  mutable[2] = 100;
  const after = getPrismGeometry({ ...options, positions: mutable });
  assert.ok(after.length > before.length);
});

test('configuration updates callbacks without reprocessing items and key changes stay atomic', () => {
  const events = [];
  let keyReads = 0;
  const items = [{ id: 'a', alternative: 'A', position: 30 }, { id: 'b', alternative: 'B', position: 10 }];
  const controller = createDeckController({ items, getKey(item) { keyReads++; return item.id; }, onSelect: () => events.push('old') });
  const firstSnapshot = controller.getSnapshot();
  controller.configure({ onSelect: (item) => events.push(`new ${item.id}`), onFocus: (item) => events.push(`focus ${item.id}`) });
  assert.equal(keyReads, 2);
  assert.equal(controller.getSnapshot(), firstSnapshot);
  controller.select(1);
  assert.deepEqual(events, ['focus b', 'new b']);
  controller.configure({ getKey: undefined, adapter: { getKey: (item) => item.alternative, getPosition: (item) => item.position, getLabel: (item) => `Version ${item.alternative}` } });
  assert.deepEqual(controller.getItems(), [items[1], items[0]]);
  assert.deepEqual(controller.getPositions(), [10, 30]);
  assert.equal(controller.getKey(0), 'B');
  assert.equal(controller.getLabel(0), 'Version B');
  const beforeFailure = controller.getSnapshot();
  assert.throws(() => controller.configure({ getKey: () => 'duplicate', onSelect: () => events.push('invalid') }), /Duplicate/);
  assert.equal(controller.getSnapshot(), beforeFailure);
  assert.equal(controller.getKey(0), 'B');
  controller.select(0);
  assert.equal(events.at(-1), 'new b');
});

test('large overviews retain a compact span and readable pane size', () => {
  const options = { focus: 0, zoom: 1, width: 1440, height: 900 };
  const compact = getPrismGeometry({ ...options, count: 40 });
  const large = getPrismGeometry({ ...options, count: 10000 });
  assert.ok(large.length / compact.length < 1.04);
  const project = (geometry, point) => {
    const relative = point.map((value, index) => value - geometry.camera.position[index]);
    const depth = dot(relative, geometry.camera.direction);
    return [options.width / 2 + dot(relative, geometry.camera.right) * geometry.camera.focalLength / depth,
      options.height / 2 - dot(relative, geometry.camera.up) * geometry.camera.focalLength / depth];
  };
  const projectedHeight = (geometry, index) => {
    const [x] = geometry.positionAt(index);
    return Math.abs(project(geometry, [x, 0, 0])[1] - project(geometry, [x, geometry.paneHeight, 0])[1]);
  };
  assert.ok(projectedHeight(large, 5000) > projectedHeight(compact, 20) * 0.9);
  assert.ok(projectedHeight(large, 5000) > 60);
  const close = getPrismGeometry({ ...options, count: 10000, zoom: 0 });
  near(close.spacing, prismSpacing(close.paneWidth + 80));
  for (const focus of [0, 5000, 9999]) {
    const slightZoom = getPrismGeometry({ ...options, count: 10000, focus, zoom: 0.15 });
    assert.ok(projectedHeight(slightZoom, focus) > projectedHeight(close, 0) * 0.8);
    const center = project(slightZoom, slightZoom.positionAt(focus));
    assert.ok(center[0] > 0 && center[0] < options.width);
  }
});
