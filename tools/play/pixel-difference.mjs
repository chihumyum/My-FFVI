// Shared by the browser PNG comparison and its arithmetic checks. No image
// normalization, rescaling, masks or baseline replacement can hide a change.
export function pixelDifference(expected, actual, width, height, limits) {
  if (expected.length !== width * height * 4 || actual.length !== expected.length)
    throw Error("Pixel dimensions differ");
  let differentPixels = 0,
    maxChannelDelta = 0,
    squaredError = 0,
    left = width,
    top = height,
    right = -1,
    bottom = -1;
  const difference = new Uint8ClampedArray(expected.length);
  for (let offset = 0; offset < expected.length; offset += 4) {
    let changed = false;
    for (let channel = 0; channel < 4; channel++) {
      const delta = Math.abs(actual[offset + channel] - expected[offset + channel]);
      maxChannelDelta = Math.max(maxChannelDelta, delta);
      squaredError += delta * delta;
      if (delta > limits.channelDelta) changed = true;
    }
    if (changed) {
      differentPixels++;
      const x = (offset / 4) % width,
        y = Math.floor(offset / 4 / width);
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
    difference[offset] = changed ? 255 : Math.round(expected[offset] * 0.25);
    difference[offset + 1] = changed ? 40 : Math.round(expected[offset + 1] * 0.25);
    difference[offset + 2] = changed ? 0 : Math.round(expected[offset + 2] * 0.25);
    difference[offset + 3] = 255;
  }
  return {
    passed: differentPixels <= limits.differentPixels,
    differentPixels,
    differentFraction: differentPixels / (width * height),
    maxChannelDelta,
    rmsChannelDelta: Math.sqrt(squaredError / expected.length),
    bounds: differentPixels ? { left, top, right, bottom } : null,
    difference,
  };
}
