export type PrismDeckVariant = 'A' | 'B' | 'C';
export type PrismDeckLayout = 'prism' | 'wallet';
export type PrismDeckSelectionMode = 'slide-out' | 'modal' | 'none';
export type PrismDeckPaneDrag = 'free' | 'horizontal' | 'vertical' | 'none';
export interface PrismDeckPresentationOptions {
  /** A: seamless prism. B: modal prism. C: an extended plane with a snap grid. */
  variant?: PrismDeckVariant;
  /** Alternative geometry, independent of selection presentation. */
  layout?: PrismDeckLayout;
  selectionMode?: PrismDeckSelectionMode;
  prismLines?: boolean;
  timelineRails?: boolean;
  /** Extend the selected pane's own 3D plane with a visible grid. */
  planeGrid?: boolean;
  /** Move the selected pane within its own plane; independent of camera rotation. */
  paneDrag?: PrismDeckPaneDrag;
  /** Snap user moves on release. Programmatic offsets remain exact. */
  snapToGrid?: boolean;
  /** Grid cell size in pane-world units, from 8 to 1024. */
  gridSize?: number;
  /** Approximate time to settle, in milliseconds. Reduced motion always takes precedence. */
  transitionDuration?: number;
}
export const PRISMDECK_PRESETS = Object.freeze({
  A: Object.freeze({ layout: 'prism' as const, selectionMode: 'slide-out' as const, prismLines: true, timelineRails: true, planeGrid: false, paneDrag: 'none' as const, snapToGrid: true, gridSize: 80 }),
  B: Object.freeze({ layout: 'prism' as const, selectionMode: 'modal' as const, prismLines: false, timelineRails: false, planeGrid: false, paneDrag: 'none' as const, snapToGrid: true, gridSize: 80 }),
  C: Object.freeze({ layout: 'prism' as const, selectionMode: 'slide-out' as const, prismLines: true, timelineRails: true, planeGrid: true, paneDrag: 'free' as const, snapToGrid: true, gridSize: 80 }),
});
export function resolvePresentationOptions(options: PrismDeckPresentationOptions) {
  const variant = options.variant ?? 'A';
  const preset = PRISMDECK_PRESETS[variant];
  if (!preset) throw new RangeError('PrismDeck variant must be A, B, or C.');
  const layout = options.layout ?? preset.layout;
  if (!['prism', 'wallet'].includes(layout)) throw new RangeError('Unknown PrismDeck layout.');
  const selectionMode = options.selectionMode ?? preset.selectionMode;
  if (!['slide-out', 'modal', 'none'].includes(selectionMode)) throw new RangeError('Unknown PrismDeck selection mode.');
  const transitionDuration = options.transitionDuration ?? 700;
  if (!Number.isFinite(transitionDuration) || transitionDuration < 0) throw new RangeError('Transition duration must be finite and nonnegative.');
  const paneDrag = options.paneDrag ?? preset.paneDrag;
  if (!['free', 'horizontal', 'vertical', 'none'].includes(paneDrag)) throw new RangeError('Pane drag must be free, horizontal, vertical, or none.');
  const gridSize = options.gridSize ?? preset.gridSize;
  if (!Number.isFinite(gridSize) || gridSize < 8 || gridSize > 1024) throw new RangeError('Grid size must be between 8 and 1024 pane-world units.');
  return { variant, layout, selectionMode, prismLines: options.prismLines ?? preset.prismLines,
    timelineRails: options.timelineRails ?? preset.timelineRails, transitionDuration,
    planeGrid: options.planeGrid ?? preset.planeGrid, paneDrag, snapToGrid: options.snapToGrid ?? preset.snapToGrid, gridSize };
}

export type PrismDeckTheme = 'light' | 'dark' | 'system';
/** Resolve a neutral color scheme without user-agent detection or renderer dependencies. */
export function resolveTheme(theme: PrismDeckTheme = 'system', prefersDark = false): 'light' | 'dark' {
  if (!['light', 'dark', 'system'].includes(theme)) throw new RangeError('PrismDeck theme must be light, dark, or system.');
  return theme === 'system' ? prefersDark ? 'dark' : 'light' : theme;
}
