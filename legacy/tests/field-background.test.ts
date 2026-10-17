import test from "node:test";
import assert from "node:assert/strict";
import { projectFieldBackground, type FieldBackgroundLayer } from "../src/core/field-background.js";
import { compileFieldBackgroundLayers, type FieldBackgroundMedia } from "../src/compiler/field-background.js";
import { hash } from "../src/compiler/content.js";

const source = (file: string, sha256 = "a".repeat(64), objectId = "9223372036854775000") =>
  ({ file, sha256, objectId, assetPath: "Assets/map/tilemap.json", serializedFile: "CAB-controlled" });
function layer(): FieldBackgroundLayer {
  return { kind: "native-center-repeat-background-v1", layerId: 11, name: "FarBGLayer1", source: source("map.bundle"),
    mapSize: { width: 672, height: 512 }, size: { width: 1920, height: 512 }, offset: { x: -864, y: -24 },
    manualSpeed: { x: 0.5, y: 0.5 },
    renderHost: { kind: "source-fresh-normal-background-host-v1", rendererWorld: { x: 0, y: 0 }, renderCamera: { x: 0, y: 0 },
      sources: [source("scene.bundle"), source("boot")] },
    texture: { width: 512, height: 512, sha256: "b".repeat(64),
      url: "/field-background-media/textures/" + "b".repeat(64) + ".png", source: source("bg.bundle"), textureSource: source("bg.bundle", "a".repeat(64), "9") } };
}
const view = (x = 88, y = 136) => ({ scrollCamera: { x, y }, renderCamera: { x: 0, y: 0 }, rendererWorld: { x: 0, y: 0 },
  screen: { width: 320, height: 180 }, renderTarget: { width: 320, height: 180 } });

test("background source independent arithmetic uses different horizontal and vertical equations", () => {
  const projection = projectFieldBackground(layer(), view());
  // U pixel offset: .5*(88+864+336-160)=564. V: .5*(256-136-90)+136-24+256-90=293.
  assert.deepEqual(projection.uvOffset, { x: 564 / 512, y: 293 / 512 });
  assert.deepEqual(projection.patches, [{ source: { x: 52, y: 39, width: 320, height: 180 },
    destination: { x: 0, y: 0, width: 320, height: 180 } }]);
});
test("center repeat splits the image without scaling its pixels", () => {
  const projection = projectFieldBackground(layer(), view(600, 160));
  assert.deepEqual(projection.patches, [
    { source: { x: 308, y: 27, width: 204, height: 180 }, destination: { x: 0, y: 0, width: 204, height: 180 } },
    { source: { x: 0, y: 27, width: 116, height: 180 }, destination: { x: 204, y: 0, width: 116, height: 180 } },
  ]);
});
test("source clamp moves mesh while retaining boundary UV", () => {
  assert.deepEqual(projectFieldBackground(layer(), view(-2000, 136)).localOffset, { x: 480, y: 0 });
  const right = projectFieldBackground(layer(), view(2400, 1000));
  assert.deepEqual(right.localOffset, { x: -120, y: -393 });
  assert.deepEqual(right.uvOffset, { x: 1600 / 512, y: 332 / 512 });
});
test("undersized regions use the native negative threshold centering branch", () => {
  const input = layer(); input.size = { width: 160, height: 90 };
  const projected = projectFieldBackground(input, view());
  assert.deepEqual(projected.meshSize, { width: 160, height: 90 });
  assert.deepEqual(projected.localOffset, { x: -644, y: 84 });
  assert.deepEqual(projected.uvOffset, { x: 0, y: 0 });
  assert.deepEqual(projected.patches[0]?.destination, { x: -564, y: -39, width: 160, height: 90 });
});
test("scroll, raster camera and renderer world position remain independent", () => {
  const input = view(); input.renderTarget.width = 640;
  assert.equal(projectFieldBackground(layer(), input).uvOffset.x, 524 / 512);
  input.rendererWorld = { x: 12, y: -8 };
  input.renderCamera = { x: 100, y: 128 };
  const shifted = projectFieldBackground(layer(), input);
  assert.deepEqual(shifted.patches[0]?.destination, { x: -88, y: 136, width: 320, height: 180 });
  assert.equal(shifted.uvOffset.x, 524 / 512);
});
test("negative UV and vertical wrapping remain top-to-bottom Canvas patches", () => {
  const definition = layer(); definition.size.height = 1024;
  const output = projectFieldBackground(definition, view(600, -100));
  assert.ok(output.patches.length >= 2);
  assert.equal(output.patches.reduce((n, p) => n + p.source.width * p.source.height, 0), 320 * 180);
  for (const patch of output.patches) {
    assert.ok(patch.source.x >= 0 && patch.source.y >= 0);
    assert.ok(patch.source.x + patch.source.width <= 512 && patch.source.y + patch.source.height <= 512);
    assert.equal(patch.source.width, patch.destination.width); assert.equal(patch.source.height, patch.destination.height);
  }
});

function compilation() {
  const common = source("map_common.bundle", "c46413a1c208556af2ce202aab276e6ecefc54863229bbb77af38bb0f766233a");
  const sprite = { ...source("bg_assets_all_fixture.bundle"), assetPath: "Assets/bg.png" };
  const field = { ...source("scene.bundle", "9b406d18f7e629a9cd224fdae27757897753554e5468fb7ee411baf8de8fe5c7", "17"),
    serializedFile: "CAB-2551423dda0aad973a6f5a52774d59d7" };
  const camera = { ...source("FINAL FANTASY VI_Data/level0", "986e706d7e762c652ac73cacfbb399b1eb69c37ad57d31a8165df0516e07c170", "170"),
    serializedFile: "level0" };
  const transforms = (src: ReturnType<typeof source>, ids: string[], z: number) => ids.map((id, index) => ({
    source: { ...src, objectId: id }, parentId: ids[index + 1] ?? "0", position: { x: 0, y: 0, z: index === 0 ? z : 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } }));
  const sources = [source("map.bundle"), common, sprite, field].map(({ file, sha256 }) => ({ file, sha256 }));
  const properties: Record<string, unknown> = { tex_asset_group: "bg", width: 1920, height: 512,
    h_center_width: 512, v_center_height: 512, h_manual_scroll: true, v_manual_scroll: true,
    h_manual_speed_scale: 0.5, v_manual_speed_scale: 0.5 };
  const raw = { id: 11, type: "imagelayer", name: "FarBGLayer1", image: "../bg.png", visible: true, opacity: 1,
    offsetx: -864, offsety: -24, properties: Object.entries(properties).map(([name, value]) => ({ name, value })) };
  const media: FieldBackgroundMedia = { parentSourceSetHash: "a".repeat(64), sources, sourceSetHash: hash(sources),
    renderHost: { kind: "source-fresh-normal-background-host-v1", fieldMapSource: field, rendererParentId: "9",
      rendererTransforms: transforms(field, ["9", "6", "7"], 0), commonCameraSource: { ...camera, objectId: "305" },
      cameraSource: camera, cameraIndex: 12, selectedCameraId: "170", cameraTransforms: transforms(camera, ["142", "108"], -50),
      orthographic: true, cullingMask: 58867457 },
    images: { bg: { "bg.png": { source: sprite, textureSource: { ...sprite, objectId: "8" }, width: 512, height: 512,
      rowOrder: "top-to-bottom", pixelsPerUnit: 1, spriteRect: [0, 0, 512, 512], filterMode: 0, wrap: [0, 0],
      file: "textures/" + "b".repeat(64) + ".png", sha256: "b".repeat(64) } } },
    shader: { name: "Unlit/MultipleScrollShader", source: { ...common, objectId: "5482222517167677832" },
      programs: ["51435b11255bd644dca330fd869b300a75b2ea179f6249734cd7c74cba7c683e", "454aa9357a278171ce3d25ac32f289154ac5995bdd39a9c04732bebd787dd0fe"].map((sha256, i) =>
        ({ index: i + 4, sha256, file: `shaders/${sha256}.dxbc` })) },
    prefab: { source: { ...common, objectId: "8979836032843371103" },
      transform: { m_LocalScale: { x: 1, y: 1, z: 1 }, m_LocalRotation: { x: 0, y: 0, z: 0, w: 1 } } } };
  const verified: string[] = [];
  return { raw, input: { sources, tilemap: { source: source("map.bundle"), data: { tilewidth: 16, tileheight: 16,
    orientation: "orthogonal", layers: [raw] } }, mapRange: { width: 42, height: 32 }, loopType: 0, media,
    verify: (file: string, _sha: string) => { verified.push(file); } }, verified };
}
test("compiler binds complete source image identity, source mapRange and bytecode", () => {
  const { input, verified } = compilation(); const output = compileFieldBackgroundLayers(input);
  assert.equal(output.blockers.length, 0); assert.equal(output.layers.length, 1); assert.equal(verified.length, 3);
  assert.deepEqual(output.layers[0]?.mapSize, { width: 672, height: 512 });
  assert.equal(output.layers[0]?.texture.source.objectId, "9223372036854775000");
});
test("unknown behavior, border, nonrepeat sampler and missing image stay blocked", () => {
  for (const change of [
    (fixture: ReturnType<typeof compilation>) => { fixture.raw.properties.push({ name: "h_left_width", value: 1 }); },
    (fixture: ReturnType<typeof compilation>) => { fixture.raw.properties.push({ name: "auto_scroll", value: true }); },
    (fixture: ReturnType<typeof compilation>) => { fixture.raw.properties.push({ name: "custom_animation", value: 1 }); },
    (fixture: ReturnType<typeof compilation>) => { fixture.input.loopType = 1; },
    (fixture: ReturnType<typeof compilation>) => { delete fixture.input.media.images.bg!["bg.png"]; },
    (fixture: ReturnType<typeof compilation>) => { (fixture.input.media.images.bg!["bg.png"] as { wrap: number[] }).wrap = [1, 0]; },
  ]) {
    const fixture = compilation(); change(fixture);
    const output = compileFieldBackgroundLayers(fixture.input);
    assert.equal(output.layers.length, 0); assert.equal(output.blockers.length, 1);
  }
});
test("media verification fails closed and does not publish a layer", () => {
  const { input } = compilation(); input.verify = (file) => { if (file.endsWith(".png")) throw new Error("changed image"); };
  const output = compileFieldBackgroundLayers(input);
  assert.equal(output.layers.length, 0); assert.equal(output.blockers[0]?.reason, "changed image");
  (input.media.shader as { name: string }).name = "custom";
  assert.throws(() => compileFieldBackgroundLayers(input), /shader provider/);
});
test("explicit source inactive scenery is not rendered or newly blocked", () => {
  const { raw, input } = compilation(); raw.properties.push({ name: "active", value: false });
  delete input.media.images.bg!["bg.png"];
  assert.deepEqual(compileFieldBackgroundLayers(input), { layers: [], blockers: [] });
});
test("unbound raster camera or renderer parent refuses all backgrounds", () => {
  const { input } = compilation();
  const host = input.media.renderHost as { rendererTransforms: { position: { x: number } }[]; cameraIndex: number };
  host.rendererTransforms[1]!.position.x = 20;
  assert.throws(() => compileFieldBackgroundLayers(input), /transform provider/);
  host.rendererTransforms[1]!.position.x = 0; host.cameraIndex = 0;
  assert.throws(() => compileFieldBackgroundLayers(input), /raster camera/);
});
