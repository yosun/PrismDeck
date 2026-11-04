import test from 'node:test';
import assert from 'node:assert/strict';
import { getWalletLayout } from '../packages/core/dist/index.js';

const indicesAround = (count, focus, budget) => {
  const start = Math.max(0, Math.min(count - budget, Math.round(focus) - Math.floor(budget / 2)));
  return Array.from({ length: Math.min(count, budget) }, (_, index) => start + index);
};
const corners = (pane) => {
  const angle = pane.rotateZ * Math.PI / 180;
  return [-1, 1].flatMap((x) => [-1, 1].map((y) => [
    pane.x + (x * pane.width / 2 * Math.cos(angle) - y * pane.height / 2 * Math.sin(angle)) * pane.scale,
    pane.y + (x * pane.width / 2 * Math.sin(angle) + y * pane.height / 2 * Math.cos(angle)) * pane.scale,
  ]));
};
const contains = (pane, x, y) => {
  const angle = -pane.rotateZ * Math.PI / 180;
  const localX = ((x - pane.x) * Math.cos(angle) - (y - pane.y) * Math.sin(angle)) / pane.scale;
  const localY = ((x - pane.x) * Math.sin(angle) + (y - pane.y) * Math.cos(angle)) / pane.scale;
  return Math.abs(localX) < pane.width / 2 && Math.abs(localY) < pane.height / 2;
};

test('wallet preserves supplied order and exposes a shallow, front-facing focus card', () => {
  const options = { width: 1100, height: 600, count: 1000, focus: 500, zoom: 0, indices: indicesAround(1000, 500, 9) };
  const layout = getWalletLayout(options);
  assert.deepEqual(layout.panes.map((pane) => pane.index), options.indices);
  const focused = layout.panes.find((pane) => pane.index === options.focus);
  assert.equal(focused.width, 430);
  assert.equal(focused.rotateZ, 0);
  assert.equal(focused.y, Math.min(...layout.panes.map((pane) => pane.y)));
  assert.equal(focused.zIndex, Math.max(...layout.panes.map((pane) => pane.zIndex)));
  assert.ok(focused.y < layout.pocket.y);
  for (const pane of layout.panes) {
    assert.equal(pane.depth, 0);
    assert.equal(pane.rotateY, 0);
    assert.ok(Math.abs(pane.width / pane.height - 16 / 9) < 1e-10);
  }
  assert.deepEqual(getWalletLayout(options), layout);
});

test('rotated wallet corners and pocket stay inside desktop, mobile, and short viewports', () => {
  for (const [width, height] of [[1100, 600], [374, 540], [320, 400], [844, 280], [160, 120], [1, 1]]) {
    for (const count of [0, 1, 4, 10000]) for (const zoom of [0, 0.5, 1]) {
      for (const focus of [0, Math.floor(count / 2), Math.max(0, count - 1)]) {
        const options = { width, height, count, zoom, focus, indices: indicesAround(count, focus, zoom === 1 ? 17 : 9) };
        const layout = getWalletLayout(options);
        for (const pane of layout.panes) for (const [x, y] of corners(pane)) {
          assert.ok(Number.isFinite(x) && Number.isFinite(y));
          assert.ok(x >= -1e-7 && x <= width + 1e-7, `${width} × ${height}, ${count} panes, focus ${focus}: x ${x}`);
          assert.ok(y >= -1e-7 && y <= height + 1e-7, `${width} × ${height}, ${count} panes, focus ${focus}: y ${y}`);
        }
        const { pocket } = layout;
        assert.ok(pocket.x - pocket.width / 2 >= -1e-7);
        assert.ok(pocket.x + pocket.width / 2 <= width + 1e-7);
        assert.ok(pocket.y - pocket.height / 2 >= -1e-7);
        assert.ok(pocket.y + pocket.height / 2 <= height + 1e-7);
      }
    }
  }
});

test('neighboring wallet panes retain an exposed clickable strip even at either end', () => {
  for (const [width, height] of [[1100, 600], [374, 540]]) for (const zoom of [0, 1]) {
    for (const focus of [0, 500, 999]) {
      const { panes } = getWalletLayout({ width, height, count: 1000, focus, zoom, indices: indicesAround(1000, focus, zoom ? 17 : 9) });
      for (const pane of panes) {
        let exposed = false;
        const rotation = pane.rotateZ * Math.PI / 180;
        // Sample actual interior card edges, not just a potentially empty AABB.
        for (const x of [-0.49, 0, 0.49]) for (const y of [-0.49, -0.25, 0]) {
          const screenX = pane.x + (x * pane.width * Math.cos(rotation) - y * pane.height * Math.sin(rotation)) * pane.scale;
          const screenY = pane.y + (x * pane.width * Math.sin(rotation) + y * pane.height * Math.cos(rotation)) * pane.scale;
          if (!panes.some((above) => above.zIndex > pane.zIndex && contains(above, screenX, screenY))) exposed = true;
        }
        assert.ok(exposed, `${width}, zoom ${zoom}, focus ${focus}: pane ${pane.index} has a clickable strip`);
      }
    }
  }
});

test('zoom opens the fan and fractional focus moves continuously without changing order', () => {
  const options = { width: 1100, height: 600, count: 100, focus: 50, zoom: 0, indices: indicesAround(100, 50, 9) };
  const close = getWalletLayout(options);
  const overview = getWalletLayout({ ...options, zoom: 1 });
  assert.ok(overview.panes[0].scale < close.panes[0].scale);
  assert.ok(overview.panes.at(-1).x - overview.panes[0].x > close.panes.at(-1).x - close.panes[0].x);
  assert.ok(Math.abs(overview.panes[0].rotateZ) > Math.abs(close.panes[0].rotateZ));
  const next = getWalletLayout({ ...options, focus: 50.001 });
  assert.deepEqual(next.panes.map((pane) => pane.index), options.indices);
  for (let index = 0; index < close.panes.length; index++) {
    assert.ok(Math.abs(next.panes[index].x - close.panes[index].x) < 1);
    assert.ok(Math.abs(next.panes[index].y - close.panes[index].y) < 1);
  }
  const mobile = getWalletLayout({ ...options, width: 374, height: 540 });
  assert.equal(mobile.panes.find((pane) => pane.index === 50).width, 230);
});

test('empty, sparse, and invalid input windows are safe and do not mutate the caller', () => {
  const options = { width: 800, height: 500, count: 100, focus: 50, zoom: 0, indices: Object.freeze([99, 0, 50]) };
  assert.deepEqual(getWalletLayout(options).panes.map((pane) => pane.index), [99, 0, 50]);
  assert.deepEqual(getWalletLayout({ ...options, indices: [50, 50, -1, 100, 1.5, NaN] }).panes.map((pane) => pane.index), [50]);
  assert.deepEqual(getWalletLayout({ ...options, count: 0 }).panes, []);
  assert.deepEqual(getWalletLayout({ ...options, count: NaN }).panes, []);
  const invalid = getWalletLayout({ ...options, focus: NaN, zoom: NaN });
  assert.ok(invalid.panes.every((pane) => Number.isFinite(pane.x) && Number.isFinite(pane.y)));
  assert.throws(() => getWalletLayout({ ...options, width: Infinity }), /finite/);
  assert.throws(() => getWalletLayout({ ...options, height: NaN }), /finite/);
});
