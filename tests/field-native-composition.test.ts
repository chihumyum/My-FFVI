import test from "node:test";
import assert from "node:assert/strict";
import { fieldCharacterFragment, fieldTileFragment, blendFieldTransparent, fieldCompositionActorTextures,
  assertFieldCompositionRenderTargets, composeFieldNativePixels, fieldCompositionActorDepth, fieldCompositionTileDepth, fieldCompositionRound,
  validateFieldNativeComposition, type FieldCompositionColor, type FieldCompositionActorQuad, type FieldCompositionQuad } from "../src/core/field-native-composition.js";
import { compileFieldNativeComposition } from "../src/compiler/field-native-composition.js";
import { compileFieldActorView } from "../src/compiler/field-actor-view.js";
import { fieldActorFactoryFixture } from "./fixtures/field-actor-factory.js";

const red: FieldCompositionColor = [1, 0, 0, 1], clear: FieldCompositionColor = [0, 0, 0, 0];
function fragment(part: "body" | "head", normalizedV: number, first: FieldCompositionColor | null = null,
  second: FieldCompositionColor | null = null) {
  return fieldCharacterFragment({ sample: red, vertexAlpha: 1, normalizedV, part, first, second });
}
function fixture() {
  const f = fieldActorFactoryFixture(), prefix = "FINAL FANTASY VI_Data/StreamingAssets/aa/StandaloneWindows64/";
  f.sources.push({ file: prefix + "map_common_assets_all_320e510e7137e96ac91fe79e18fdd504.bundle",
    sha256: "c46413a1c208556af2ce202aab276e6ecefc54863229bbb77af38bb0f766233a" },
  { file: prefix + "shaders_assets_all_46e9e3032245a8a2ff9ff3236afcb55a.bundle",
    sha256: "56bebde18b58f95d3e4f9cd23e7e2c13e83892075606f1a85b5c92ac81ce1c6e" });
  f.tilemap.data.layers[0]!.layers.push(...["UpperLayer", "CeilLayer"].map((name) => ({ type: "tilelayer", name,
    width: 20, height: 16, data: Array(320).fill(0) })));
  const view = compileFieldActorView(f.sources, f.tilemap, f.mapPackage, f.map.mapRange);
  return { ...f, view, definition: compileFieldNativeComposition(f.sources, view, f.tilemap) };
}

test("source UV split is bottom-quarter body, top-three-quarter head, equal boundary survives both", () => {
  assert.deepEqual(fragment("body", 0), red); assert.equal(fragment("head", 0), null);
  assert.deepEqual(fragment("body", 0.25), red); assert.deepEqual(fragment("head", 0.25), red);
  assert.equal(fragment("body", 1), null); assert.deepEqual(fragment("head", 1), red);
  // Height 24 is a 6-pixel body; no implementation-specific eight-pixel crop.
  assert.deepEqual(Array.from({ length: 24 }, (_, row) => fragment("body", 1 - (row + 0.5) / 24) !== null),
    [...Array(18).fill(false), ...Array(6).fill(true)]);
});
test("head pre-render samples are sequential RGBA lerps; body ignores them", () => {
  const upper: FieldCompositionColor = [0, 1, 0, 0.5], ceil: FieldCompositionColor = [0, 0, 1, 0.5];
  assert.deepEqual(fragment("head", 0.5, upper), [0.5, 0.5, 0, 0.75]);
  assert.deepEqual(fragment("head", 0.5, upper, ceil), [0.25, 0.25, 0.5, 0.625]);
  assert.deepEqual(fragment("body", 0.1, upper, ceil), red);
  assert.deepEqual(fragment("head", 0.5, clear, clear), red);
});
test("transparent render target alpha follows native SrcAlpha blend, not Canvas source-over", () => {
  const a: FieldCompositionColor = [1, 0, 0, 0.5], background: FieldCompositionColor = [0, 0, 1, 0];
  assert.deepEqual(blendFieldTransparent(a, background), [0.5, 0, 0.5, 0.25]);
  assert.deepEqual(blendFieldTransparent(a, [0, 0, 0, 1]), [0.5, 0, 0, 0.75]);
});
test("opaque and transparent tile alpha tests preserve source inclusive 254/255 boundary", () => {
  for (const byte of [0, 1, 127, 253, 254, 255]) {
    const c: FieldCompositionColor = [0.2, 0.4, 0.6, byte / 255];
    assert.equal(fieldTileFragment(c, "opaque") !== null, byte >= 254);
    assert.equal(fieldTileFragment(c, "transparent") !== null, byte >= 1 && byte <= 254);
  }
  assert.equal(fieldCharacterFragment({ sample: red, vertexAlpha: 0, normalizedV: 0.5,
    part: "head", first: red, second: null }), null, "overlay cannot resurrect a discarded actor fragment");
});
test("source texture assignment uses native 9/10 and preserves existing empty layer presence", () => {
  const f = fixture(), d = f.definition;
  assert.ok(d.upperTexture && d.ceilTexture);
  assert.deepEqual(fieldCompositionActorTextures(d, 9), { first: d.upperTexture, second: d.ceilTexture });
  assert.deepEqual(fieldCompositionActorTextures(d, 10), { first: d.ceilTexture, second: null });
  for (const layer of [0, 8, 11, 12]) assert.deepEqual(fieldCompositionActorTextures(d, layer), { first: null, second: null });
  validateFieldNativeComposition(d, f.view);
  assertFieldCompositionRenderTargets(d);
});

test("nonempty upper RT is a separate capability and cannot be replaced by recovered pixel math", () => {
  const f = fixture(), changed = structuredClone(f.tilemap);
  Object.assign(changed.data.layers[0]!.layers[1]!, { width: 20, height: 16, data: [1, ...Array(319).fill(0)] });
  const view = compileFieldActorView(f.sources, changed, f.mapPackage, f.map.mapRange);
  const definition = compileFieldNativeComposition(f.sources, view, changed);
  assert.equal(definition.renderTargets.upper, "unresolved");
  assert.equal(definition.renderTargets.ceil, "clear-only");
  assert.throws(() => assertFieldCompositionRenderTargets(definition), /allocation and sampling/);
});
test("source actor row uses native +6 serial offset, minimum sprite Y, ties-to-even and CharaZOffset", () => {
  assert.deepEqual([-2.5, -1.5, -0.5, 0.5, 1.5, 2.5].map(fieldCompositionRound), [-2, -2, 0, 0, 2, 2]);
  const input = { position: { y: 8, z: 349 }, cameraY: 0, frameY: 0, clampTileSubY: 0, charaZOffset: 0.5 };
  assert.equal(fieldCompositionActorDepth(input), 348.5);
  assert.equal(fieldCompositionActorDepth({ ...input, frameY: 32 }), 348.5, "positive sprite Y does not move the depth row");
  assert.equal(fieldCompositionActorDepth({ ...input, frameY: -1 }), 346.5);
  assert.equal(fieldCompositionActorDepth({ ...input, cameraY: 0.5 }), 348.5, "-0.5 rounds to even zero");
  assert.equal(fieldCompositionActorDepth({ ...input, cameraY: 0.75 }), 346.5);
  assert.equal(fieldCompositionActorDepth({ ...input, cameraY: 0.75, clampTileSubY: 0.75 }), 348.5);
  assert.equal(fieldCompositionTileDepth({ layer: "BottomLayer", localRow: 7, mapHeight: 16, cameraY: 0 }), 350);
  assert.equal(fieldCompositionTileDepth({ layer: "GroundLayer", localRow: 7, mapHeight: 16, cameraY: 0 }), 250);
});

function image(bytes: number[]) { return { width: 1, height: 1, data: new Uint8ClampedArray(bytes) }; }
function quad(bytes: number[], depth: number): FieldCompositionQuad {
  return { image: image(bytes), source: { x: 0, y: 0, width: 1, height: 1 }, destination: { x: 0, y: 0, width: 1, height: 4 },
    flipX: false, flipY: false, diagonal: false, depth };
}
function actor(depth: number, overrides: Partial<FieldCompositionActorQuad> = {}): FieldCompositionActorQuad {
  return { ...quad([255, 0, 0, 255], depth), alpha: 1, first: null, second: null, ...overrides };
}
test("opaque source tile depth, not array order, occludes both body and head", () => {
  const scene = { width: 1, height: 4, tiles: [quad([0, 255, 0, 255], 5)], actors: [actor(10)] };
  assert.deepEqual([...composeFieldNativePixels(scene).data], Array(4).fill([0, 255, 0, 255]).flat());
  scene.actors = [actor(4)];
  assert.deepEqual([...composeFieldNativePixels(scene).data], Array(4).fill([255, 0, 0, 255]).flat());
});
test("head renders after transparent tiles and uses supplied RT, body retains transparent blend", () => {
  const result = composeFieldNativePixels({ width: 1, height: 4,
    tiles: [quad([0, 0, 255, 128], 5)], actors: [actor(10, { first: image([0, 0, 255, 128]) })] });
  // Source independent arithmetic: body RGB=(127,0,128), A=round((128/255)^2*255+127)=191.
  // Head replaces this pixel with one RT lerp, A=255+(128-255)*(128/255)=191.
  assert.deepEqual([...result.data], Array(4).fill([127, 0, 128, 191]).flat());
  const noTarget = composeFieldNativePixels({ width: 1, height: 4, tiles: [quad([0, 0, 255, 128], 5)], actors: [actor(10)] });
  assert.deepEqual([...noTarget.data.slice(0, 4)], [255, 0, 0, 255], "head is queue 2457, after tile 2456");
  assert.deepEqual([...noTarget.data.slice(12)], [127, 0, 128, 191]);
});
test("discarded actor pixels never write depth or resurrect from an overlay", () => {
  const result = composeFieldNativePixels({ width: 1, height: 4, tiles: [quad([0, 255, 0, 255], 10)],
    actors: [actor(5, { alpha: 0, first: image([255, 255, 255, 255]) })] });
  assert.deepEqual([...result.data], Array(4).fill([0, 255, 0, 255]).flat());
  assert.throws(() => composeFieldNativePixels({ width: 1, height: 4, tiles: [], actors: [actor(5, { flipY: true })] }), /UV/);
});
test("a prepared color attachment is preserved and receives exactly one native transparent blend", () => {
  const background = { width: 1, height: 4, data: new Uint8ClampedArray(Array(4).fill([9, 17, 27, 255]).flat()) };
  const result = composeFieldNativePixels({ width: 1, height: 4, background,
    tiles: [quad([0, 0, 255, 128], 5)], actors: [] });
  assert.deepEqual([...result.data], Array(4).fill([4, 8, 141, 191]).flat());
  assert.deepEqual([...background.data], Array(4).fill([9, 17, 27, 255]).flat());
  assert.throws(() => composeFieldNativePixels({ width: 1, height: 4, background: image([0, 0, 0, 0]),
    tiles: [], actors: [] }), /background dimensions/);
});
test("foreign map/shader and fabricated render targets fail ordinary composition qualification", () => {
  const f = fixture();
  assert.throws(() => compileFieldNativeComposition(f.sources.slice(0, -1), f.view, f.tilemap), /shader source/);
  const changed = structuredClone(f.tilemap); changed.data.width++;
  assert.throws(() => compileFieldNativeComposition(f.sources, f.view, changed), /bound actor view/);
  assert.throws(() => validateFieldNativeComposition({ ...f.definition, upperTexture: "arbitrary.png" }), /pre-render target/);
  assert.throws(() => fieldCharacterFragment({ sample: red, vertexAlpha: Number.NaN,
    normalizedV: 1, part: "head", first: null, second: null }), /shader input/);
});
