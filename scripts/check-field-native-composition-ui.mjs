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
const [{ fieldActorFactoryFixture }, { createFieldActorFactoryCandidate }, { createNativeFieldActorProjections },
  { compileFieldNativeComposition }, { fieldCameraCellToWorld }] = await Promise.all([
  load("tests/fixtures/field-actor-factory.js"), load("src/core/field-actor-factory.js"), load("src/core/field-native-actors.js"),
  load("src/compiler/field-native-composition.js"), load("src/core/field-camera.js")]);
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
function fixture() {
  const f = fieldActorFactoryFixture(), prefix = "FINAL FANTASY VI_Data/StreamingAssets/aa/StandaloneWindows64/";
  f.sources.push({ file: prefix + "map_common_assets_all_320e510e7137e96ac91fe79e18fdd504.bundle", sha256: "c46413a1c208556af2ce202aab276e6ecefc54863229bbb77af38bb0f766233a" },
    { file: prefix + "shaders_assets_all_46e9e3032245a8a2ff9ff3236afcb55a.bundle", sha256: "56bebde18b58f95d3e4f9cd23e7e2c13e83892075606f1a85b5c92ac81ce1c6e" });
  const nativeComposition = compileFieldNativeComposition(f.sources, f.view, f.tilemap);
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
  const canvas = new Canvas(320, 256), renderer = new Renderer(canvas, content, new Map([["synthetic.png", image]]));
  const game = { actors, player, time: 0, cameraOffset: { x: 0, y: 0 }, collisionRange: f.map.mapRange,
    cameraProjection: () => ({ cameraCell: { x: 9.5, y: 7.5 }, cameraPosition: { x: 0, y: 0 }, clampTileSubY: 0 }),
    isEntityVisible: (id) => actors[id].native.entity.visible, tileAnimations: { tile: () => undefined } };
  return { f, actors, player, image, content, canvas, renderer, game };
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
await mkdir(root + "build/reports", { recursive: true });
const report = { kind: "field-native-composition-ui", tests, passed: tests.length, rendererSha256: (await import("node:crypto")).createHash("sha256")
  .update(await readFile(root + "apps/game/renderer.js")).digest("hex"), controlledCanvas: true, browserVerified: false, originalGameParityVerified: false };
await writeFile(root + "build/reports/field-native-composition-ui-check.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ result: "pass", checks: tests.length, controlledCanvas: true, browserVerified: false }));
