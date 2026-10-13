import test from "node:test";
import assert from "node:assert/strict";
import { compileFrameworkWorldPresentation } from "../src/compiler/framework-world-presentation.js";
import { compileFieldActorView } from "../src/compiler/field-actor-view.js";
import { hash } from "../src/compiler/content.js";
import { projectFieldActorView, validateFieldActorView, validateFieldActorViewProjection } from "../src/core/field-actor-view.js";
import { ordinaryFieldCompositionRenderHost, validateFieldNativeComposition } from "../src/core/field-native-composition.js";
import { fieldActorFactoryFixture } from "./fixtures/field-actor-factory.js";

function fixture() {
  const f = fieldActorFactoryFixture(), sha256 = "b".repeat(64), png = "c".repeat(64);
  const ocean = { file: "ocean_assets_all_fixture.bundle", sha256 };
  const source = { ...ocean, objectId: "-9223372036854775807", assetPath: "Ocean/sea.png" };
  const mediaSources = [ocean];
  const sources = [...f.sources, ocean];
  const tilemap = { source: f.tilemap.source, data: { width: 2, height: 2, tilewidth: 16, tileheight: 16,
    orientation: "orthogonal", layers: [
      { type: "imagelayer", id: 7, name: "FarBGLayer1", visible: true, opacity: 1, properties: [
        { name: "opaque_shader", value: "WorldmapFarBgWarterSurfaceShader" }, { name: "transparent_shader", value: "" },
        { name: "textures", value: "Ocean/sea.png" }, { name: "tex_asset_group", value: "ocean" },
      ] },
      { type: "group", name: "TileGroup", visible: true, opacity: 1, layers: [
        { type: "tilelayer", name: "BottomLayer", width: 2, height: 2, visible: true, opacity: 1,
          properties: [{ name: "pal_anim_speed", value: 0.75 }], data: [1, 2, 3, 4] },
      ] },
    ] } };
  const mapPackage = { source: f.mapPackage.source, data: { map: [{ tilemap: "Map/tilemap" }],
    texture: [{ name: "plain", asset: "plain" }, { name: "plain_pal_anim", asset: "plain_pal_anim" }] } };
  const backgroundMedia = { parentSourceSetHash: "d".repeat(64), sources: mediaSources, sourceSetHash: hash(mediaSources),
    images: { ocean: { "sea.png": { source, textureSource: { ...source, objectId: "2" },
      filterMode: 0, rowOrder: "top-to-bottom", width: 4, height: 4, sha256: png, file: `textures/${png}.png` } } },
    shader: {}, prefab: {}, renderHost: {} };
  const verified: string[] = [];
  return { policy: "framework-world-map-flat-v1" as const, sources, tilemap, mapPackage, mapSize: { width: 2, height: 2 },
    backgroundMedia, renderHost: ordinaryFieldCompositionRenderHost(),
    verify: (file: string, digest: string) => { assert.equal(file, `textures/${png}.png`); assert.equal(digest, png); verified.push(file); }, verified };
}

test("flat world policy keeps full source identity, static texture and separate actor projection", () => {
  const f = fixture(), before = structuredClone({ tilemap: f.tilemap, package: f.mapPackage });
  const compiled = compileFrameworkWorldPresentation(f);
  assert.equal(compiled.view.kind, "framework-flat-field-view-v1");
  assert.deepEqual(compiled.view.omissions, ["perspective-world-view", "dynamic-palette", "ocean-shader"]);
  assert.equal(compiled.view.sources[0]!.contentHash, hash(f.tilemap.data));
  assert.equal(f.verified.length, 1);
  assert.deepEqual({ tilemap: f.tilemap, package: f.mapPackage }, before);
  assert.equal(compiled.textures[compiled.view.backgrounds[0]!.texture.key], compiled.view.backgrounds[0]!.texture.url);
  validateFieldNativeComposition(compiled.composition, compiled.view);
  const projection = projectFieldActorView(compiled.view, 9)!;
  assert.equal(projection.kind, "framework-flat-field-view-projection-v1");
  assert.equal(Object.hasOwn(projection, "water"), false);
  validateFieldActorViewProjection(projection, compiled.view.contextId, 9);
  assert.equal(projectFieldActorView(compiled.view, 8), null);
  f.tilemap.data.layers.length = 0;
  assert.equal(compiled.view.backgrounds.length, 1);
});

test("ordinary source lane still rejects the complete world's palette material", () => {
  const f = fixture();
  assert.throws(() => compileFieldActorView(f.sources, f.tilemap, f.mapPackage, f.mapSize), /palette/);
});

test("unknown or missing source assets cannot become a flat view", () => {
  const f = fixture(); f.sources.pop();
  assert.throws(() => compileFrameworkWorldPresentation(f), /Foreign/);
  const g = fixture(); g.mapPackage.data.map[0]!.tilemap = "Another/tilemap";
  assert.throws(() => compileFrameworkWorldPresentation(g), /Unbound/);
  const h = fixture(); h.verify = () => { throw new Error("Missing actual PNG"); };
  assert.throws(() => compileFrameworkWorldPresentation(h), /Missing actual PNG/);
});

test("flat policy does not grant unrelated custom layers or geometry", () => {
  const f = fixture(); (f.tilemap.data.layers[1]!.layers![0]!.properties![0]!).name = "unknown-water";
  assert.throws(() => compileFrameworkWorldPresentation(f), /tile layer/);
  const g = fixture(); g.mapSize.width = 3;
  assert.throws(() => compileFrameworkWorldPresentation(g), /tile geometry/);
  const h = fixture(); h.tilemap.data.layers[0]!.properties![0]!.value = "OtherShader";
  assert.throws(() => compileFrameworkWorldPresentation(h), /background declaration/);
});

test("full raw palette/ocean declarations participate in the context hash", () => {
  const f = fixture(), first = compileFrameworkWorldPresentation(f);
  f.tilemap.data.layers[1]!.layers![0]!.properties![0]!.value = 1;
  const second = compileFrameworkWorldPresentation(f);
  assert.notEqual(first.view.contextId, second.view.contextId);
  assert.throws(() => validateFieldActorViewProjection(projectFieldActorView(first.view, 10)!, second.view.contextId, 10), /projection/);
});

test("tampered static media and missing omission remain rejected", () => {
  const { view } = compileFrameworkWorldPresentation(fixture());
  view.backgrounds[0]!.texture.url = "/unbound.png";
  assert.throws(() => validateFieldActorView(view), /background identity/);
  const next = compileFrameworkWorldPresentation(fixture()).view;
  next.omissions = ["perspective-world-view"];
  assert.throws(() => validateFieldActorView(next), /shader omission/);
});
