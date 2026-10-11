import assert from "node:assert/strict";
import test from "node:test";
import { compileFieldFadeInstruction } from "../src/compiler/field-fade.js";
import {
  DEVELOPMENT_TRANSPARENT_FADE,
  FieldFadeState,
  fieldFadeOverlay,
  type FadeColor,
  type FieldFadeInitial,
  type FieldFadeOp,
} from "../src/core/field-fade.js";

const black: FadeColor = { r: 0, g: 0, b: 0, a: 1 };
function seed(alpha = 0): FieldFadeInitial {
  return {
    imageColor: { ...black },
    rendererColor: { r: 1, g: 1, b: 1, a: alpha },
    raycastTarget: alpha !== 0,
  };
}
function op(
  direction: "in" | "out",
  seconds: number,
  color: FadeColor | null = { ...black },
): FieldFadeOp {
  return {
    kind: "field-fade",
    direction,
    seconds: Math.fround(seconds),
    color,
  };
}
function raw(mnemonic: string, seconds: number, rgba = [0, 0, 0, 255]) {
  return {
    type: 1,
    mnemonic,
    operands: {
      iValues: [...rgba, 0, 0, 0, 0],
      rValues: [seconds, 0, 0, 0, 0, 0, 0, 0],
      sValues: Array(8).fill(""),
    },
  };
}

test("source RGBA and signed duration are converted to float32 without discarding alpha", () => {
  assert.deepEqual(
    compileFieldFadeInstruction(raw("FadeOut", -0.7, [200, 60, 60, 128])),
    {
      kind: "field-fade",
      direction: "out",
      seconds: Math.fround(-0.7),
      color: {
        r: Math.fround(200 / 255),
        g: Math.fround(60 / 255),
        b: Math.fround(60 / 255),
        a: Math.fround(128 / 255),
      },
    },
  );
});
test("nullable source color stays null and short source sandbox operands are supported", () => {
  assert.deepEqual(
    compileFieldFadeInstruction({
      type: 1,
      mnemonic: "FadeIn",
      operands: { rValues: [0.3] },
    }),
    {
      kind: "field-fade",
      direction: "in",
      seconds: Math.fround(0.3),
      color: null,
    },
  );
  assert.equal(
    compileFieldFadeInstruction({
      type: 1,
      mnemonic: "FadeOut",
      operands: { iValues: [255, 0, 0, 128] },
    }).seconds,
    0,
  );
});
test("unknown operands and source alpha355 are rejected rather than silently clamped", () => {
  for (const mutate of [
    (r: ReturnType<typeof raw>) => {
      r.type = 2;
    },
    (r: ReturnType<typeof raw>) => {
      r.mnemonic = "ColorFade";
    },
    (r: ReturnType<typeof raw>) => {
      r.operands.iValues[3] = 355;
    },
    (r: ReturnType<typeof raw>) => {
      r.operands.iValues[4] = 1;
    },
    (r: ReturnType<typeof raw>) => {
      r.operands.iValues = [0, 0, 0];
    },
    (r: ReturnType<typeof raw>) => {
      r.operands.rValues[1] = 1;
    },
    (r: ReturnType<typeof raw>) => {
      r.operands.rValues[0] = 1e40;
    },
    (r: ReturnType<typeof raw>) => {
      r.operands.sValues[0] = "unknown";
    },
  ]) {
    const instruction = raw("FadeIn", 0.7);
    mutate(instruction);
    assert.throws(() => compileFieldFadeInstruction(instruction));
  }
});
test("negative underflow becomes native negative zero and is synchronous", () => {
  const instruction = compileFieldFadeInstruction(raw("FadeOut", -1e-50));
  assert.ok(Object.is(instruction.seconds, -0));
  assert.equal(new FieldFadeState(seed()).start(instruction), "wait");
});
test("missing initial host stays unknown and cannot invent a black or transparent starting point", () => {
  const owner = new FieldFadeState(null);
  assert.equal(owner.projection, null);
  assert.equal(owner.active, false);
  assert.throws(() => owner.start(op("in", -1)), /Unknown initial/);
  assert.throws(() => owner.poll("in"), /Unknown initial/);
  assert.equal(owner.snapshot(), null);
  assert.equal(FieldFadeState.restore(null).known, false);
});
test("nonnegative zero duration waits once although its first sample is already complete", () => {
  const owner = new FieldFadeState(seed());
  assert.equal(owner.start(op("out", 0)), "wait");
  assert.equal(owner.active, false);
  assert.equal(owner.poll("out"), "next");
  assert.equal(owner.projection!.rendererColor.a, 1);
  assert.equal(owner.projection!.raycastTarget, true);
});
test("negative duration starts its first scaled sample and returns immediately", () => {
  const owner = new FieldFadeState(seed(1));
  assert.equal(owner.start(op("in", -1), 0.25), "next");
  assert.equal(owner.projection!.rendererColor.a, 0.75);
  assert.equal(owner.active, true);
  assert.equal(owner.poll("in"), "wait");
});
test("completion observes real alpha before the coroutine's final resume", () => {
  const owner = new FieldFadeState(seed(1));
  assert.equal(owner.start(op("in", 1), 0.5), "wait");
  owner.advance(0.5);
  assert.equal(owner.poll("in"), "next");
  assert.equal(owner.active, true);
  assert.throws(() => FieldFadeState.restore(owner.snapshot()), /active/);
  owner.advance(0);
  assert.equal(owner.active, false);
  assert.deepEqual(owner.projection!.rendererColor, { r: 1, g: 1, b: 1, a: 0 });
  assert.equal(owner.projection!.raycastTarget, false);
});
test("an interrupted fade begins at the current alpha, not a fixed zero or one", () => {
  const owner = new FieldFadeState(seed());
  owner.start(op("out", -1), 0.5);
  assert.equal(owner.projection!.rendererColor.a, 0.5);
  owner.start(op("in", -1), 0.25);
  assert.equal(owner.projection!.rendererColor.a, 0.375);
});
test("older waiters follow current global image/renderer state after replacement", () => {
  const owner = new FieldFadeState(seed());
  owner.start(op("out", 1), 0.5);
  owner.start(op("in", -0.5), 0);
  owner.advance(0.5);
  owner.advance(0);
  assert.equal(owner.active, false);
  assert.equal(owner.poll("in"), "next");
  assert.equal(owner.poll("out"), "wait");
  owner.start(op("out", -1, { ...black, a: 0 }), 0);
  assert.equal(owner.poll("out"), "next");
});
test("nullable FadeIn retains image color while nullable FadeOut selects black", () => {
  const initial = seed(1);
  initial.imageColor = { r: 0, g: 0, b: 1, a: Math.fround(200 / 255) };
  const owner = new FieldFadeState(initial);
  owner.start(op("in", 0, null));
  assert.deepEqual(owner.projection!.imageColor, initial.imageColor);
  owner.start(op("out", 0, null));
  assert.deepEqual(owner.projection!.imageColor, black);
});
test("RGBA image color and canvas multiplier remain distinct throughout the fade", () => {
  const owner = new FieldFadeState(seed());
  owner.start(op("out", -1, { r: 0, g: 0, b: 1, a: 0.5 }), 0.5);
  assert.deepEqual(owner.projection!.imageColor, { r: 0, g: 0, b: 1, a: 0.5 });
  assert.deepEqual(owner.projection!.rendererColor, {
    r: 1,
    g: 1,
    b: 1,
    a: 0.25,
  });
});
test("equal alpha alone does not skip the full-color CrossFadeAlpha comparison", () => {
  const owner = new FieldFadeState(seed(0));
  owner.start(op("in", 1));
  assert.equal(owner.active, true);
  assert.equal(owner.poll("in"), "next");
  const blackCanvas = seed(0);
  blackCanvas.rendererColor = { ...black, a: 0 };
  const other = new FieldFadeState(blackCanvas);
  other.start(op("in", 1));
  assert.equal(other.active, false);
});
test("source float32 Lerp completion is not snapped to a different requested alpha", () => {
  const owner = new FieldFadeState(seed(Math.fround(1 / 255))),
    target = Math.fround(3 / 255);
  owner.start(op("out", 0, { ...black, a: target }));
  assert.equal(owner.projection!.rendererColor.a, 0.011764705181121826);
  assert.notEqual(owner.projection!.rendererColor.a, target);
  assert.equal(owner.active, false);
  assert.equal(owner.poll("out"), "wait");
});
test("completion uses exact alpha equality and never an epsilon or elapsed-time estimate", () => {
  const owner = new FieldFadeState(seed(Math.fround(1e-40)));
  assert.equal(owner.poll("in"), "wait");
  owner.start(op("in", 1));
  owner.advance(0);
  assert.equal(owner.poll("in"), "wait");
});
test("manager zero-alpha cleanup preserves image color and resets only canvas color/raycast", () => {
  const initial = seed(0);
  initial.raycastTarget = true;
  initial.rendererColor = { r: 0.5, g: 0.25, b: 0, a: 0 };
  const owner = new FieldFadeState(initial);
  owner.advance(0);
  assert.deepEqual(owner.projection, {
    imageColor: black,
    rendererColor: { r: 1, g: 1, b: 1, a: 0 },
    raycastTarget: false,
  });
});
test("a failed start or invalid clock cannot cancel an existing fade", () => {
  const owner = new FieldFadeState(seed());
  owner.start(op("out", -1), 0.25);
  const before = owner.snapshot();
  assert.throws(() => owner.start(op("in", 1e40)));
  assert.throws(() => owner.start(op("in", 1, { ...black, a: 2 })));
  assert.throws(() => owner.advance(-1));
  assert.throws(() => owner.advance(Number.NaN));
  assert.deepEqual(owner.snapshot(), before);
});
test("forked map candidates retain active progress without mutating the published owner", () => {
  const owner = new FieldFadeState(seed());
  owner.start(op("out", -1), 0.25);
  const before = owner.snapshot(),
    candidate = owner.fork();
  candidate.advance(0.5);
  assert.equal(candidate.projection!.rendererColor.a, 0.75);
  assert.deepEqual(owner.snapshot(), before);
  const other = owner.fork();
  other.start(op("in", -1), 0.5);
  assert.equal(other.projection!.rendererColor.a, 0.125);
  assert.deepEqual(owner.snapshot(), before);
});
test("opaque settled screen survives stable JSON restore and seeds/snapshots cannot alias", () => {
  const initial = seed(),
    owner = new FieldFadeState(initial);
  initial.rendererColor.a = 1;
  assert.equal(owner.projection!.rendererColor.a, 0);
  owner.start(op("out", 0));
  const restored = FieldFadeState.restore(
    JSON.parse(JSON.stringify(owner.snapshot())),
  );
  assert.deepEqual(restored.snapshot(), owner.snapshot());
  assert.equal(restored.active, false);
  const exposed = restored.snapshot()!;
  exposed.rendererColor.a = 0;
  restored.projection!.imageColor.a = 0;
  assert.equal(restored.poll("out"), "next");
});
test("restore rejects malformed fields, invented versions, non-float32 and out-of-range colors", () => {
  const owner = new FieldFadeState(DEVELOPMENT_TRANSPARENT_FADE),
    valid = owner.snapshot()!;
  const invalid: unknown[] = [
    [],
    {},
    { ...valid, kind: "other" },
    { ...valid, extra: true },
    { ...valid, raycastTarget: 1 },
    { ...valid, imageColor: { ...black, a: 1.1 } },
    { ...valid, rendererColor: { ...black, a: 0.7 } },
    { ...valid, rendererColor: { ...black, a: Infinity } },
    { ...valid, tween: {} },
  ];
  for (const value of invalid)
    assert.throws(() => FieldFadeState.restore(value as typeof valid));
});

test("overlay rounds Color32 halves to even before applying the canvas multiplier", () => {
  const projection = seed(0.5);
  projection.imageColor = {
    r: Math.fround(2.5 / 255),
    g: Math.fround(3.5 / 255),
    b: 1,
    a: 0.5,
  };
  assert.deepEqual(fieldFadeOverlay(projection), {
    r: Math.fround(2 / 255),
    g: Math.fround(4 / 255),
    b: 1,
    a: Math.fround(Math.fround(128 / 255) * 0.5),
  });
  assert.equal(fieldFadeOverlay(null), null);
});
test("all source byte color identities survive the image quantization round trip", () => {
  const projection = seed(1);
  for (let byte = 0; byte < 256; byte++) {
    const value = Math.fround(byte / 255);
    projection.imageColor = { r: value, g: value, b: value, a: value };
    assert.deepEqual(fieldFadeOverlay(projection), projection.imageColor);
  }
});
