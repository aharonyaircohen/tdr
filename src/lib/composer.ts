// Compact chat composer height computation.
// Pure functions so the auto-grow behaviour can be unit-tested without a DOM.

export type ComposerMetrics = {
  rows: number;
  heightPx: number;
  scrollable: boolean;
};

export type ComposerOptions = {
  // Textarea's CSS line-height in px. Used to convert line count → height.
  lineHeightPx: number;
  // Vertical padding (top + bottom) on the textarea in px.
  verticalPaddingPx: number;
  // Minimum height in px when the textarea is empty / single line.
  minHeightPx: number;
  // Maximum height in px before the textarea starts scrolling internally.
  maxHeightPx: number;
  // Maximum lines we'll ever grow to before scrolling kicks in.
  maxRows: number;
};

export const DEFAULT_COMPOSER_OPTIONS: ComposerOptions = {
  lineHeightPx: 22,
  verticalPaddingPx: 16, // 8px top + 8px bottom from the .chat-input padding
  minHeightPx: 44, // ≈ two lines (room for placeholder + caret)
  maxHeightPx: 200,
  maxRows: 8,
};

/**
 * How tall should the composer textarea be for the given text?
 *
 *  - Empty / short text → minHeight (single-line composer).
 *  - Up to `maxRows` lines → grow linearly with `lineHeight`.
 *  - Beyond `maxRows` → clamp to `maxHeight` and let the textarea scroll.
 */
export function computeComposerHeight(
  text: string,
  opts: ComposerOptions = DEFAULT_COMPOSER_OPTIONS,
): ComposerMetrics {
  // Count "soft" lines: every newline is one line; wrap long lines at ~64
  // chars (a reasonable chat-input width). We deliberately keep this loose —
  // the textarea itself uses the real CSS width to wrap, so this is just a
  // good-enough estimate for the row count the browser will actually show.
  const hardLines = text.length === 0 ? 1 : text.split("\n").length;
  const wrapLines = text.split("\n").reduce((sum, line) => {
    return sum + Math.max(1, Math.ceil(line.length / 64));
  }, 0);
  const naturalRows = Math.max(hardLines, wrapLines);

  const rows = Math.min(naturalRows, opts.maxRows);
  const grownHeight =
    opts.verticalPaddingPx + rows * opts.lineHeightPx;
  const scrollable = naturalRows > opts.maxRows;
  const heightPx = scrollable ? opts.maxHeightPx : Math.max(opts.minHeightPx, grownHeight);
  return { rows, heightPx, scrollable };
}
