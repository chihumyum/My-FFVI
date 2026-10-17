import test from "node:test";
import assert from "node:assert/strict";
import { compileFrameworkFieldPresentation } from "../src/compiler/framework-field-presentation.js";
import { compileFieldActorView } from "../src/compiler/field-actor-view.js";
import { hash } from "../src/compiler/content.js";
import { projectFieldActorView, validateFieldActorViewProjection } from "../src/core/field-actor-view.js";
import { ordinaryFieldCompositionRenderHost, validateFieldNativeComposition } from "../src/core/field-native-composition.js";
import { fieldActorFactoryFixture } from "./fixtures/field-actor-factory.js";

function fixture() {
  const source = fieldActorFactoryFixture();
  const tilemap = { source: source.tilemap.source, data: {
    width: 3, height: 2, tilewidth: 16, tileheight: 16, orientation: "orthogonal", layers: [
      { type: "group", name: "TileGroup", visible: true, opacity: 1, x: 0, y: 0,
        properties: [{ name: "backdrop", value: "#ff101010" as string | number }, { name: "body_threshold", value: 12 as string | number }],
        layers: ["GroundLayer", "UpperLayer", "CeilLayer"].map((name, index) => ({
          type: "tilelayer", name, visible: true, opacity: 1, x: 0, y: 0, width: 3, height: 2,
          data: index === 2 ? [0, 0, 0, 0, 0, 0] : [0, 0, 1, 0, 0, 0],
        })),
      },
    ],
  } };
  return { policy: "framework-ordinary-field-flat-v1" as const, sources: source.sources, tilemap,
    mapPackage: structuredClone(source.mapPackage), mapSize: { width: 3, height: 2 },
    mapRange: { x: 0, y: 0, width: 3, height: 2 },
    renderHost: ordinaryFieldCompositionRenderHost() };
}

test("ordinary flat presentation binds full source and preserves the strict compiler rejection", () => {
  const f = fixture(), before = structuredClone(f), compiled = compileFrameworkFieldPresentation(f);
  assert.equal(compiled.kind, "framework-ordinary-field-presentation-v1");
  assert.equal(compiled.view.policy, "framework-ordinary-field-flat-v1");
  assert.deepEqual(compiled.view.omissions, ["ordinary-group-materials"]);
  assert.deepEqual(compiled.view.backgrounds, []);
  assert.equal(compiled.view.sources[0]!.contentHash, hash(f.tilemap.data));
  assert.deepEqual(compiled.composition.layers, ["GroundLayer", "UpperLayer", "CeilLayer"]);
  assert.deepEqual(compiled.composition.renderTargets, { upper: "source-rendered", ceil: "clear-only" });
  validateFieldNativeComposition(compiled.composition, compiled.view);
  assert.deepEqual(f, before);
  assert.throws(() => compileFieldActorView(f.sources, f.tilemap, f.mapPackage, f.mapSize), /water\/group/);
  const projection = projectFieldActorView(compiled.view, 11)!;
  assert.equal(projection.kind, "framework-flat-field-view-projection-v1");
  validateFieldActorViewProjection(projection, compiled.view.contextId, 11);
  assert.equal(Object.hasOwn(projection, "water"), false);
});

test("changing a material declaration changes the entire bound context without changing geometry", () => {
  const f = fixture(), before = compileFrameworkFieldPresentation(f);
  f.tilemap.data.layers[0]!.properties[1]!.value = 13;
  const after = compileFrameworkFieldPresentation(f);
  assert.notEqual(after.view.contextId, before.view.contextId);
  assert.deepEqual(after.composition.layers, before.composition.layers);
  assert.throws(() => validateFieldActorViewProjection(projectFieldActorView(before.view, 9)!, after.view.contextId, 9), /projection/);
});

test("native crop is explicit and does not shrink or renumber full source tile cells", () => {
  const f = fixture(); f.mapRange = { x: 1, y: 1, width: 2, height: 1 };
  const before = structuredClone(f.tilemap), compiled = compileFrameworkFieldPresentation(f);
  assert.deepEqual(compiled.view.mapSize, { width: 2, height: 1 });
  assert.deepEqual(f.tilemap, before);
  assert.equal(compiled.view.sources[0]!.contentHash, hash(before.data));
  f.mapRange.x = 0;
  assert.notEqual(compileFrameworkFieldPresentation(f).view.contextId, compiled.view.contextId);
  f.mapRange = { x: 2, y: 1, width: 2, height: 1 };
  assert.throws(() => compileFrameworkFieldPresentation(f), /range/i);
});

test("foreign source packages and duplicate declarations do not acquire a presentation capability", () => {
  const f = fixture(); f.sources.pop();
  assert.throws(() => compileFrameworkFieldPresentation(f), /Foreign/);
  const g = fixture(); g.mapPackage.data.map[0]!.tilemap = "Other/tilemap";
  assert.throws(() => compileFrameworkFieldPresentation(g), /geometry/);
  const h = fixture(); h.sources.push(structuredClone(h.sources[0]!));
  assert.throws(() => compileFrameworkFieldPresentation(h), /manifest/);
  const i = fixture(); i.mapPackage.data.map.push(structuredClone(i.mapPackage.data.map[0]!));
  assert.throws(() => compileFrameworkFieldPresentation(i), /geometry/);
});

test("unknown materials, malformed properties and palettes remain explicit failures", () => {
  for (const value of ["collision", "water", "custom-unknown"]) {
    const f = fixture(); f.tilemap.data.layers[0]!.properties[1]!.name = value;
    assert.throws(() => compileFrameworkFieldPresentation(f), /group material/);
  }
  const f = fixture(); f.tilemap.data.layers[0]!.properties[1]!.value = -1;
  assert.throws(() => compileFrameworkFieldPresentation(f), /group material/);
  const g = fixture(); g.tilemap.data.layers[0]!.properties.push({ name: "body_threshold", value: 3 });
  assert.throws(() => compileFrameworkFieldPresentation(g), /Ambiguous/);
  const h = fixture(); h.mapPackage.data.texture.push({ name: "plain_pal_anim", asset: "plain_pal_anim" });
  assert.throws(() => compileFrameworkFieldPresentation(h), /palette/);
});

test("ordinary presentation does not grant changed cell scale, crop dimensions or transformed layers", () => {
  const mutations = [
    (f: ReturnType<typeof fixture>) => { f.tilemap.data.tilewidth = 32; },
    (f: ReturnType<typeof fixture>) => { f.mapSize.width = 4; },
    (f: ReturnType<typeof fixture>) => { f.tilemap.data.layers[0]!.x = 1; },
    (f: ReturnType<typeof fixture>) => { f.tilemap.data.layers[0]!.layers[0]!.y = 1; },
    (f: ReturnType<typeof fixture>) => { f.tilemap.data.layers[0]!.layers[0]!.opacity = 0.5; },
    (f: ReturnType<typeof fixture>) => { f.tilemap.data.layers[0]!.layers[0]!.visible = false; },
  ];
  for (const mutate of mutations) { const f = fixture(); mutate(f); assert.throws(() => compileFrameworkFieldPresentation(f)); }
});

test("source layer identity, full tile arrays and supported flip bits are checked", () => {
  const f = fixture(); f.tilemap.data.layers[0]!.layers[0]!.data.pop();
  assert.throws(() => compileFrameworkFieldPresentation(f), /tile cells/);
  const g = fixture(); g.tilemap.data.layers[0]!.layers[0]!.data[0] = 0x10000001;
  assert.throws(() => compileFrameworkFieldPresentation(g), /tile cells/);
  const h = fixture(); h.tilemap.data.layers[0]!.layers.push(structuredClone(h.tilemap.data.layers[0]!.layers[0]!));
  assert.throws(() => compileFrameworkFieldPresentation(h), /tile layer/);
  const i = fixture(); i.tilemap.data.layers[0]!.layers[0]!.name = "Collision";
  assert.throws(() => compileFrameworkFieldPresentation(i), /tile layer/);
  const j = fixture(); j.tilemap.data.layers[0]!.layers[0]!.data[0] = 0xe0000001;
  assert.doesNotThrow(() => compileFrameworkFieldPresentation(j));
});

test("backgrounds, missing layers and unbound render hosts cannot be silently discarded", () => {
  const f = fixture(); f.tilemap.data.layers[0]!.type = "imagelayer";
  assert.throws(() => compileFrameworkFieldPresentation(f), /group or background/);
  const g = fixture(); g.tilemap.data.layers[0]!.layers = [];
  assert.throws(() => compileFrameworkFieldPresentation(g), /Missing/);
  const h = fixture(); h.renderHost.sources[0]!.sha256 = "0".repeat(64);
  assert.throws(() => compileFrameworkFieldPresentation(h), /render-target/);
});

test("compiler output is isolated from both caller source and sibling view structures", () => {
  const f = fixture(), compiled = compileFrameworkFieldPresentation(f), before = structuredClone(compiled);
  f.tilemap.source.objectId = "5";
  f.renderHost.sources[0]!.objectId = "6";
  f.tilemap.data.layers.length = 0;
  assert.deepEqual(compiled, before);
  compiled.view.sources[0]!.source.objectId = "7";
  assert.deepEqual(compiled.composition, before.composition);
});
