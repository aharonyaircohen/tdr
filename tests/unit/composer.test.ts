// Unit tests for the compact chat composer's auto-grow height function.
// Pure function under test: computeComposerHeight in src/lib/composer.ts.

import { describe, it, expect } from "vitest";
import {
  computeComposerHeight,
  DEFAULT_COMPOSER_OPTIONS,
} from "@/lib/composer";

describe("computeComposerHeight", () => {
  it("returns the minimum height for an empty composer", () => {
    const m = computeComposerHeight("", DEFAULT_COMPOSER_OPTIONS);
    expect(m.rows).toBe(1);
    expect(m.heightPx).toBe(DEFAULT_COMPOSER_OPTIONS.minHeightPx);
    expect(m.scrollable).toBe(false);
  });

  it("returns the minimum height for a short reply", () => {
    const m = computeComposerHeight("ok", DEFAULT_COMPOSER_OPTIONS);
    expect(m.heightPx).toBe(DEFAULT_COMPOSER_OPTIONS.minHeightPx);
    expect(m.scrollable).toBe(false);
  });

  it("grows linearly for short-to-medium replies", () => {
    const one = computeComposerHeight("hi");
    const two = computeComposerHeight("hi\nthere");
    const three = computeComposerHeight("hi\nthere\nfriend");
    // Each step should add roughly one line-height worth of pixels.
    expect(two.heightPx).toBeGreaterThan(one.heightPx);
    expect(three.heightPx).toBeGreaterThan(two.heightPx);
    // Grown height should stay well under the max.
    expect(three.heightPx).toBeLessThan(DEFAULT_COMPOSER_OPTIONS.maxHeightPx);
    expect(three.scrollable).toBe(false);
  });

  it("clamps to maxHeight and marks the composer scrollable past maxRows", () => {
    const tenLines = Array.from({ length: 12 }, (_, i) => `line ${i}`).join("\n");
    const m = computeComposerHeight(tenLines, DEFAULT_COMPOSER_OPTIONS);
    expect(m.heightPx).toBe(DEFAULT_COMPOSER_OPTIONS.maxHeightPx);
    expect(m.rows).toBe(DEFAULT_COMPOSER_OPTIONS.maxRows);
    expect(m.scrollable).toBe(true);
  });

  it("wraps long single-line replies into multiple rows", () => {
    const longSingleLine = "word ".repeat(80).trim();
    const m = computeComposerHeight(longSingleLine, DEFAULT_COMPOSER_OPTIONS);
    expect(m.rows).toBeGreaterThan(1);
    expect(m.heightPx).toBeGreaterThan(DEFAULT_COMPOSER_OPTIONS.minHeightPx);
  });

  it("collapses back down when the learner deletes text", () => {
    const long = "x".repeat(300);
    const mLong = computeComposerHeight(long, DEFAULT_COMPOSER_OPTIONS);
    const mShort = computeComposerHeight("done", DEFAULT_COMPOSER_OPTIONS);
    expect(mShort.heightPx).toBeLessThan(mLong.heightPx);
    expect(mShort.heightPx).toBe(DEFAULT_COMPOSER_OPTIONS.minHeightPx);
  });

  it("uses the provided options to override defaults", () => {
    const opts = {
      ...DEFAULT_COMPOSER_OPTIONS,
      minHeightPx: 32,
      maxHeightPx: 96,
      maxRows: 3,
      lineHeightPx: 18,
      verticalPaddingPx: 12,
    };
    expect(computeComposerHeight("", opts).heightPx).toBe(32);
    // 2 lines under maxRows: 12 + 2*18 = 48px (scrollable=false).
    const two = computeComposerHeight("a\nb", opts);
    expect(two.rows).toBe(2);
    expect(two.heightPx).toBe(48);
    expect(two.scrollable).toBe(false);
    // 5 lines exceeds maxRows, clamps to maxHeight and is scrollable.
    const five = computeComposerHeight("a\nb\nc\nd\ne", opts);
    expect(five.rows).toBe(3);
    expect(five.scrollable).toBe(true);
    expect(five.heightPx).toBe(opts.maxHeightPx);
    expect(five.heightPx).toBeLessThanOrEqual(opts.maxHeightPx);
  });
});
