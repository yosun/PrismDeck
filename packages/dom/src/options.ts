export type PrismDeckVariant = 'A' | 'B';
export type PrismDeckSelectionMode = 'slide-out' | 'modal' | 'none';
export interface PrismDeckPresentationOptions {
  /** A: seamless extraction and guides. B: modal and a clean deck. */
  variant?: PrismDeckVariant;
  selectionMode?: PrismDeckSelectionMode;
  prismLines?: boolean;
  timelineRails?: boolean;
  /** Approximate time to settle, in milliseconds. Reduced motion always takes precedence. */
  transitionDuration?: number;
}
export const PRISMDECK_PRESETS = Object.freeze({
  A: Object.freeze({ selectionMode: 'slide-out' as const, prismLines: true, timelineRails: true }),
  B: Object.freeze({ selectionMode: 'modal' as const, prismLines: false, timelineRails: false }),
});
export function resolvePresentationOptions(options: PrismDeckPresentationOptions) {
  const variant = options.variant ?? 'A';
  const preset = PRISMDECK_PRESETS[variant];
  if (!preset) throw new RangeError('PrismDeck variant must be A or B.');
  const selectionMode = options.selectionMode ?? preset.selectionMode;
  if (!['slide-out', 'modal', 'none'].includes(selectionMode)) throw new RangeError('Unknown PrismDeck selection mode.');
  const transitionDuration = options.transitionDuration ?? 700;
  if (!Number.isFinite(transitionDuration) || transitionDuration < 0) throw new RangeError('Transition duration must be finite and nonnegative.');
  return { variant, selectionMode, prismLines: options.prismLines ?? preset.prismLines,
    timelineRails: options.timelineRails ?? preset.timelineRails, transitionDuration };
}

export type PrismDeckTheme = 'light' | 'dark' | 'system';
/** Resolve a neutral color scheme without user-agent detection or renderer dependencies. */
export function resolveTheme(theme: PrismDeckTheme = 'system', prefersDark = false): 'light' | 'dark' {
  if (!['light', 'dark', 'system'].includes(theme)) throw new RangeError('PrismDeck theme must be light, dark, or system.');
  return theme === 'system' ? prefersDark ? 'dark' : 'light' : theme;
}
