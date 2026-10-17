import test from "node:test";
import assert from "node:assert/strict";
import { pixelDifference } from "./pixel-difference.mjs";

test("visual comparison detects a small missing actor without resizing or normalizing pixels", () => {
  const width = 320,
    height = 180,
    expected = new Uint8Array(width * height * 4).fill(255),
    actual = expected.slice(),
    limits = { channelDelta: 8, differentPixels: 32 };
  for (let y = 50; y < 74; y++) for (let x = 100; x < 116; x++) actual[(y * width + x) * 4] = 0;
  const result = pixelDifference(expected, actual, width, height, limits);
  assert.equal(result.passed, false);
  assert.equal(result.differentPixels, 16 * 24);
  assert.deepEqual(result.bounds, { left: 100, top: 50, right: 115, bottom: 73 });
  assert.equal(result.maxChannelDelta, 255);
  assert.equal(pixelDifference(expected, expected, width, height, limits).differentPixels, 0);
  assert.throws(() => pixelDifference(expected, actual.slice(4), width, height, limits));
});

test("visual thresholds have exact inclusive boundaries and include alpha changes", () => {
  const expected = new Uint8Array(40 * 4),
    actual = expected.slice(),
    limits = { channelDelta: 8, differentPixels: 32 };
  actual.fill(8);
  assert.equal(pixelDifference(expected, actual, 40, 1, limits).differentPixels, 0);
  actual.fill(0);
  for (let n = 0; n < 32; n++) actual[n * 4 + 3] = 9;
  assert.equal(pixelDifference(expected, actual, 40, 1, limits).passed, true);
  actual[32 * 4 + 3] = 9;
  assert.equal(pixelDifference(expected, actual, 40, 1, limits).passed, false);
});
