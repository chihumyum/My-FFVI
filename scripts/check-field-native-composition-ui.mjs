// Controlled RGBA Canvas and real production Renderer/native actor projections.
// This is a renderer contract regression, not browser/native pixel equivalence.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url)), args = process.argv.slice(2);
assert.ok(!args.length || args.length === 2 && args[0] === "--compiled-dir");
const compiled = resolve(root, args[1] ?? "dist"), load = (p) => import(pathToFileURL(resolve(compiled, p)).href);
const hook = registerHooks({ resolve(specifier, context, next) {
  return next(specifier.startsWith("/runtime/") ? pathToFileURL(resolve(compiled, "src", specifier.slice(9))).href : specifier, context);
} });
let Renderer;
try { ({ Renderer } = await import("../apps/game/renderer.js")); } finally { hook.deregister(); }
const [{ fieldActorFactoryFixture }, { createFieldActorFactoryCandidate }, { createNativeFieldActorProjections, createNativeFieldActorProjection },
  { compileFieldNativeComposition }, { fieldCameraCellToWorld }, { ordinaryFieldCompositionRenderHost },
  { compileFieldActorView }, { projectFieldActorView }] = await Promise.all([
  load("tests/fixtures/field-actor-factory.js"), load("src/core/field-actor-factory.js"), load("src/core/field-native-actors.js"),
  load("src/compiler/field-native-composition.js"), load("src/core/field-camera.js"), load("src/core/field-native-composition.js"),
  load("src/compiler/field-actor-view.js"), load("src/core/field-actor-view.js")]);
const { ActorAnimation } = await load("src/core/actor-animation.js");
class Canvas {
  constructor(width = 0, height = 0) { this.width = width; this.height = height; this.draws = []; this.fills = 0; this.puts = 0;
    this.ownerDocument = { createElement: () => new Canvas() }; }
  getContext() { return this.context ??= new Context(this); }
}
class Context {
  constructor(canvas) { this.canvas = canvas; this.data = new Uint8ClampedArray(canvas.width * canvas.height * 4); this.globalAlpha = 1; }
  createImageData(width, height) { return { width, height, data: new Uint8ClampedArray(width * height * 4) }; }
  getImageData() { return { width: this.canvas.width, height: this.canvas.height, data: this.data.slice() }; }
  putImageData(image) { this.canvas.puts++; this.data.set(image.data); }
  fillRect() { this.canvas.fills++; for (let i = 0; i < this.data.length; i += 4) this.data.set([9, 17, 27, 255], i); }
  drawImage(image, ...args) {
    this.canvas.draws.push({ image, args });
    const src = image instanceof Canvas ? image.getContext().data : image.data;
    const [sx, sy, sw, sh, dx, dy, dw, dh] = args.length === 2 ? [0, 0, image.width, image.height, ...args, image.width, image.height] : args;
    for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
      const tx = Math.floor(dx + x), ty = Math.floor(dy + y);
      if (tx < 0 || ty < 0 || tx >= this.canvas.width || ty >= this.canvas.height) continue;
      const si = (Math.floor(sy + y * sh / dh) * image.width + Math.floor(sx + x * sw / dw)) * 4;
      const di = (ty * this.canvas.width + tx) * 4, a = src[si + 3] / 255,
        destinationAlpha = this.data[di + 3] / 255, alpha = a + destinationAlpha * (1 - a);
      for (let c = 0; c < 3; c++) this.data[di + c] = alpha === 0 ? 0
        : Math.round((src[si + c] * a + this.data[di + c] * destinationAlpha * (1 - a)) / alpha);
      this.data[di + 3] = Math.round(alpha * 255);
    }
  }
}
function fixture({ targets = false, host = false, width = 320, height = host ? 180 : 256 } = {}) {
  const f = fieldActorFactoryFixture(), prefix = "FINAL FANTASY VI_Data/StreamingAssets/aa/StandaloneWindows64/";
  f.sources.push({ file: prefix + "map_common_assets_all_320e510e7137e96ac91fe79e18fdd504.bundle", sha256: "c46413a1c208556af2ce202aab276e6ecefc54863229bbb77af38bb0f766233a" },
    { file: prefix + "shaders_assets_all_46e9e3032245a8a2ff9ff3236afcb55a.bundle", sha256: "56bebde18b58f95d3e4f9cd23e7e2c13e83892075606f1a85b5c92ac81ce1c6e" });
  if (targets) {
    f.tilemap.data.layers[0].layers.push(...["UpperLayer", "CeilLayer"].map((name) => ({ type: "tilelayer", name,
      width: 20, height: 16, data: Array.from({ length: 320 }, (_, i) => i === 63 || i === 83 ? 1 : 0) })));
    f.view = compileFieldActorView(f.sources, f.tilemap, f.mapPackage, f.map.mapRange);
    f.input.providers.mapRenderContext = f.view.contextId;
    f.input.providers.applyViewProperties = (layer) => projectFieldActorView(f.view, layer);
  }
  const nativeComposition = compileFieldNativeComposition(f.sources, f.view, f.tilemap,
    host ? ordinaryFieldCompositionRenderHost() : undefined);
  f.input.providers.upperTexture = nativeComposition.upperTexture;
  f.input.providers.ceilTexture = nativeComposition.ceilTexture;
  f.input.providers.composition = nativeComposition;
  f.input.player.position = fieldCameraCellToWorld(f.map.mapRange, { x: f.entry.player.x, y: f.entry.player.y }, f.entry.player.layer);
  const candidate = createFieldActorFactoryCandidate(f.input);
  const actors = Object.fromEntries(createNativeFieldActorProjections(candidate, f.map.mapRange, f.partyCatalog).map((a) => [a.id, a]));
  const player = actors["-1001"]; player.native.entity.visible = true;
  for (const actor of Object.values(actors)) if (actor !== player) actor.native.entity.visible = false;
  const image = { width: 16, height: 24, data: new Uint8ClampedArray(16 * 24 * 4) };
  for (let i = 0; i < image.data.length; i += 4) image.data.set([255, 0, 0, 255], i);
  const content = { characters: f.characters,
    cameraHost: { mapRange: f.map.mapRange, loop: { horizontal: false, vertical: false } },
    map: { nativeComposition, width: 20, height: 16, tilesets: [], textures: {}, layers: [], backgrounds: [] } };
  const canvas = new Canvas(width, height), renderer = new Renderer(canvas, content, new Map([["synthetic.png", image]]));
  const cameraInputs = [];
  const game = { actors, player, time: 0, cameraOffset: { x: 0, y: 0 }, collisionRange: f.map.mapRange,
    cameraProjection: (input) => { cameraInputs.push(input); return { cameraCell: { x: 9.5, y: 7.5 }, cameraPosition: { x: 0, y: 0 }, clampTileSubY: 0 }; },
    isEntityVisible: (id) => actors[id].native.entity.visible, tileAnimations: { tile: () => undefined } };
  return { f, actors, player, image, content, canvas, renderer, game, cameraInputs };
}
const tests = [];
const run = (name, fn) => { fn(); tests.push(name); };
run("real native owner renders source center anchor rather than legacy bottom-minus-two", () => {
  const t = fixture(), position = { ...t.player.native.entity.position }, entity = t.player.native.entity;
  t.renderer.draw(t.game);
  assert.equal(t.canvas.puts, 1, "one completed native composition is published without another alpha blend");
  assert.equal(t.canvas.draws.length, 0); assert.equal(t.canvas.fills, 0);
  const data = t.canvas.getContext().data, at = (x, y) => [...data.slice((y * 320 + x) * 4, (y * 320 + x) * 4 + 4)];
  assert.deepEqual(at(56, 49), [255, 0, 0, 255]); assert.deepEqual(at(56, 47), [9, 17, 27, 255]);
  assert.deepEqual(at(56, 71), [255, 0, 0, 255]); assert.deepEqual(at(56, 72), [9, 17, 27, 255]);
  assert.equal(t.player.native.entity, entity); assert.deepEqual(entity.position, position);
});
run("unresolved upper RT rejects before any visible frame mutation", () => {
  const t = fixture(), d = t.content.map.nativeComposition;
  d.layers.push("UpperLayer"); d.upperTexture = `native-field-rt:${d.contextId}:UpperLayer`; d.renderTargets.upper = "unresolved";
  assert.throws(() => t.renderer.draw(t.game), /allocation and sampling/);
  assert.equal(t.canvas.fills, 0); assert.equal(t.canvas.draws.length, 0);
});
run("foreign binding, missing media and unsupported providers fail without publishing a partial image", () => {
  for (const change of [(t) => { t.player.native.entity.viewBinding.properties.contextId = "f".repeat(64); },
    (t) => { t.player.native.entity.viewBinding.properties.sourceHashes[0] = "f".repeat(64); },
    (t) => t.renderer.images.clear(), (t) => { t.player.native.entity.bodyOpaque = false; },
    (t) => { t.player.native.entity.fadeAlpha = 0.5; }]) {
    const t = fixture(); change(t); assert.throws(() => t.renderer.draw(t.game));
    assert.equal(t.canvas.fills, 0); assert.equal(t.canvas.draws.length, 0); assert.equal(t.canvas.puts, 0);
  }
});
run("transparent tile starts with the prepared background and is never alpha-blended twice", () => {
  const t = fixture(), data = new Uint8ClampedArray(16 * 16 * 4);
  for (let i = 0; i < data.length; i += 4) data.set([0, 0, 255, 128], i);
  t.renderer.images.set("tile.png", { width: 16, height: 16, data });
  t.renderer.sets = [{ firstgid: 1, tilewidth: 16, tileheight: 16, columns: 1, image: "tile" }];
  t.content.map.textures.tile = "tile.png";
  t.content.map.layers = [{ name: "BottomLayer", opacity: 1, width: 20, height: 16,
    data: [1, ...Array(319).fill(0)] }];
  t.renderer.draw(t.game);
  assert.deepEqual([...t.canvas.getContext().data.slice(0, 4)], [4, 8, 141, 191]);
  assert.equal(t.canvas.puts, 1); assert.equal(t.canvas.draws.length, 0);
});
run("character Blend One Zero preserves fractional alpha without another Canvas blend", () => {
  const t = fixture();
  for (let i = 3; i < t.image.data.length; i += 4) t.image.data[i] = 128;
  t.renderer.draw(t.game);
  const i = (49 * 320 + 56) * 4;
  assert.deepEqual([...t.canvas.getContext().data.slice(i, i + 4)], [255, 0, 0, 128]);
});
run("the existing source shadow omission is explicit and does not change its gameplay owner", () => {
  const t = fixture(); assert.equal(t.player.native.entity.shadowVisible, true);
  t.renderer.draw(t.game); t.renderer.draw(t.game);
  assert.deepEqual(t.renderer.presentationOmissions, [{ kind: "native-character-shadow", actorId: t.player.id }]);
  assert.equal(t.player.native.entity.shadowVisible, true);
});
run("a separately published effect pool is refused without the particle/material renderer host", () => {
  const t = fixture(); t.game.fieldEffectsSnapshot = { kind: "field-effects-v1", players: [], boards: [] };
  assert.throws(() => t.renderer.draw(t.game), /离屏纹理渲染宿主/);
  assert.equal(t.canvas.puts, 0); assert.equal(t.canvas.fills, 0); assert.equal(t.canvas.draws.length, 0);
});
run("a hidden unplaced native resident keeps zero direction and is not fabricated as a sprite", () => {
  const t = fixture(), hidden = Object.values(t.actors).find((a) => a.direction === null);
  assert.ok(hidden); const before = hidden.animation?.snapshot() ?? null;
  t.renderer.draw(t.game); assert.equal(hidden.direction, null); assert.deepEqual(hidden.animation?.snapshot() ?? null, before);
});
function addTargetTile(t, rgba, name = "UpperLayer") {
  const data = new Uint8ClampedArray(16 * 16 * 4);
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  const index = t.renderer.sets.length, key = name + ".png";
  t.renderer.images.set(key, { width: 16, height: 16, data });
  t.renderer.sets.unshift({ firstgid: index + 1, tilewidth: 16, tileheight: 16, columns: 1, image: key });
  t.content.map.textures[key] = key;
  t.content.map.layers.push({ name, opacity: 1, width: 20, height: 16,
    data: Array.from({ length: 320 }, (_, i) => i === 63 || i === 83 ? index + 1 : 0) });
}
function pixel(t, x, y) { const i = (y * t.canvas.width + x) * 4; return [...t.canvas.getContext().data.slice(i, i + 4)]; }
run("real Renderer supplies source 320x180 camera and nonempty Upper RT to the character head", () => {
  const t = fixture({ targets: true, host: true }); addTargetTile(t, [0, 0, 255, 128]);
  const entity = t.player.native.entity, before = structuredClone(entity);
  t.renderer.draw(t.game);
  assert.equal(t.cameraInputs[0].orthographicSize, 90); assert.equal(t.cameraInputs[0].aspect, 16 / 9);
  assert.deepEqual(pixel(t, 56, 11), [194, 3, 35, 207], "head samples alpha-squared prepass, not the raw tile");
  assert.deepEqual(pixel(t, 56, 30), [127, 0, 128, 191], "body receives the ordinary main transparent pass");
  assert.deepEqual(pixel(t, 56, 9), [9, 17, 27, 255], "top-down screen UV is not flipped");
  assert.deepEqual(structuredClone(entity), before); assert.equal(t.player.native.entity, entity);
  assert.equal(t.canvas.puts, 1); assert.equal(t.canvas.draws.length, 0);
});
run("Ceil is independently rendered, second attachment follows first, and next frame clears old tiles", () => {
  const t = fixture({ targets: true, host: true });
  addTargetTile(t, [0, 0, 255, 128]); addTargetTile(t, [0, 255, 0, 128], "CeilLayer");
  t.renderer.draw(t.game);
  // First RGBA lerp gives (194,3,35,207); second target=(12,140,12,64).
  // The shader does not quantize between lerps, giving round(148.33,37.45,29.47,171.16).
  assert.deepEqual(pixel(t, 56, 11), [148, 37, 29, 171]);
  for (const layer of t.content.map.layers) layer.data.fill(0);
  t.renderer.draw(t.game); assert.deepEqual(pixel(t, 56, 11), [255, 0, 0, 255]);
});
run("opaque Upper pixels occlude through depth without being written into the transparent RT", () => {
  const t = fixture({ targets: true, host: true }); addTargetTile(t, [0, 0, 255, 255]);
  t.renderer.draw(t.game); assert.deepEqual(pixel(t, 56, 11), [0, 0, 255, 255]);
  assert.deepEqual(pixel(t, 56, 30), [0, 0, 255, 255]);
});
run("native layer10 samples only Ceil and never reuses Upper from layer9", () => {
  const t = fixture({ targets: true, host: true }); addTargetTile(t, [0, 0, 255, 128]);
  const e = t.player.native.entity, definition = t.content.map.nativeComposition;
  e.layer = 10; e.position.z = 249;
  e.viewBinding = { map: definition.contextId, layer: 10, properties: projectFieldActorView(definition.view, 10) };
  e.transparentTextures = { first: definition.ceilTexture, second: null };
  t.renderer.draw(t.game);
  assert.deepEqual(pixel(t, 56, 11), [255, 0, 0, 255], "Upper cannot tint this layer's head");
  addTargetTile(t, [0, 255, 0, 128], "CeilLayer"); t.renderer.draw(t.game);
  assert.deepEqual(pixel(t, 56, 11), [194, 35, 3, 207]);
});
run("Web display is point-scaled after source rendering and never changes camera viewport or alpha", () => {
  const t = fixture({ targets: true, host: true, width: 512, height: 288 }); addTargetTile(t, [0, 0, 255, 128]);
  t.renderer.draw(t.game);
  assert.equal(t.cameraInputs[0].orthographicSize, 90);
  assert.deepEqual(pixel(t, 90, 18), [194, 3, 35, 207]);
  assert.deepEqual(pixel(t, 90, 49), [127, 0, 128, 191]);
  assert.equal(t.canvas.draws.length, 0); assert.equal(t.canvas.puts, 1);
  const wrongAspect = fixture({ host: true, width: 320, height: 256 });
  assert.throws(() => wrongAspect.renderer.draw(wrongAspect.game), /宽高比/);
  assert.equal(wrongAspect.canvas.puts, 0);
});
function mountedFixture() {
  const t = fixture(), old = t.player.native;
  t.content.characters.armor.sprites.body.file = "mount.png";
  const blue = { width: 16, height: 24, data: new Uint8ClampedArray(16 * 24 * 4) };
  for (let i = 0; i < blue.data.length; i += 4) blue.data.set([0, 0, 255, 255], i);
  t.renderer.images.set("mount.png", blue);
  const animation = new ActorAnimation(t.content.characters.armor); animation.cue("Default", 0);
  const mounted = createNativeFieldActorProjection({ ...old, fieldAssetId: 38,
    entity: { ...old.entity, riding: true, riderAssetId: old.fieldAssetId, rideOnEntity: "riding",
      direction: "down", animation } }, t.f.map.mapRange, t.f.partyCatalog, "framework-development");
  t.actors[mounted.id] = mounted; t.player = mounted; t.game.player = mounted;
  return t;
}
run("framework riding renders inner and outer media through the same map compositor without mutating playback", () => {
  const t = mountedFixture(); t.game.transportationPresentation = "framework-development";
  const before = t.player.animation.snapshot(), entity = t.player.native.entity;
  t.renderer.draw(t.game);
  assert.equal(t.canvas.puts, 1); assert.equal(t.canvas.draws.length, 0);
  assert.ok(t.renderer.presentationOmissions.some((o) => o.kind === "framework-rider-pose-crop-offset"));
  const data = t.canvas.getContext().data, colors = new Set();
  for (let i = 0; i < data.length; i += 4) colors.add([...data.slice(i, i + 4)].join(","));
  assert.ok(colors.has("255,0,0,255"), "inner rider image must be present");
  assert.ok(colors.has("0,0,255,255"), "outer transportation image must be present");
  assert.deepEqual(t.player.animation.snapshot(), before); assert.equal(t.player.native.entity, entity);
});
run("mounted native actor cannot grant framework presentation to the strict renderer", () => {
  const t = mountedFixture();
  assert.throws(() => t.renderer.draw(t.game), /骑乘/);
  assert.equal(t.canvas.puts, 0); assert.equal(t.canvas.draws.length, 0);
});
await mkdir(root + "build/reports", { recursive: true });
const report = { kind: "field-native-composition-ui", tests, passed: tests.length, rendererSha256: (await import("node:crypto")).createHash("sha256")
  .update(await readFile(root + "apps/game/renderer.js")).digest("hex"), controlledCanvas: true, browserVerified: false, originalGameParityVerified: false };
await writeFile(root + "build/reports/field-native-composition-ui-check.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ result: "pass", checks: tests.length, controlledCanvas: true, browserVerified: false }));
