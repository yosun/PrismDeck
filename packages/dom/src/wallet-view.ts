import type { ViewAngle, WalletLayout } from '@prismdeck/core';

/** A camera-equivalent CSS transform of the complete wallet, including its pocket. */
export function getWalletView(layout: WalletLayout, view: ViewAngle, width: number, height: number) {
  const origin = [width / 2, height * 0.58] as const;
  const perspective = Math.max(width, height, 1) * 1.6;
  if (!view.yaw && !view.pitch) return {transform: 'none', scale: 1, perspective, origin};
  const yaw = view.yaw * Math.PI / 180, pitch = -view.pitch * Math.PI / 180;
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const margin = Math.min(16, width * 0.03, height * 0.03);
  let scale = 1;
  function point(x: number, y: number) {
    x -= origin[0]; y -= origin[1];
    const rx = cy * x, ry = cp * y + sp * sy * x, rz = sp * y - cp * sy * x;
    const limit = (coordinate: number, span: number) => {
      const denominator = coordinate * perspective + span * rz;
      if (denominator > 0) scale = Math.min(scale, span * perspective / denominator);
    };
    limit(rx, width - margin - origin[0]); limit(-rx, origin[0] - margin);
    limit(ry, height - margin - origin[1]); limit(-ry, origin[1] - margin);
    if (rz > 0) scale = Math.min(scale, (perspective - 1) / rz);
  }
  for (const pane of layout.panes) {
    const angle = pane.rotateZ * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
    for (const dx of [-1, 1]) for (const dy of [-1, 1]) {
      const x = dx * pane.width * pane.scale / 2, y = dy * pane.height * pane.scale / 2;
      point(pane.x + c * x - s * y, pane.y + s * x + c * y);
    }
  }
  for (const dx of [-1, 1]) for (const dy of [-1, 1]) point(layout.pocket.x + dx * layout.pocket.width / 2, layout.pocket.y + dy * layout.pocket.height / 2);
  scale = Math.max(0, Math.min(1, scale));
  return {transform: `rotateX(${-view.pitch}deg) rotateY(${view.yaw}deg) scale(${scale})`, scale, perspective, origin};
}
