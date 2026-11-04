/** Screen-space geometry for a shallow, fanned wallet of ordered panes. */
export interface WalletLayoutOptions {
  width: number;
  height: number;
  count: number;
  /** A fractional focus is supported while a renderer animates navigation. */
  focus: number;
  /** 0 is the close stack; 1 is a wider fan with smaller cards. */
  zoom: number;
  /** The renderer's bounded pane window; input order is preserved. */
  indices: readonly number[];
}

export interface WalletPaneLayout {
  index: number;
  /** Screen-space center, in CSS pixels. */
  x: number;
  y: number;
  /** Unscaled dimensions; wallet panes have a 16:9 aspect ratio. */
  width: number;
  height: number;
  /** Rotations in degrees, applied about the pane's center. */
  rotateZ: number;
  rotateY: number;
  scale: number;
  /** Zero: the screen-space layout needs no perspective projection. */
  depth: number;
  /** The focused pane is in front; successive neighbors sit behind it. */
  zIndex: number;
}

export interface WalletLayout {
  panes: WalletPaneLayout[];
  /** Decorative pocket center and dimensions, in CSS pixels. */
  pocket: { x: number; y: number; width: number; height: number };
}

const bound = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

/**
 * A renderer-independent alternative to the parallel-plane prism. Neighboring
 * cards fan from a lifted focus card, with a shallow pocket below the stack.
 * Rotated card bounds, rather than just their centers, fit the viewport. The
 * horizontal spread compresses before the cards shrink on narrow screens.
 */
export function getWalletLayout(options: WalletLayoutOptions): WalletLayout {
  if (!Number.isFinite(options.width) || !Number.isFinite(options.height)) {
    throw new RangeError('Viewport dimensions must be finite.');
  }
  const width = Math.max(1, options.width);
  const height = Math.max(1, options.height);
  const count = Number.isFinite(options.count) ? Math.max(0, Math.floor(options.count)) : 0;
  const focus = bound(Number.isFinite(options.focus) ? options.focus : 0, 0, Math.max(0, count - 1));
  const zoom = bound(Number.isFinite(options.zoom) ? options.zoom : 0, 0, 1);
  const margin = Math.min(24, width * 0.035, height * 0.035);
  const availableWidth = width - margin * 2;
  const availableHeight = height - margin * 2;
  const seen = new Set<number>();
  const indices = options.indices.filter((index) => {
    if (!Number.isInteger(index) || index < 0 || index >= count || seen.has(index)) return false;
    seen.add(index);
    return true;
  });
  const ordered = [...indices].sort((a, b) => a - b);

  // Rank spacing also handles a sparse, application-supplied render window.
  // Interpolation retains smooth movement when the focus is fractional.
  let focusRank = 0;
  if (ordered.length > 1) {
    if (focus >= ordered[ordered.length - 1]) focusRank = ordered.length - 1;
    else if (focus > ordered[0]) {
      const upper = ordered.findIndex((index) => index >= focus);
      focusRank = upper - 1 + (focus - ordered[upper - 1]) / (ordered[upper] - ordered[upper - 1]);
    }
  }
  const ranks = new Map(ordered.map((index, rank) => [index, rank]));
  const paneWidth = Math.min(430, Math.max(230, width * 0.48), availableWidth * 0.92);
  const paneHeight = paneWidth * 9 / 16;
  const scale = 1 - zoom * 0.14;
  const pocketWidth = Math.min(availableWidth * 0.88, paneWidth * 1.07);
  const pocketHeight = bound(paneHeight * 0.44, 44, 108);
  const cards = indices.map((index) => {
    const relative = (ranks.get(index) ?? 0) - focusRank;
    const rotateZ = bound(relative, -8, 8) * (2.6 + zoom * 1.3);
    const radians = rotateZ * Math.PI / 180;
    return {
      index, relative, rotateZ,
      y: paneHeight * (-0.4 + 0.33 * Math.min(1, Math.abs(relative) / 3)),
      halfWidth: (Math.abs(Math.cos(radians)) * paneWidth + Math.abs(Math.sin(radians)) * paneHeight) * scale / 2,
      halfHeight: (Math.abs(Math.sin(radians)) * paneWidth + Math.abs(Math.cos(radians)) * paneHeight) * scale / 2,
    };
  });
  let top = 0;
  let bottom = pocketHeight;
  let widest = pocketWidth;
  for (const card of cards) {
    top = Math.min(top, card.y - card.halfHeight);
    bottom = Math.max(bottom, card.y + card.halfHeight);
    widest = Math.max(widest, card.halfWidth * 2);
  }
  const fit = Math.min(1, availableHeight / (bottom - top), availableWidth / widest);
  const horizontalBounds = (step: number): [number, number] => {
    let left = -pocketWidth * fit / 2;
    let right = pocketWidth * fit / 2;
    for (const card of cards) {
      left = Math.min(left, card.relative * step - card.halfWidth * fit);
      right = Math.max(right, card.relative * step + card.halfWidth * fit);
    }
    return [left, right];
  };
  let low = 0;
  let high = paneWidth * (0.14 + zoom * 0.035) * fit;
  // Fit the fan by reducing spacing, preserving a readable focused card on mobile.
  for (let iteration = 0; iteration < 30; iteration++) {
    const candidate = (low + high) / 2;
    const [left, right] = horizontalBounds(candidate);
    if (right - left <= availableWidth) low = candidate;
    else high = candidate;
  }
  const [left, right] = horizontalBounds(low);
  const centerX = width / 2 - (left + right) / 2;
  const pocketTop = bound(height * 0.7 - pocketHeight * fit / 2,
    margin - top * fit, height - margin - bottom * fit);
  const frontToBack = [...cards].sort((a, b) => Math.abs(a.relative) - Math.abs(b.relative) || a.index - b.index);
  const layers = new Map(frontToBack.map((card, rank) => [card.index, cards.length - rank]));
  return {
    panes: cards.map((card) => ({
      index: card.index,
      x: centerX + card.relative * low,
      y: pocketTop + card.y * fit,
      width: paneWidth * fit,
      height: paneHeight * fit,
      rotateZ: card.rotateZ,
      rotateY: 0,
      scale,
      depth: 0,
      zIndex: layers.get(card.index) ?? 0,
    })),
    pocket: { x: centerX, y: pocketTop + pocketHeight * fit / 2, width: pocketWidth * fit, height: pocketHeight * fit },
  };
}
