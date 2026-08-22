// Compact chat composer height computation.
// Pure functions so the auto-grow behaviour can be unit-tested without a DOM.

export type ComposerMetrics = {
  heightPx: number;
  scrollable: boolean;
};

export type ComposerOptions = {
  // Minimum height in px when the textarea is empty / single line.
  minHeightPx: number;
  // Maximum height in px before the textarea starts scrolling internally.
  maxHeightPx: number;
};

export const DEFAULT_COMPOSER_OPTIONS: ComposerOptions = {
  minHeightPx: 44,
  maxHeightPx: 200,
};

/**
 * Clamp the browser's measured textarea content height.
 *
 *  - Empty / short text → minHeight (single-line composer).
 *  - Wrapped content grows using the textarea's real rendered width.
 *  - Beyond `maxHeight` → clamp and let the textarea scroll.
 */
export function computeComposerHeight(
  measuredScrollHeightPx: number,
  opts: ComposerOptions = DEFAULT_COMPOSER_OPTIONS,
): ComposerMetrics {
  const naturalHeight = Math.max(opts.minHeightPx, measuredScrollHeightPx);
  const heightPx = Math.min(naturalHeight, opts.maxHeightPx);
  return { heightPx, scrollable: naturalHeight > opts.maxHeightPx };
}
