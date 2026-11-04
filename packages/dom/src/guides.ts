import type { PrismCamera, PrismGeometry, PrismVector3 } from '@prismdeck/core';

/** A projected world point, in the same CSS pixels as the pane renderer. */
export interface ProjectedPrismPoint { x: number; y: number; depth: number }
export interface PrismGuideOptions {
  width: number;
  height: number;
  prismLines: boolean;
  timelineRails: boolean;
  /** The bounded mounted-pane window, rather than every item in the collection. */
  indices: readonly number[];
  /** A negative focus indicates an empty deck. */
  focus: number;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const NEAR = 1;
type Point = readonly [number, number, number];
const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const relativeTo = (point: Point, camera: PrismCamera): PrismVector3 => [
  point[0] - camera.position[0], point[1] - camera.position[1], point[2] - camera.position[2],
];
const project = (relative: Point, depth: number, camera: PrismCamera, width: number, height: number): ProjectedPrismPoint => ({
  x: width / 2 + dot(relative, camera.right) * camera.focalLength / depth,
  y: height / 2 - dot(relative, camera.up) * camera.focalLength / depth,
  depth,
});

/** Perspective projection shared by guides and custom overlays; points behind the near plane are hidden. */
export function projectPrismPoint(point: Point, camera: PrismCamera, width: number, height: number): ProjectedPrismPoint | null {
  const relative = relativeTo(point, camera);
  const depth = dot(relative, camera.direction);
  return depth >= NEAR ? project(relative, depth, camera, width, height) : null;
}

/** Clip world-space segments before perspective division, so guides never flip behind the camera. */
export function projectPrismSegment(from: Point, to: Point, camera: PrismCamera, width: number, height: number): readonly [ProjectedPrismPoint, ProjectedPrismPoint] | null {
  let a = relativeTo(from, camera), b = relativeTo(to, camera);
  let depthA = dot(a, camera.direction), depthB = dot(b, camera.direction);
  if (depthA < NEAR && depthB < NEAR) return null;
  if (depthA < NEAR || depthB < NEAR) {
    const amount = (NEAR - depthA) / (depthB - depthA);
    const intersection: PrismVector3 = [
      a[0] + (b[0] - a[0]) * amount,
      a[1] + (b[1] - a[1]) * amount,
      a[2] + (b[2] - a[2]) * amount,
    ];
    if (depthA < NEAR) { a = intersection; depthA = NEAR; }
    else { b = intersection; depthB = NEAR; }
  }
  return [project(a, depthA, camera, width, height), project(b, depthB, camera, width, height)];
}

/** One inert SVG per deck; no global IDs, framework, canvas, or renderer dependency. */
export function createPrismGuides(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'prismdeck-guides');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('pointer-events', 'none');
  svg.setAttribute('overflow', 'hidden');
  svg.setAttribute('preserveAspectRatio', 'none');
  return svg;
}

/**
 * Draw finite, camera-aligned volume edges and an independent pair of axis rails.
 * Tick work is O(mounted panes); distant collection items never allocate markers.
 */
export function drawPrismGuides(svg: SVGSVGElement, geometry: PrismGeometry, options: PrismGuideOptions): void {
  const { width, height, prismLines, timelineRails, indices, focus } = options;
  svg.setAttribute('viewBox', `0 0 ${Math.max(1, width)} ${Math.max(1, height)}`);
  svg.replaceChildren();
  if (focus < 0 || !indices.length || (!prismLines && !timelineRails)) return;
  const document = svg.ownerDocument;
  const firstX = -60, lastX = geometry.length + 60;
  const bottom = -24, top = geometry.paneHeight + 24;
  const halfWidth = (geometry.paneWidth + 80) / 2;
  const group = (name: 'prism' | 'rails') => {
    const node = document.createElementNS(SVG_NS, 'g');
    node.setAttribute('data-prismdeck-guide', name);
    svg.append(node);
    return node;
  };
  const line = (parent: SVGGElement, from: Point, to: Point, className: string, index?: number) => {
    const points = projectPrismSegment(from, to, geometry.camera, width, height);
    if (!points) return;
    const node = document.createElementNS(SVG_NS, 'line');
    node.setAttribute('class', className);
    node.setAttribute('x1', String(points[0].x));
    node.setAttribute('y1', String(points[0].y));
    node.setAttribute('x2', String(points[1].x));
    node.setAttribute('y2', String(points[1].y));
    node.setAttribute('vector-effect', 'non-scaling-stroke');
    if (index !== undefined) node.setAttribute('data-prismdeck-index', String(index));
    parent.append(node);
  };
  if (prismLines) {
    const prism = group('prism');
    // Four receding edges and the four sides of each finite end face: twelve edges.
    for (const y of [bottom, top]) for (const z of [-halfWidth, halfWidth]) {
      line(prism, [firstX, y, z], [lastX, y, z], 'prismdeck-guide-line');
    }
    for (const x of [firstX, lastX]) {
      for (const y of [bottom, top]) line(prism, [x, y, -halfWidth], [x, y, halfWidth], 'prismdeck-guide-line');
      for (const z of [-halfWidth, halfWidth]) line(prism, [x, bottom, z], [x, top, z], 'prismdeck-guide-line');
    }
  }
  if (timelineRails) {
    const rails = group('rails');
    const floor = bottom - 8, railWidth = halfWidth + 14;
    for (const z of [-railWidth, railWidth]) line(rails, [firstX, floor, z], [lastX, floor, z], 'prismdeck-guide-rail');
    const ticks = new Set(indices.filter((index) => Number.isFinite(index) && index >= 0));
    ticks.delete(focus);
    for (const index of ticks) {
      const [x] = geometry.positionAt(index);
      for (const z of [-railWidth, railWidth]) line(rails, [x, floor, z - 7], [x, floor, z + 7], 'prismdeck-guide-tick', index);
    }
    if (Number.isFinite(focus)) {
      const [x] = geometry.positionAt(focus);
      line(rails, [x, floor, -railWidth - 8], [x, floor, railWidth + 8], 'prismdeck-guide-focus', focus);
    }
  }
}
