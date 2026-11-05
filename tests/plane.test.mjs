import test from 'node:test';
import assert from 'node:assert/strict';
import { getPlaneGrid, getPrismGeometry, intersectPanePlane, snapPaneOffset } from '../packages/core/dist/index.js';

const near = (actual, expected, epsilon = 1e-7) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} ≈ ${expected}`);
const dot = (left, right) => left.reduce((sum, value, axis) => sum + value * right[axis], 0);
const project = (point, camera, width, height) => {
  const relative = point.map((value, axis) => value - camera.position[axis]);
  const depth = dot(relative, camera.direction);
  return {
    x: width / 2 + dot(relative, camera.right) * camera.focalLength / depth,
    y: height / 2 - dot(relative, camera.up) * camera.focalLength / depth,
    depth,
  };
};

test('pane offsets snap horizontally, vertically, and diagonally in either direction', () => {
  for (const [input, expected] of [
    [{ x: 71, y: 0 }, { x: 80, y: 0 }],
    [{ x: -71, y: 0 }, { x: -80, y: 0 }],
    [{ x: 0, y: 71 }, { x: 0, y: 80 }],
    [{ x: 0, y: -71 }, { x: 0, y: -80 }],
    [{ x: 71, y: -31 }, { x: 80, y: -40 }],
    [{ x: -71, y: 31 }, { x: -80, y: 40 }],
    [{ x: -20, y: 20 }, { x: -40, y: 40 }],
    [{ x: -0, y: -19 }, { x: 0, y: 0 }],
  ]) {
    const original = { ...input };
    assert.deepEqual(snapPaneOffset(input, 40), expected);
    assert.deepEqual(input, original, 'snapping never mutates a caller-owned position');
  }
  const fractional = snapPaneOffset({ x: -0.34, y: 0.56 }, 0.1);
  near(fractional.x, -0.3); near(fractional.y, 0.6);
  assert.deepEqual(snapPaneOffset({ x: 1, y: -1 }, Number.MIN_VALUE), { x: 1, y: -1 });
});

test('invalid snapping commands fail atomically without modifying either coordinate', () => {
  for (const offset of [{ x: NaN, y: 30 }, { x: 30, y: Infinity }, { x: -Infinity, y: 30 }]) {
    const original = { ...offset };
    assert.throws(() => snapPaneOffset(offset, 40), TypeError);
    assert.deepEqual(offset, original);
  }
  const offset = Object.freeze({ x: -31, y: 61 });
  for (const size of [0, -10, NaN, Infinity, -Infinity]) assert.throws(() => snapPaneOffset(offset, size), RangeError);
  assert.deepEqual(offset, { x: -31, y: 61 });
});

test('plane ray intersections round-trip real prism projection across camera angles and density', () => {
  let checked = 0;
  for (const [width, height] of [[1200, 700], [390, 720]]) {
    for (const zoom of [0, 0.6, 1]) for (const yaw of [-60, -30, 0, 30, 60]) for (const pitch of [-45, 0, 45]) {
      const geometry = getPrismGeometry({ count: 31, focus: 15, width, height, zoom, view: { yaw, pitch } });
      for (const index of [14, 15, 16]) {
        const [planeX] = geometry.positionAt(index);
        for (const y of [-300, 0, 150, 600]) for (const z of [-900, -200, 0, 700]) {
          const screen = project([planeX, y, z], geometry.camera, width, height);
          const actual = intersectPanePlane(screen, geometry.camera, width, height, planeX);
          if (screen.depth <= 0) {
            assert.equal(actual, null, 'a projected point behind the camera cannot be dragged through the lens');
            continue;
          }
          assert.ok(actual, 'a finite visible point has a plane intersection');
          near(actual.x, z, 1e-6); near(actual.y, y, 1e-6);
          checked++;
        }
      }
    }
  }
  assert.ok(checked > 3000, 'exercise actual camera bases in both viewport shapes');
});

test('plane intersections support reversed cameras, captured drags beyond the viewport, and camera-side rejection', () => {
  const camera = { position: [10, 0, 0], direction: [-1, 0, 0], right: [0, 0, 1], up: [0, 1, 0], focalLength: 100 };
  assert.deepEqual(intersectPanePlane({ x: 200, y: 150 }, camera, 400, 300, 0), { x: 0, y: 0 });
  assert.deepEqual(intersectPanePlane({ x: 600, y: -150 }, camera, 400, 300, 0), { x: 40, y: 30 });
  assert.equal(intersectPanePlane({ x: 200, y: 150 }, camera, 400, 300, 20), null);
  assert.equal(intersectPanePlane({ x: 200, y: 150 }, camera, 400, 300, 10), null);
  const parallel = { ...camera, position: [0, 0, 0], direction: [0, 0, 1], right: [1, 0, 0] };
  assert.equal(intersectPanePlane({ x: 200, y: 150 }, parallel, 400, 300, 10), null);
  assert.deepEqual(intersectPanePlane({ x: 300, y: 150 }, parallel, 400, 300, 10), { x: 10, y: 0 });
});

test('invalid projection inputs return no intersection and preserve camera and pointer inputs', () => {
  const camera = { position: [0, 0, 0], direction: [1, 0, 0], right: [0, 0, 1], up: [0, 1, 0], focalLength: 100 };
  const point = Object.freeze({ x: 200, y: 150 });
  const original = structuredClone(camera);
  for (const width of [0, -1, NaN, Infinity]) assert.equal(intersectPanePlane(point, camera, width, 300, 10), null);
  for (const height of [0, -1, NaN, Infinity]) assert.equal(intersectPanePlane(point, camera, 400, height, 10), null);
  for (const planeX of [NaN, Infinity, -Infinity]) assert.equal(intersectPanePlane(point, camera, 400, 300, planeX), null);
  for (const focalLength of [0, -1, NaN, Infinity]) assert.equal(intersectPanePlane(point, { ...camera, focalLength }, 400, 300, 10), null);
  for (const member of ['position', 'direction', 'right', 'up']) {
    assert.equal(intersectPanePlane(point, { ...camera, [member]: [0, NaN, 0] }, 400, 300, 10), null);
  }
  for (const position of [{ x: NaN, y: 150 }, { x: 200, y: Infinity }]) assert.equal(intersectPanePlane(position, camera, 400, 300, 10), null);
  assert.deepEqual(camera, original);
  assert.deepEqual(point, { x: 200, y: 150 });
});

test('extended pane grids cover the requested dimensions with exact snap-cell intersections', () => {
  const lines = getPlaneGrid(300, 180, 40, 3);
  // Width 900 rounds to ±480; height 540 rounds to ±280.
  assert.equal(lines.length, 25 + 15);
  const vertical = lines.filter(({ from, to }) => from.x === to.x);
  const horizontal = lines.filter(({ from, to }) => from.y === to.y);
  assert.equal(vertical.length, 25); assert.equal(horizontal.length, 15);
  assert.deepEqual(vertical[0], { from: { x: -480, y: -280 }, to: { x: -480, y: 280 } });
  assert.deepEqual(vertical.at(-1), { from: { x: 480, y: -280 }, to: { x: 480, y: 280 } });
  assert.deepEqual(horizontal[0], { from: { x: -480, y: -280 }, to: { x: 480, y: -280 } });
  assert.deepEqual(horizontal.at(-1), { from: { x: -480, y: 280 }, to: { x: 480, y: 280 } });
  assert.equal(vertical.filter(({ from }) => from.x === 0).length, 1);
  assert.equal(horizontal.filter(({ from }) => from.y === 0).length, 1);
  for (const { from, to } of lines) {
    for (const coordinate of [from.x, from.y, to.x, to.y]) assert.equal(Math.abs(coordinate % 40), 0);
  }
  assert.deepEqual(getPlaneGrid(300, 180, 40), lines, 'three pane widths is the default extent');
  assert.ok(getPlaneGrid(300, 180, 40, 1).length < lines.length);
});

test('grid generation validates dimensions and bounds allocation for extreme configuration', () => {
  for (const invalid of [0, -1, NaN, Infinity, -Infinity]) {
    for (let argument = 0; argument < 4; argument++) {
      const options = [300, 180, 40, 3];
      options[argument] = invalid;
      assert.throws(() => getPlaneGrid(...options), RangeError);
    }
  }
  assert.throws(() => getPlaneGrid(300, 180, 0.001), /4096/);
  assert.throws(() => getPlaneGrid(Number.MAX_VALUE, 180, 40, 3), RangeError);
  assert.throws(() => getPlaneGrid(300, 180, Number.MIN_VALUE), RangeError);
  assert.ok(getPlaneGrid(300, 180, Number.MAX_VALUE).length === 6, 'large cells preserve a nonzero finite grid');
  assert.notEqual(getPlaneGrid(300, 180, 40)[0], getPlaneGrid(300, 180, 40)[0], 'no mutable shared grid state');
});
