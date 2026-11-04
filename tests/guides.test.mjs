import test from 'node:test';
import assert from 'node:assert/strict';
import { getPrismGeometry, visibleIndices } from '../packages/core/dist/index.js';
import { createPrismGuides, drawPrismGuides, projectPrismPoint, projectPrismSegment } from '../packages/dom/dist/guides.js';

const near = (actual, expected, epsilon = 1e-7) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} ≈ ${expected}`);
const viewport = { width: 1200, height: 700 };
const geometryFor = (options = {}) => getPrismGeometry({ count: 10000, focus: 5000, zoom: 1, ...viewport, ...options });

// A minimal SVG document tests structure without adding a DOM dependency to the library.
class SVGNode {
  constructor(name, ownerDocument) { this.tagName = name; this.ownerDocument = ownerDocument; this.children = []; this.attributes = new Map(); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
}
const svgDocument = { createElementNS(namespace, name) {
  assert.equal(namespace, 'http://www.w3.org/2000/svg');
  return new SVGNode(name, this);
} };
const makeSVG = () => svgDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
const allNodes = (node) => [node, ...node.children.flatMap(allNodes)];
const groupFor = (svg, name) => svg.children.find((node) => node.getAttribute('data-prismdeck-guide') === name);
const draw = (svg, options = {}, geometry = geometryFor()) => drawPrismGuides(svg, geometry, {
  ...viewport, prismLines: true, timelineRails: true, indices: visibleIndices(10000, 5000, 40, 1), focus: 5000, ...options,
});

test('world projection matches pane perspective and the ordered axis converges to its vanishing point', () => {
  const geometry = geometryFor();
  const { camera } = geometry;
  const target = [500, 150, 20];
  const point = projectPrismPoint(target, camera, viewport.width, viewport.height);
  const relative = target.map((value, index) => value - camera.position[index]);
  const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);
  near(point.x, viewport.width / 2 + dot(relative, camera.right) * camera.focalLength / dot(relative, camera.direction));
  near(point.y, viewport.height / 2 - dot(relative, camera.up) * camera.focalLength / dot(relative, camera.direction));
  const vanishingX = viewport.width / 2 + camera.right[0] * camera.focalLength / camera.direction[0];
  const vanishingY = viewport.height / 2 - camera.up[0] * camera.focalLength / camera.direction[0];
  for (const [y, z] of [[-24, -300], [324, 300]]) {
    const from = projectPrismPoint([0, y, z], camera, viewport.width, viewport.height);
    const to = projectPrismPoint([geometry.length, y, z], camera, viewport.width, viewport.height);
    // Both projected endpoints and the +X vanishing point lie on one line.
    const cross = (to.x - from.x) * (vanishingY - from.y) - (to.y - from.y) * (vanishingX - from.x);
    near(cross, 0, 1e-6);
  }
});

test('segment projection clips at the camera near plane and discards fully hidden segments', () => {
  const camera = { position: [0, 0, 0], direction: [1, 0, 0], right: [0, 0, 1], up: [0, 1, 0], focalLength: 100 };
  assert.equal(projectPrismPoint([-1, 2, 3], camera, 400, 300), null);
  assert.equal(projectPrismSegment([-10, 0, 0], [0, 1, 1], camera, 400, 300), null);
  const segment = projectPrismSegment([-1, 0, 0], [3, 4, 6], camera, 400, 300);
  assert.deepEqual(segment[0], { x: 500, y: -50, depth: 1 });
  near(segment[1].x, 400); near(segment[1].y, 50 / 3); near(segment[1].depth, 3);
  const reversed = projectPrismSegment([3, 4, 6], [-1, 0, 0], camera, 400, 300);
  assert.deepEqual(reversed, [...segment].reverse());
  for (const point of segment) assert.ok(Object.values(point).every(Number.isFinite));
});

test('the finite prism has twelve edges and independently switchable rails', () => {
  const svg = makeSVG();
  draw(svg, { timelineRails: false });
  assert.equal(svg.children.length, 1);
  assert.equal(groupFor(svg, 'prism').children.length, 12);
  assert.equal(groupFor(svg, 'rails'), undefined);
  for (const line of groupFor(svg, 'prism').children) {
    assert.equal(line.tagName, 'line');
    for (const attribute of ['x1', 'y1', 'x2', 'y2']) assert.ok(Number.isFinite(Number(line.getAttribute(attribute))));
  }
  draw(svg, { prismLines: false });
  assert.equal(groupFor(svg, 'prism'), undefined);
  assert.ok(groupFor(svg, 'rails').children.some((line) => line.getAttribute('class') === 'prismdeck-guide-focus'));
  draw(svg, { prismLines: false, timelineRails: false });
  assert.equal(svg.children.length, 0);
});

test('rail markers stay bounded by rendered indices and include one focused marker', () => {
  const svg = makeSVG();
  const indices = visibleIndices(10000, 5000, 40, 1);
  draw(svg, { indices: [...indices, ...indices] });
  const lines = groupFor(svg, 'rails').children;
  assert.equal(lines.filter((line) => line.getAttribute('class') === 'prismdeck-guide-rail').length, 2);
  assert.equal(lines.filter((line) => line.getAttribute('class') === 'prismdeck-guide-tick').length, (indices.length - 1) * 2);
  const focused = lines.filter((line) => line.getAttribute('class') === 'prismdeck-guide-focus');
  assert.equal(focused.length, 1);
  assert.equal(focused[0].getAttribute('data-prismdeck-index'), '5000');
  assert.ok(allNodes(svg).length < 100);
  draw(svg, { focus: 5001, indices: [0, 9999] });
  assert.equal(groupFor(svg, 'rails').children.length, 7);
});

test('empty decks clear previous geometry, and singleton collections retain a finite volume', () => {
  const svg = makeSVG();
  draw(svg);
  draw(svg, { focus: -1, indices: [] }, geometryFor({ count: 0, focus: -1 }));
  assert.equal(svg.children.length, 0);
  draw(svg, { focus: 0, indices: [0] }, geometryFor({ count: 1, focus: 0 }));
  assert.equal(groupFor(svg, 'prism').children.length, 12);
  assert.equal(groupFor(svg, 'rails').children.length, 3);
  draw(svg, { indices: [] });
  assert.equal(svg.children.length, 0);
});

test('multiple guides use no shared IDs and never intercept pane input', () => {
  const originalDocument = globalThis.document;
  globalThis.document = svgDocument;
  try {
    const first = createPrismGuides(), second = createPrismGuides();
    draw(first); draw(second);
    assert.notEqual(first, second);
    for (const svg of [first, second]) {
      assert.equal(svg.getAttribute('pointer-events'), 'none');
      assert.equal(svg.getAttribute('aria-hidden'), 'true');
      assert.equal(svg.getAttribute('focusable'), 'false');
      assert.equal(svg.getAttribute('overflow'), 'hidden');
      assert.ok(allNodes(svg).every((node) => node.getAttribute('id') === null));
    }
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});
