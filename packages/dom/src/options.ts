export type PrismDeckVariant = 'A' | 'B' | 'C';
export type PrismDeckLayout = 'prism' | 'wallet';
export type PrismDeckSelectionMode = 'slide-out' | 'modal' | 'none';
export interface PrismDeckPresentationOptions {
  /** A: seamless prism. B: modal prism. C: a fanned wallet. */
  variant?: PrismDeckVariant;
  /** Alternative geometry, independent of selection presentation. */
  layout?: PrismDeckLayout;
  selectionMode?: PrismDeckSelectionMode;
  prismLines?: boolean;
  timelineRails?: boolean;
  /** Approximate time to settle, in milliseconds. Reduced motion always takes precedence. */
  transitionDuration?: number;
}
export const PRISMDECK_PRESETS = Object.freeze({
  A: Object.freeze({ layout: 'prism' as const, selectionMode: 'slide-out' as const, prismLines: true, timelineRails: true }),
  B: Object.freeze({ layout: 'prism' as const, selectionMode: 'modal' as const, prismLines: false, timelineRails: false }),
  C: Object.freeze({ layout: 'wallet' as const, selectionMode: 'slide-out' as const, prismLines: false, timelineRails: false }),
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
  return { variant, layout, selectionMode, prismLines: options.prismLines ?? preset.prismLines,
    timelineRails: options.timelineRails ?? preset.timelineRails, transitionDuration };
}

export type PrismDeckTheme = 'light' | 'dark' | 'system';
/** Resolve a neutral color scheme without user-agent detection or renderer dependencies. */
export function resolveTheme(theme: PrismDeckTheme = 'system', prefersDark = false): 'light' | 'dark' {
  if (!['light', 'dark', 'system'].includes(theme)) throw new RangeError('PrismDeck theme must be light, dark, or system.');
  return theme === 'system' ? prefersDark ? 'dark' : 'light' : theme;
}
