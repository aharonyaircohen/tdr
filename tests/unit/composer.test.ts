// Unit tests for the compact chat composer's auto-grow height function.
// Pure function under test: computeComposerHeight in src/lib/composer.ts.

import { describe, it, expect } from "vitest";
import { computeComposerHeight, DEFAULT_COMPOSER_OPTIONS } from "@/lib/composer";

describe("computeComposerHeight", () => {
  it("returns the minimum height for an empty composer", () => {
    const m = computeComposerHeight(0, DEFAULT_COMPOSER_OPTIONS);
    expect(m.heightPx).toBe(DEFAULT_COMPOSER_OPTIONS.minHeightPx);
    expect(m.scrollable).toBe(false);
  });

  it("returns the minimum height for a short reply", () => {
    const m = computeComposerHeight(30, DEFAULT_COMPOSER_OPTIONS);
    expect(m.heightPx).toBe(DEFAULT_COMPOSER_OPTIONS.minHeightPx);
    expect(m.scrollable).toBe(false);
  });

  it("grows linearly for short-to-medium replies", () => {
    const one = computeComposerHeight(44);
    const two = computeComposerHeight(66);
    const three = computeComposerHeight(88);
    expect(two.heightPx).toBeGreaterThan(one.heightPx);
    expect(three.heightPx).toBeGreaterThan(two.heightPx);
    // Grown height should stay well under the max.
    expect(three.heightPx).toBeLessThan(DEFAULT_COMPOSER_OPTIONS.maxHeightPx);
    expect(three.scrollable).toBe(false);
  });

  it("clamps to maxHeight and marks the composer scrollable past maxRows", () => {
    const m = computeComposerHeight(400, DEFAULT_COMPOSER_OPTIONS);
    expect(m.heightPx).toBe(DEFAULT_COMPOSER_OPTIONS.maxHeightPx);
    expect(m.scrollable).toBe(true);
  });

  it("uses the browser's measured wrapped height", () => {
    const narrowViewportMeasurement = computeComposerHeight(132);
    expect(narrowViewportMeasurement.heightPx).toBe(132);
    expect(narrowViewportMeasurement.scrollable).toBe(false);
  });

  it("collapses back down when the learner deletes text", () => {
    const mLong = computeComposerHeight(180, DEFAULT_COMPOSER_OPTIONS);
    const mShort = computeComposerHeight(30, DEFAULT_COMPOSER_OPTIONS);
    expect(mShort.heightPx).toBeLessThan(mLong.heightPx);
    expect(mShort.heightPx).toBe(DEFAULT_COMPOSER_OPTIONS.minHeightPx);
  });

  it("uses the provided options to override defaults", () => {
    const opts = {
      ...DEFAULT_COMPOSER_OPTIONS,
      minHeightPx: 32,
      maxHeightPx: 96,
    };
    expect(computeComposerHeight(0, opts).heightPx).toBe(32);
    const two = computeComposerHeight(48, opts);
    expect(two.heightPx).toBe(48);
    expect(two.scrollable).toBe(false);
    const five = computeComposerHeight(120, opts);
    expect(five.scrollable).toBe(true);
    expect(five.heightPx).toBe(opts.maxHeightPx);
    expect(five.heightPx).toBeLessThanOrEqual(opts.maxHeightPx);
  });
});
