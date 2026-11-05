import { getPlaneGrid } from '@prismdeck/core';

/** One cached SVG path on an actual 3D pane plane; never mounts content or images. */
export function createPlaneGrid() {
  const element = document.createElement('div');
  element.className = 'prismdeck-plane-grid'; element.hidden = true;
  element.setAttribute('aria-hidden', 'true');
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  const lines = document.createElementNS(ns, 'path'); lines.setAttribute('class', 'prismdeck-plane-grid-lines');
  const axes = document.createElementNS(ns, 'path'); axes.setAttribute('class', 'prismdeck-plane-grid-axes');
  svg.append(lines, axes); element.append(svg);
  let signature = '';
  let size = { width: 1, height: 1 };
  return { element,
    update(width: number, height: number, cellSize: number) {
      const next = `${width}/${height}/${cellSize}`;
      if (signature === next) return size;
      signature = next;
      const grid = getPlaneGrid(width, height, cellSize, 3);
      const halfWidth = Math.ceil(width * 1.5 / cellSize) * cellSize;
      const halfHeight = Math.ceil(height * 1.5 / cellSize) * cellSize;
      size = { width: halfWidth * 2, height: halfHeight * 2 };
      svg.setAttribute('viewBox', `${-halfWidth} ${-halfHeight} ${size.width} ${size.height}`);
      lines.setAttribute('d', grid.map(line => `M${line.from.x},${-line.from.y}L${line.to.x},${-line.to.y}`).join(''));
      axes.setAttribute('d', `M${-halfWidth},0H${halfWidth}M0,${-halfHeight}V${halfHeight}`);
      return size;
    },
  };
}
