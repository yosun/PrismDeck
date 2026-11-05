/** Renderer-independent state and geometry for ordered, parallel visual panes. */
export { getWalletLayout } from './wallet.ts';
export type { WalletLayout, WalletLayoutOptions, WalletPaneLayout } from './wallet.ts';

export type PrismKey = string | number;
export type PrismVector3 = [number, number, number];

/** Signed view controls; zero retains the default. Renderers map their ranges into safe camera angles. */
export interface ViewAngle {
  readonly yaw: number;
  readonly pitch: number;
}

export interface PrismAxis {
  label?: string;
  unit?: string;
}

export interface PrismAdapter<T> {
  getKey(item: T): PrismKey;
  /** Numeric coordinates are stably sorted; equal coordinates retain input order. */
  getPosition?(item: T, index: number): number;
  getLabel?(item: T, index: number): string;
}

export interface PrismSnapshot {
  /** The focused index, or -1 for an empty deck. */
  readonly focus: number;
  /** 0 is the close view; 1 is the compact overview. */
  readonly zoom: number;
  /** Viewing angle is independent of focus, selection, and density. */
  readonly view: ViewAngle;
  readonly selectedKey: PrismKey | null;
  readonly count: number;
  readonly revision: number;
}

export interface DeckControllerOptions<T> {
  items: readonly T[];
  getKey?: (item: T) => PrismKey;
  adapter?: PrismAdapter<T>;
  initialFocus?: number;
  initialZoom?: number;
  initialView?: Partial<ViewAngle>;
  onViewChange?: (view: ViewAngle) => void;
  onFocus?: (item: T, index: number) => void;
  onSelect?: (item: T, index: number) => void;
  axis?: PrismAxis;
}

export interface DeckController<T> {
  getSnapshot(): PrismSnapshot;
  getItems(): readonly T[];
  getPositions(): readonly number[];
  getKey(index: number): PrismKey | undefined;
  getLabel(index: number): string;
  focus(index: number): void;
  focusKey(key: PrismKey): void;
  move(delta: number): void;
  select(index?: number): void;
  dismiss(): void;
  setZoom(amount: number): void;
  setView(view: Partial<ViewAngle>): void;
  resetView(): void;
  setItems(items: readonly T[]): void;
  /** Refresh configuration without replacing the controller or its subscriptions. */
  configure(options: Partial<DeckControllerOptions<T>>): void;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

/** Naming aliases for integrations that prefer explicit deck prefixes. */
export type Axis = PrismAxis;
export type DeckSnapshot = PrismSnapshot;
export type DeckOptions<T> = DeckControllerOptions<T>;
export type PrismDeckSnapshot = PrismSnapshot;
export type PrismDeckController<T> = DeckController<T>;

export function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

/** Normalize renderer input without allowing invalid values into camera geometry. */
export function clampView(view: Partial<ViewAngle> = {}, fallback: ViewAngle = { yaw: 0, pitch: 0 }): ViewAngle {
  return {
    yaw: clamp(Number.isFinite(view.yaw) ? view.yaw! : fallback.yaw, -60, 60),
    pitch: clamp(Number.isFinite(view.pitch) ? view.pitch! : fallback.pitch, -45, 45),
  };
}

/** A logarithmic compression keeps density changes perceptually even. */
export function densityForZoom(zoom: number): number {
  return Math.exp(-2.12 * clamp(Number.isFinite(zoom) ? zoom : 0));
}

/** Spacing keeps the focused pane exposed in the close oblique view. */
export function prismSpacing(width: number, azimuth = 24 * Math.PI / 180): number {
  if (!Number.isFinite(width) || width <= 0) throw new RangeError('Prism width must be positive and finite.');
  if (!Number.isFinite(azimuth) || azimuth <= 0 || azimuth >= Math.PI / 2) {
    throw new RangeError('Prism azimuth must be between 0 and π/2 radians.');
  }
  return width / (2 * Math.tan(azimuth));
}

function defaultKey<T>(item: T, index: number): PrismKey {
  if (typeof item === 'string' || typeof item === 'number') return item;
  if (item && typeof item === 'object') {
    const candidate = item as { id?: unknown; key?: unknown };
    if (typeof candidate.id === 'string' || typeof candidate.id === 'number') return candidate.id;
    if (typeof candidate.key === 'string' || typeof candidate.key === 'number') return candidate.key;
  }
  return index;
}

interface DeckEntry<T> {
  item: T;
  key: PrismKey;
  position: number;
  originalIndex: number;
}

/**
 * A synchronous external store usable from vanilla DOM, React, Three.js, or XR.
 * It allocates no DOM nodes, timers, images, animation frames, or renderer objects.
 */
export function createDeckController<T>(initial: DeckControllerOptions<T>): DeckController<T> {
  let options = { ...initial };
  const listeners = new Set<() => void>();
  let disposed = false;

  function prepare(input: readonly T[], configuration = options): DeckEntry<T>[] {
    const seen = new Set<PrismKey>();
    const entries = input.map((item, index) => {
      const key = configuration.getKey ? configuration.getKey(item)
        : configuration.adapter ? configuration.adapter.getKey(item) : defaultKey(item, index);
      if ((typeof key !== 'string' && typeof key !== 'number') || (typeof key === 'number' && !Number.isFinite(key))) {
        throw new TypeError(`Pane key at index ${index} must be a string or finite number.`);
      }
      if (seen.has(key)) throw new Error(`Duplicate pane key: ${String(key)}.`);
      seen.add(key);
      const position = configuration.adapter?.getPosition ? configuration.adapter.getPosition(item, index) : index;
      if (!Number.isFinite(position)) throw new TypeError(`Pane position at index ${index} must be finite.`);
      return { item, key, position, originalIndex: index };
    });
    if (configuration.adapter?.getPosition) entries.sort((a, b) => a.position - b.position || a.originalIndex - b.originalIndex);
    return entries;
  }

  let entries = prepare(options.items);
  let items: readonly T[] = Object.freeze(entries.map((entry) => entry.item));
  let positions: readonly number[] = Object.freeze(entries.map((entry) => entry.position));
  let indices = new Map(entries.map((entry, index) => [entry.key, index]));
  const indexFor = (value: number, count = entries.length) => count ? clamp(Math.round(value), 0, count - 1) : -1;
  let snapshot: PrismSnapshot = Object.freeze({
    focus: indexFor(Number.isFinite(options.initialFocus) ? options.initialFocus! : 0),
    zoom: clamp(Number.isFinite(options.initialZoom) ? options.initialZoom! : 0),
    view: Object.freeze(clampView(options.initialView)),
    selectedKey: null,
    count: entries.length,
    revision: 0,
  });

  function publish(patch: Partial<Omit<PrismSnapshot, 'revision'>>): void {
    snapshot = Object.freeze({ ...snapshot, ...patch, revision: snapshot.revision + 1 });
    for (const listener of [...listeners]) listener();
  }

  function focus(index: number): void {
    if (disposed || !Number.isFinite(index) || !entries.length) return;
    const next = indexFor(index);
    if (next === snapshot.focus) return;
    publish({ focus: next });
    options.onFocus?.(entries[next].item, next);
  }

  function setView(view: Partial<ViewAngle>): void {
    if (disposed || (view.yaw !== undefined && !Number.isFinite(view.yaw))
      || (view.pitch !== undefined && !Number.isFinite(view.pitch))) return;
    const next = clampView(view, snapshot.view);
    if (next.yaw === snapshot.view.yaw && next.pitch === snapshot.view.pitch) return;
    const frozen = Object.freeze(next);
    publish({ view: frozen });
    options.onViewChange?.(frozen);
  }

  function configure(next: Partial<DeckControllerOptions<T>>): void {
    if (disposed) return;
    const candidate = { ...options, ...next };
    if (!('items' in next || 'getKey' in next || 'adapter' in next)) {
      options = candidate;
      return;
    }
    // Prepare against the candidate before committing any configuration or data.
    const replacement = prepare(candidate.items, candidate);
    const previousFocus = snapshot.focus;
    const focusedKey = entries[previousFocus]?.key;
    const retainedFocus = replacement.findIndex((entry) => entry.key === focusedKey);
    const nextFocus = retainedFocus >= 0 ? retainedFocus : indexFor(Math.max(0, previousFocus), replacement.length);
    const nextKey = replacement[nextFocus]?.key;
    const selectedKey = replacement.some((entry) => entry.key === snapshot.selectedKey) ? snapshot.selectedKey : null;
    options = candidate;
    entries = replacement;
    items = Object.freeze(entries.map((entry) => entry.item));
    positions = Object.freeze(entries.map((entry) => entry.position));
    indices = new Map(entries.map((entry, index) => [entry.key, index]));
    publish({ count: entries.length, focus: nextFocus, selectedKey });
    if (nextFocus >= 0 && (nextFocus !== previousFocus || nextKey !== focusedKey)) {
      options.onFocus?.(entries[nextFocus].item, nextFocus);
    }
  }

  return {
    getSnapshot: () => snapshot,
    getItems: () => items,
    getPositions: () => positions,
    getKey: (index) => entries[index]?.key,
    getLabel(index) {
      const entry = entries[index];
      return entry ? options.adapter?.getLabel?.(entry.item, index) ?? String(entry.key) : '';
    },
    focus,
    focusKey(key) {
      const index = indices.get(key);
      if (index !== undefined) focus(index);
    },
    move(delta) {
      if (Number.isFinite(delta)) focus(snapshot.focus + delta);
    },
    select(index = snapshot.focus) {
      if (disposed || !Number.isFinite(index) || !entries.length) return;
      const next = indexFor(index);
      const changedFocus = snapshot.focus !== next;
      const key = entries[next].key;
      if (changedFocus || snapshot.selectedKey !== key) publish({ focus: next, selectedKey: key });
      if (changedFocus) options.onFocus?.(entries[next].item, next);
      // Repeated activation is meaningful to application-defined actions.
      options.onSelect?.(entries[next].item, next);
    },
    dismiss() {
      if (!disposed && snapshot.selectedKey !== null) publish({ selectedKey: null });
    },
    setZoom(amount) {
      if (disposed || !Number.isFinite(amount)) return;
      const zoom = clamp(amount);
      if (zoom !== snapshot.zoom) publish({ zoom });
    },
    setView,
    resetView: () => setView({ yaw: 0, pitch: 0 }),
    setItems: (input) => configure({ items: input }),
    configure,
    subscribe(listener) {
      if (!disposed) listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    dispose() {
      disposed = true;
      listeners.clear();
    },
  };
}

export interface PrismGeometryOptions {
  count: number;
  focus: number;
  zoom: number;
  /** Viewport dimensions, in CSS pixels (or any consistent projection unit). */
  width: number;
  height: number;
  paneWidth?: number;
  paneHeight?: number;
  /** Sorted numeric coordinates. Gaps are normalized by the smallest positive gap. */
  positions?: readonly number[];
  /** User viewing-angle offsets, shared by DOM, React, and on-screen Three views. */
  view?: Partial<ViewAngle>;
}

export interface PrismCamera {
  position: PrismVector3;
  /** Unit direction from the camera toward the deck. */
  direction: PrismVector3;
  right: PrismVector3;
  up: PrismVector3;
  focalLength: number;
}

export interface PrismGeometry {
  spacing: number;
  length: number;
  camera: PrismCamera;
  positionAt(index: number): PrismVector3;
  paneWidth: number;
  paneHeight: number;
}

const lerp = (from: number, to: number, amount: number) => from + (to - from) * amount;
const dot = (a: PrismVector3, b: PrismVector3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const normalizedPositions = new WeakMap<readonly number[], readonly number[]>();

/**
 * Computes a fixed YZ cross-section and an oblique camera. Browsing translates the
 * camera along X; density zoom compresses only the ordered X coordinates.
 */
export function getPrismGeometry(options: PrismGeometryOptions): PrismGeometry {
  const { positions } = options;
  const count = Number.isFinite(options.count) ? Math.max(0, Math.floor(options.count)) : 0;
  const zoom = clamp(Number.isFinite(options.zoom) ? options.zoom : 0);
  const paneWidth = options.paneWidth ?? 300 * 16 / 9;
  const paneHeight = options.paneHeight ?? 300;
  if (!Number.isFinite(paneWidth) || paneWidth <= 0 || !Number.isFinite(paneHeight) || paneHeight <= 0) {
    throw new RangeError('Pane dimensions must be positive and finite.');
  }
  if (!Number.isFinite(options.width) || !Number.isFinite(options.height)) throw new RangeError('Viewport dimensions must be finite.');
  const width = Math.max(1, options.width);
  const height = Math.max(1, options.height);
  const aspect = width / height;
  const crossWidth = paneWidth + 80;
  const crossHeight = paneHeight + 48;
  // Overview is a compact volume even for very large collections: representative
  // render samples occupy roughly the same span as forty panes. At zoom zero the
  // original close spacing is unchanged, independent of collection size.
  const collectionCompression = Math.min(1, 40 / Math.max(1, count)) ** zoom;
  const spacing = prismSpacing(crossWidth) * densityForZoom(zoom) * collectionCompression;
  let normalized: readonly number[] | undefined;
  if (positions) {
    if (positions.length !== count) throw new RangeError('Positions must contain one coordinate per pane.');
    normalized = normalizedPositions.get(positions);
    if (!normalized) {
      let smallestGap = Infinity;
      for (let index = 0; index < count; index++) {
        if (!Number.isFinite(positions[index])) throw new TypeError('Pane coordinates must be finite.');
        if (index && positions[index] < positions[index - 1]) throw new RangeError('Pane coordinates must be sorted.');
        const gap = index ? positions[index] - positions[index - 1] : 0;
        if (gap > 0) smallestGap = Math.min(smallestGap, gap);
      }
      const unit = smallestGap === Infinity ? 1 : smallestGap;
      const origin = positions[0] ?? 0;
      normalized = positions.map((position) => (position - origin) / unit);
      // Mutable external arrays remain live; controller coordinates are frozen and
      // need only one validation/normalization pass across all animation frames.
      if (Object.isFrozen(positions)) normalizedPositions.set(positions, normalized);
    }
  }
  const coordinateAt = (index: number): number => {
    if (!count) return 0;
    const bounded = clamp(Number.isFinite(index) ? index : 0, 0, count - 1);
    if (!normalized) return bounded * spacing;
    const lower = Math.floor(bounded);
    return lerp(normalized[lower], normalized[Math.min(count - 1, lower + 1)], bounded - lower) * spacing;
  };
  const length = coordinateAt(count - 1);
  const view = clampView(options.view);
  // Map each half of the angle controls to the available orbit range. Additive
  // clamps would produce dead slider travel near the overview's wider azimuth.
  const angle = (base: number, offset: number, limit: number, inputLimit: number) =>
    base + offset / inputLimit * (offset < 0 ? limit + base : limit - base);
  const azimuth = angle(lerp(24, 58, zoom), view.yaw, 75, 60) * Math.PI / 180;
  const elevation = angle(lerp(6, 18, zoom), view.pitch, 60, 45) * Math.PI / 180;
  const direction: PrismVector3 = [Math.cos(azimuth) * Math.cos(elevation), -Math.sin(elevation), -Math.sin(azimuth) * Math.cos(elevation)];
  const right: PrismVector3 = [Math.sin(azimuth), 0, Math.cos(azimuth)];
  const up: PrismVector3 = [Math.cos(azimuth) * Math.sin(elevation), Math.cos(elevation), -Math.sin(azimuth) * Math.sin(elevation)];
  const tangent = Math.tan(42 * Math.PI / 360);
  const closeDistance = Math.max(paneHeight / (0.34 * 2 * tangent), crossWidth / (0.72 * 2 * tangent * aspect));
  let overviewDistance = closeDistance;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const corner: PrismVector3 = [sx * (length / 2 + 60), sy * crossHeight / 2, sz * crossWidth / 2];
    overviewDistance = Math.max(overviewDistance,
      Math.abs(dot(corner, right)) / (tangent * aspect * 0.78) - dot(corner, direction),
      Math.abs(dot(corner, up)) / (tangent * 0.7) - dot(corner, direction));
  }
  // Contract the collection before drawing the camera toward its global center.
  // A small wheel gesture must retain a readable focused pane in a 10k-item deck.
  const globalView = zoom ** 6;
  const distance = lerp(closeDistance, overviewDistance, globalView);
  const target: PrismVector3 = [lerp(coordinateAt(options.focus), length / 2, globalView), paneHeight / 2, 0];
  const camera: PrismCamera = {
    position: [target[0] - direction[0] * distance, target[1] - direction[1] * distance, target[2] - direction[2] * distance],
    direction, right, up,
    focalLength: height / (2 * tangent),
  };
  return { spacing, length, camera, positionAt: (index) => [coordinateAt(index), paneHeight / 2, 0], paneWidth, paneHeight };
}

/**
 * Bounded render candidates. Close views use a contiguous focus window; overviews
 * sample the complete collection while retaining the focus and nearest neighbors.
 * When the budget is below three, the focus takes priority over its neighbors.
 */
export function visibleIndices(count: number, focus: number, maxVisible = 40, zoom = 0): number[] {
  const total = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  const limit = Number.isFinite(maxVisible) ? Math.min(total, Math.max(0, Math.floor(maxVisible))) : Math.min(total, 40);
  if (!limit) return [];
  const center = clamp(Math.round(Number.isFinite(focus) ? focus : 0), 0, total - 1);
  if (total <= limit) return Array.from({ length: total }, (_, index) => index);
  if (zoom <= 0.6) {
    const start = clamp(center - Math.floor(limit / 2), 0, total - limit);
    return Array.from({ length: limit }, (_, index) => start + index);
  }
  const result = new Set<number>([center]);
  const add = (index: number) => { if (result.size < limit && index >= 0 && index < total) result.add(index); };
  add(center - 1);
  add(center + 1);
  const samples = limit - result.size;
  for (let index = 0; index < samples; index++) {
    add(samples === 1 ? (center < total / 2 ? total - 1 : 0) : Math.round(index * (total - 1) / (samples - 1)));
  }
  for (let offset = 2; result.size < limit; offset++) {
    add(center - offset);
    add(center + offset);
  }
  return [...result].sort((a, b) => a - b);
}
