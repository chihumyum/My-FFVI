// Controlled sampler/Canvas lane for the real Renderer and common depth pass.
// Frames are explicitly supplied RGBA samples; no Unity particle RT is claimed.
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
const [{ fieldActorFactoryFixture }, { createFieldActorFactoryCandidate }, { createNativeFieldActorProjections },
  { compileFieldNativeComposition }, { fieldCameraCellToWorld }, { ordinaryFieldCompositionRenderHost },
  { compileFieldActorView }, { projectFieldActorView }] = await Promise.all([
  load("tests/fixtures/field-actor-factory.js"), load("src/core/field-actor-factory.js"), load("src/core/field-native-actors.js"),
  load("src/compiler/field-native-composition.js"), load("src/core/field-camera.js"), load("src/core/field-native-composition.js"),
  load("src/compiler/field-actor-view.js"), load("src/core/field-actor-view.js")]);
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
const [{ createFieldEffectState, projectFieldEffects }, { effectDefinition, effectCatalog },
  { effectBoardMaterial }, kernel, { composeFieldNativePixels }, { prepareSourceFieldEffectBoards }] = await Promise.all([
  load("src/core/field-effects.js"), load("tests/fixtures/field-effects.js"), load("tests/fixtures/field-particle-geometry.js"),
  load("src/core/field-particle-geometry.js"), load("src/core/field-native-composition.js"), import("../apps/game/field-effect-renderer.js")]);
const tests = [], run = (name, fn) => { fn(); tests.push(name); };
function particleCase(rgba = [128, 64, 0, 254], overrides = {}, position = { x: 0, y: 0, z: 5 }) {
  const t = fixture({ host: true }), definition = effectDefinition({ split: false, zOffset: 0, blendType: 0, ...overrides });
  const state = projectFieldEffects(createFieldEffectState(), effectCatalog(), [
    { kind: "create", id: "controlled-board", definition, position },
    { kind: "setup", registeredBoards: ["controlled-board"], groupUpdate: false },
  ]).after;
  t.game.fieldEffectsSnapshot = state;
  const frame = { kind: "field-effect-sampled-rt-v1", assetGroup: definition.assetGroup, cameraId: state.boards[0].cameraId,
    width: 32, height: 32, sampleEncoding: "rgba8-unorm", rowOrder: "top-to-bottom", data: new Uint8ClampedArray(32 * 32 * 4) };
  for (let i = 0; i < frame.data.length; i += 4) frame.data.set(rgba, i);
  const prepared = { frames: new Map([[frame.cameraId, frame]]), boardOrder: [state.boards[0].id], material: effectBoardMaterial() };
  const calls = []; t.renderer.effectProvider = { prepare(input) { calls.push(input); return prepared; } };
  return { ...t, frame, prepared, calls };
}
const pixel = (t, x = 160, y = 90) => [...t.canvas.getContext().data.slice((y * t.canvas.width + x) * 4, (y * t.canvas.width + x) * 4 + 4)];
const unpublished = (t) => { assert.equal(t.canvas.puts, 0); assert.equal(t.canvas.draws.length, 0); assert.equal(t.canvas.fills, 0); };
run("real Renderer runs two board passes inside its shared native color attachment", () => {
  const t = particleCase(), before = structuredClone(t.game.fieldEffectsSnapshot), entity = t.player.native.entity;
  t.renderer.draw(t.game);
  assert.deepEqual(pixel(t), [129, 64, 0, 255], "alpha254 survives both passes; second red = 128 + 128/255");
  assert.equal(t.canvas.puts, 1); assert.equal(t.canvas.draws.length, 0); assert.equal(t.canvas.fills, 0);
  assert.equal(t.calls.length, 1); assert.equal(t.calls[0].width, 320); assert.equal(t.calls[0].height, 180);
  assert.deepEqual(t.game.fieldEffectsSnapshot, before); assert.equal(t.player.native.entity, entity);
});
run("low-alpha board uses One blend without a second Canvas alpha multiplication", () => {
  const t = particleCase([64, 0, 0, 128], { blendType: 0 }); t.renderer.draw(t.game);
  assert.deepEqual(pixel(t), [68, 8, 13, 255]); assert.equal(t.canvas.draws.length, 0); assert.equal(t.canvas.puts, 1);
});
run("source board queues use the existing actor buffer, not a post-Canvas overlay", () => {
  for (const front of [false, true]) {
    const t = particleCase([0, 64, 0, 128], { blendType: 0, front });
    Object.assign(t.game.fieldEffectsSnapshot.boards[0].position, { x: t.player.native.entity.position.x, y: t.player.native.entity.position.y, z: 5 });
    t.renderer.draw(t.game);
    assert.deepEqual(pixel(t, 56, 20), front ? [127, 64, 0, 255] : [255, 0, 0, 255]);
    assert.deepEqual(pixel(t, 56, 30), front ? [127, 64, 0, 255] : [255, 0, 0, 255]);
  }
});
run("front board still obeys shared actor depth unless the source explicitly selects Always", () => {
  for (const zTest of [4, 8]) {
    const t = particleCase([0, 64, 0, 128], { blendType: 0, zTest });
    Object.assign(t.game.fieldEffectsSnapshot.boards[0].position, { x: t.player.native.entity.position.x, y: t.player.native.entity.position.y, z: 900 });
    t.renderer.draw(t.game); assert.deepEqual(pixel(t, 56, 20), zTest === 4 ? [255, 0, 0, 255] : [127, 64, 0, 255]);
  }
});
run("provider receives only a detached read snapshot and prepared sample bytes cannot drift", () => {
  const t = particleCase();
  t.renderer.effectProvider.prepare = (input) => { input.state.boards[0].fadeAlpha = 0; return t.prepared; };
  t.renderer.draw(t.game); assert.equal(t.game.fieldEffectsSnapshot.boards[0].fadeAlpha, 1);
  const candidate = prepareSourceFieldEffectBoards({ boards: t.game.fieldEffectsSnapshot.boards, ...t.prepared,
    camera: { x: 0, y: 0 }, width: 320, height: 180 }, kernel);
  t.frame.data.fill(0);
  const pixels = composeFieldNativePixels({ width: 320, height: 180, tiles: [], actors: [], effects: candidate });
  const i = (90 * 320 + 160) * 4; assert.deepEqual([...pixels.data.slice(i, i + 4)], [129, 64, 0, 255]);
});
run("missing RT, unqualified encoding or a later invalid board rejects before visible publication", () => {
  for (const change of [(t) => t.prepared.frames.clear(), (t) => { t.frame.sampleEncoding = "srgb-unresolved"; },
    (t) => { delete t.frame.kind; t.frame.depths = new Float64Array(32 * 32); },
    (t) => { t.prepared.boardOrder = []; }, (t) => { t.prepared.material.fragments[1] = "0".repeat(64); },
    (t) => { const b = structuredClone(t.game.fieldEffectsSnapshot.boards[0]); b.id = "second"; b.cameraId++;
      t.game.fieldEffectsSnapshot.boards.push(b); t.prepared.boardOrder.push(b.id); },
    (t) => { t.game.fieldEffectsSnapshot.boards[0].mesh.triangles[0] = 1; }]) {
    const t = particleCase(); change(t); const before = structuredClone(t.game.fieldEffectsSnapshot);
    assert.throws(() => t.renderer.draw(t.game)); unpublished(t); assert.deepEqual(t.game.fieldEffectsSnapshot, before);
  }
});
run("missing source host and missing ordinary framebuffer never invoke a controlled Canvas fallback", () => {
  const t = particleCase(); t.renderer.effectProvider = null;
  assert.throws(() => t.renderer.draw(t.game), /离屏纹理渲染宿主/); unpublished(t);
  const u = particleCase(); delete u.content.map.nativeComposition;
  assert.throws(() => u.renderer.draw(u.game), /共享原生颜色与深度缓冲/); unpublished(u);
});
run("board sampling keeps top-to-bottom frame rows and explicitly supplied same-queue order", () => {
  const t = particleCase([32, 0, 0, 128], { blendType: 0 });
  for (let y = 16; y < 32; y++) for (let x = 0; x < 32; x++) t.frame.data.set([0, 64, 0, 128], (y * 32 + x) * 4);
  t.renderer.draw(t.game); assert.deepEqual(pixel(t, 160, 80), [36, 8, 13, 255]); assert.deepEqual(pixel(t, 160, 100), [4, 72, 13, 255]);
  const v = particleCase([32, 0, 0, 128], { blendType: 0 }), b = structuredClone(v.game.fieldEffectsSnapshot.boards[0]);
  b.id = "second"; b.cameraId++;
  const frame = { ...v.frame, cameraId: b.cameraId, data: v.frame.data.slice() };
  for (let i = 0; i < frame.data.length; i += 4) frame.data.set([0, 64, 0, 128], i);
  v.game.fieldEffectsSnapshot.boards.push(b); v.prepared.frames.set(b.cameraId, frame); v.prepared.boardOrder.push(b.id);
  v.renderer.draw(v.game); assert.deepEqual(pixel(v), [18, 68, 6, 255]);
  v.prepared.boardOrder.reverse(); v.renderer.draw(v.game); assert.deepEqual(pixel(v), [34, 36, 6, 255]);
});
await mkdir(root + "build/reports", { recursive: true });
const report = { kind: "field-particle-geometry-ui", tests, passed: tests.length, controlledCanvas: true, controlledRTSamples: true,
  nativeParticleGenerator: false, nativeRTColorEncoding: false, originalGameParityVerified: false, browserVerified: false,
  rendererSha256: (await import("node:crypto")).createHash("sha256").update(await readFile(root + "apps/game/renderer.js")).digest("hex") };
await writeFile(root + "build/reports/field-particle-geometry-ui-check.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ result: "pass", checks: tests.length, controlledCanvas: true, controlledRTSamples: true, nativeParticleGenerator: false }));
