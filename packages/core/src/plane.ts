import type { PrismCamera } from './index.ts';

/** Coordinates in a pane's extended plane: x is world Z; y is world Y. */
export interface PaneOffset {
  x: number;
  y: number;
}

/** One grid segment in the pane's local coordinates, centered at its origin. */
export interface PlaneGridLine {
  from: PaneOffset;
  to: PaneOffset;
}

function positive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be positive and finite.`);
}

/**
 * Snap a displacement to the nearest cell without mutating its input. Half-cell
 * ties move away from zero, so dragging in opposite directions is symmetric.
 */
export function snapPaneOffset(offset: PaneOffset, gridSize: number): PaneOffset {
  positive(gridSize, 'Grid size');
  if (!Number.isFinite(offset.x) || !Number.isFinite(offset.y)) {
    throw new TypeError('Pane offsets must be finite.');
  }
  const snap = (value: number): number => {
    const steps = Math.abs(value) / gridSize;
    // A cell smaller than the input's representable precision cannot move it.
    if (!Number.isFinite(steps)) return value;
    const result = Math.sign(value) * Math.round(steps) * gridSize;
    if (!Number.isFinite(result)) throw new RangeError('Snapped pane offset must be finite.');
    return result === 0 ? 0 : result;
  };
  return { x: snap(offset.x), y: snap(offset.y) };
}

/**
 * Unproject a viewport-local pointer into the original pane's world-X plane.
 * Off-viewport points are allowed during captured drags. A parallel ray, a plane
 * behind the camera, or invalid projection input has no usable intersection.
 */
export function intersectPanePlane(
  point: PaneOffset,
  camera: PrismCamera,
  width: number,
  height: number,
  planeX: number,
): PaneOffset | null {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)
    || !Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0
    || !Number.isFinite(planeX) || !Number.isFinite(camera.focalLength) || camera.focalLength <= 0
    || ![camera.position, camera.direction, camera.right, camera.up].every((vector) => vector.every(Number.isFinite))) return null;
  const horizontal = (point.x - width / 2) / camera.focalLength;
  const vertical = (height / 2 - point.y) / camera.focalLength;
  const ray = camera.direction.map((value, axis) => value + camera.right[axis] * horizontal + camera.up[axis] * vertical);
  const magnitude = Math.hypot(...ray);
  if (!Number.isFinite(magnitude) || !magnitude || Math.abs(ray[0]) <= Number.EPSILON * 16 * magnitude) return null;
  const distance = (planeX - camera.position[0]) / ray[0];
  if (!Number.isFinite(distance) || distance <= 0) return null;
  const x = camera.position[2] + ray[2] * distance;
  const y = camera.position[1] + ray[1] * distance;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

/**
 * A finite snap grid centered on the pane origin. `span` multiplies the pane's
 * dimensions; bounds round outward to whole cells. The grid is limited to 4096
 * segments so an accidental tiny cell cannot allocate an unbounded scene.
 */
export function getPlaneGrid(paneWidth: number, paneHeight: number, cellSize: number, span = 3): PlaneGridLine[] {
  positive(paneWidth, 'Pane width');
  positive(paneHeight, 'Pane height');
  positive(cellSize, 'Cell size');
  positive(span, 'Grid span');
  const columns = Math.max(1, Math.ceil(paneWidth / cellSize * span / 2));
  const rows = Math.max(1, Math.ceil(paneHeight / cellSize * span / 2));
  if (!Number.isSafeInteger(columns) || !Number.isSafeInteger(rows) || (columns + rows) * 2 + 2 > 4096) {
    throw new RangeError('Plane grid must contain at most 4096 segments.');
  }
  const halfWidth = columns * cellSize;
  const halfHeight = rows * cellSize;
  if (!Number.isFinite(halfWidth) || !Number.isFinite(halfHeight)) throw new RangeError('Plane grid bounds must be finite.');
  const lines: PlaneGridLine[] = [];
  for (let column = -columns; column <= columns; column++) {
    const x = column === 0 ? 0 : column * cellSize;
    lines.push({ from: { x, y: -halfHeight }, to: { x, y: halfHeight } });
  }
  for (let row = -rows; row <= rows; row++) {
    const y = row === 0 ? 0 : row * cellSize;
    lines.push({ from: { x: -halfWidth, y }, to: { x: halfWidth, y } });
  }
  return lines;
}
