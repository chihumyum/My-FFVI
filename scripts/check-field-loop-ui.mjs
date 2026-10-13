// Real Renderer + FieldGame/camera/native actor owners, controlled RGBA Canvas.
// Authored ordinary materials exercise Web cell topology, not a source world
// palette, browser rasterizer or original-game rendering oracle.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url)), args = process.argv.slice(2);
assert.ok(!args.length || args.length === 2 && args[0] === "--compiled-dir", "Use --compiled-dir <directory>");
const compiled = resolve(root, args[1] ?? "dist"), load = (path) => import(pathToFileURL(resolve(compiled, path)).href),
  output = resolve(root, "build/reports/field-loop-ui-check.json");
await mkdir(resolve(root, "build/reports"), { recursive: true });
await rm(output, { force: true });
const hook = registerHooks({ resolve(specifier, context, next) {
  return next(specifier.startsWith("/runtime/")
    ? pathToFileURL(resolve(compiled, "src", specifier.slice(9))).href : specifier, context);
} });
let Renderer;
try { ({ Renderer } = await import("../apps/game/renderer.js")); } finally { hook.deregister(); }
const [{ FieldGame }, { EventState }, { FieldCameraHost }, { fieldActorFactoryFixture },
  { createFieldActorFactoryCandidate }, { createNativeFieldActorProjections },
  { compileFieldActorView }, { projectFieldActorView }, { compileFieldNativeComposition },
  { ordinaryFieldCompositionRenderHost }, { fieldCameraCellToWorld }] = await Promise.all([
  load("src/core/field.js"), load("src/core/event-state.js"), load("src/core/field-camera-host.js"),
  load("tests/fixtures/field-actor-factory.js"), load("src/core/field-actor-factory.js"),
  load("src/core/field-native-actors.js"), load("src/compiler/field-actor-view.js"),
  load("src/core/field-actor-view.js"), load("src/compiler/field-native-composition.js"),
  load("src/core/field-native-composition.js"), load("src/core/field-camera.js"),
]);

class Canvas {
  constructor(width = 0, height = 0) {
    this.width = width; this.height = height; this.calls = [];
    this.ownerDocument = { createElement: () => new Canvas() };
  }
  getContext() { return this.context ??= new Context(this); }
}
class Context {
  constructor(canvas) {
    this.canvas = canvas; this.data = new Uint8ClampedArray(canvas.width * canvas.height * 4);
    this.matrix = [1, 0, 0, 1, 0, 0]; this.globalAlpha = 1; this.stack = [];
  }
  save() { this.stack.push({ matrix: [...this.matrix], alpha: this.globalAlpha }); }
  restore() { const s = this.stack.pop(); assert.ok(s); this.matrix = s.matrix; this.globalAlpha = s.alpha; }
  transform(a, b, c, d, e, f) {
    const [aa, ab, ac, ad, ae, af] = this.matrix;
    this.matrix = [aa * a + ac * b, ab * a + ad * b, aa * c + ac * d,
      ab * c + ad * d, aa * e + ac * f + ae, ab * e + ad * f + af];
  }
  translate(x, y) { this.transform(1, 0, 0, 1, x, y); }
  scale(x, y) { this.transform(x, 0, 0, y, 0, 0); }
  createImageData(width, height) { return { width, height, data: new Uint8ClampedArray(width * height * 4) }; }
  getImageData() { return { width: this.canvas.width, height: this.canvas.height, data: this.data.slice() }; }
  putImageData(image) { this.canvas.calls.push({ kind: "put" }); this.data.set(image.data); }
  fillRect(x, y, width, height) {
    this.canvas.calls.push({ kind: "fill", x, y, width, height });
    for (let i = 0; i < this.data.length; i += 4) this.data.set([9, 17, 27, 255], i);
  }
  drawImage(image, ...args) {
    const [sx, sy, sw, sh, dx, dy, dw, dh] = args.length === 2
      ? [0, 0, image.width, image.height, ...args, image.width, image.height]
      : args.length === 4 ? [0, 0, image.width, image.height, ...args] : args;
    assert.ok([sx, sy, sw, sh, dx, dy, dw, dh].every(Number.isFinite));
    const [a, b, c, d, e, f] = this.matrix, determinant = a * d - b * c;
    const points = [[dx, dy], [dx + dw, dy], [dx, dy + dh], [dx + dw, dy + dh]]
      .map(([x, y]) => ({ x: a * x + c * y + e, y: b * x + d * y + f }));
    const left = Math.min(...points.map((p) => p.x)), top = Math.min(...points.map((p) => p.y)),
      right = Math.max(...points.map((p) => p.x)), bottom = Math.max(...points.map((p) => p.y));
    this.canvas.calls.push({ kind: "image", file: image.file, source: [sx, sy, sw, sh],
      rect: [left, top, right - left, bottom - top], alpha: this.globalAlpha });
    const data = image instanceof Canvas ? image.getContext().data : image.data;
    for (let y = Math.max(0, Math.floor(top)); y < Math.min(this.canvas.height, Math.ceil(bottom)); y++)
      for (let x = Math.max(0, Math.floor(left)); x < Math.min(this.canvas.width, Math.ceil(right)); x++) {
        const localX = (d * (x + 0.5 - e) - c * (y + 0.5 - f)) / determinant,
          localY = (-b * (x + 0.5 - e) + a * (y + 0.5 - f)) / determinant;
        if (localX < dx || localX >= dx + dw || localY < dy || localY >= dy + dh) continue;
        const si = (Math.floor(sy + (localY - dy) * sh / dh) * image.width + Math.floor(sx + (localX - dx) * sw / dw)) * 4,
          di = (y * this.canvas.width + x) * 4, alpha = data[si + 3] / 255 * this.globalAlpha,
          beforeAlpha = this.data[di + 3] / 255, outAlpha = alpha + beforeAlpha * (1 - alpha);
        for (let channel = 0; channel < 3; channel++) this.data[di + channel] = outAlpha === 0 ? 0
          : Math.round((data[si + channel] * alpha + this.data[di + channel] * beforeAlpha * (1 - alpha)) / outAlpha);
        this.data[di + 3] = Math.round(outAlpha * 255);
      }
  }
}
function image(file, width, height, color) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(color(x, y), (y * width + x) * 4);
  return { file, width, height, data };
}
function atlas(width, height) {
  return image("tiles.png", width * 16, height * 16, (x, y) =>
    [10 + Math.floor(y / 16) * width + Math.floor(x / 16), 60 + x % 16, 100 + y % 16, 255]);
}
const source = { file: "synthetic-loop", assetPath: "ordinary-material-fixture" }, hash = "1".repeat(64);
function cameraDefinition(range, loop) {
  return { kind: "source-field-camera-host-v1", mapRange: { ...range }, loop: { ...loop }, playerVisualOffset: { x: 0, y: -6 },
    callbacks: "fresh-normal-field-v1", sources: [{ file: "controlled-native", sha256: hash },
      { file: "controlled-prefab", sha256: "2".repeat(64) }] };
}
function scene({ loop = { horizontal: true, vertical: true }, position = { x: 5, y: 2 },
  width = 128, height = 128, topology = true, camera = false, offset = { x: 0, y: 0 } } = {}) {
  const range = { x: 2, y: 1, width: 4, height: 4 }, mapWidth = 8, mapHeight = 7;
  const character = { source, sprites: { pose: { file: "player.png", width: 8, height: 12,
    pivot: [0.5, 0], sha256: hash, source } }, animations: Object.fromEntries(
    ["Default", "WalkB", "WalkL", "WalkR"].map((key) => [key, { duration: 1, mode: 0, flip: false, next: "",
      frames: [{ sprite: "pose", x: 0, y: 0, flip: false, alpha: 1 }] }])) };
  const content = { formatVersion: 1, kind: "field-development", contentHash: hash,
    sourceSetHash: hash, parentSourceSetHash: hash, limitations: [], characters: { player: character },
    ...(camera ? { cameraHost: cameraDefinition(range, loop) } : {}),
    map: { id: "controlled-loop", width: mapWidth, height: mapHeight, tileSize: 16, source,
      ...(topology ? { topology: { range, loop } } : {}), collisions: { 0: Array(mapWidth * mapHeight).fill(0) },
      layers: [{ name: "BottomLayer", width: mapWidth, height: mapHeight, opacity: 1,
        data: Array.from({ length: mapWidth * mapHeight }, (_, i) => i + 1) }],
      tilesets: [{ firstgid: 1, image: "atlas", columns: mapWidth, tilewidth: 16, tileheight: 16 }],
      textures: { atlas: "tiles.png" },
      entities: [{ ...range, id: "range", kind: 27, layer: 0, asset: null, direction: "down",
        script: null, collision: null, destinationLayer: null, source }] }, scripts: {},
    entry: { player: { ...position, layer: 0, direction: "right", asset: "player", mount: "" },
      cameraOffset: offset,
      description: "Controlled Web topology and actual FieldGame", evidence: [source] } };
  const canvas = new Canvas(width, height), images = new Map([["tiles.png", atlas(mapWidth, mapHeight)],
    ["player.png", image("player.png", 8, 12, () => [255, 0, 0, 255])]]),
    game = new FieldGame(content, EventState.initialized()), renderer = new Renderer(canvas, content, images);
  if (camera) game.initializeMapCamera();
  return { canvas, content, game, renderer, range, draw() {
    canvas.calls.length = 0; renderer.draw(game); assert.equal(canvas.getContext().stack.length, 0);
    return structuredClone(canvas.calls);
  } };
}
function nativeScene({ loop = { horizontal: true, vertical: true }, targets = false,
  width = 320, height = targets ? 180 : 256 } = {}) {
  const f = fieldActorFactoryFixture(), prefix = "FINAL FANTASY VI_Data/StreamingAssets/aa/StandaloneWindows64/";
  f.sources.push({ file: prefix + "map_common_assets_all_320e510e7137e96ac91fe79e18fdd504.bundle",
    sha256: "c46413a1c208556af2ce202aab276e6ecefc54863229bbb77af38bb0f766233a" },
  { file: prefix + "shaders_assets_all_46e9e3032245a8a2ff9ff3236afcb55a.bundle",
    sha256: "56bebde18b58f95d3e4f9cd23e7e2c13e83892075606f1a85b5c92ac81ce1c6e" });
  const layers = [{ name: "BottomLayer", type: "tilelayer", width: 20, height: 16, opacity: 1,
    data: Array.from({ length: 320 }, (_, i) => i + 1) }];
  if (targets) for (const name of ["UpperLayer", "CeilLayer"]) layers.push({ name, type: "tilelayer",
    width: 20, height: 16, opacity: 1, data: Array.from({ length: 320 }, (_, i) => i === 63 || i === 83 ? 321 : 0) });
  f.tilemap.data.layers[0].layers = layers;
  f.view = compileFieldActorView(f.sources, f.tilemap, f.mapPackage, f.map.mapRange);
  const composition = compileFieldNativeComposition(f.sources, f.view, f.tilemap,
    targets ? ordinaryFieldCompositionRenderHost() : undefined);
  Object.assign(f.input.providers, { mapRenderContext: f.view.contextId,
    applyViewProperties: (layer) => projectFieldActorView(f.view, layer),
    upperTexture: composition.upperTexture, ceilTexture: composition.ceilTexture, composition });
  f.input.player.position = fieldCameraCellToWorld(f.map.mapRange, { x: f.entry.player.x, y: f.entry.player.y }, 0);
  const candidate = createFieldActorFactoryCandidate(f.input), actors = Object.fromEntries(
    createNativeFieldActorProjections(candidate, f.map.mapRange, f.partyCatalog).map((actor) => [actor.id, actor]));
  const player = actors["-1001"];
  for (const actor of Object.values(actors)) actor.native.entity.visible = actor === player;
  const content = { characters: f.characters, cameraHost: cameraDefinition(f.map.mapRange, loop),
    map: { width: 20, height: 16, topology: { range: f.map.mapRange, loop }, nativeComposition: composition,
      layers, tilesets: [{ firstgid: 1, image: "atlas", columns: 20, tilewidth: 16, tileheight: 16 },
        { firstgid: 321, image: "upper", columns: 1, tilewidth: 16, tileheight: 16 }],
      textures: { atlas: "tiles.png", upper: "upper.png" } } };
  const canvas = new Canvas(width, height), images = new Map([["tiles.png", atlas(20, 16)],
    ["synthetic.png", image("synthetic.png", 16, 24, () => [255, 0, 0, 255])],
    ["upper.png", image("upper.png", 16, 16, () => [0, 0, 255, 128])]]),
    renderer = new Renderer(canvas, content, images), scroll = { x: 0, y: 0 };
  const camera = new FieldCameraHost(content.cameraHost, {
    readPlayer: () => ({ cell: { x: player.x, y: player.y }, logicalLayer: player.layer, direction: player.direction }),
    readScrollOffset: () => ({ ...scroll }),
  });
  camera.prepareSelect({ target: "player" }).commit();
  const game = { actors, player, time: 0, cameraOffset: scroll, collisionRange: f.map.mapRange,
    cameraProjection: (view) => camera.projection(view),
    isEntityVisible: (id) => actors[id].native.entity.visible, tileAnimations: { tile: () => undefined } };
  return { f, canvas, content, game, renderer, scroll, camera, player, actors, draw() {
    canvas.calls.length = 0; renderer.draw(game); return canvas.getContext().data.slice();
  } };
}
const checks = [], check = (name, run) => { const observed = run(); checks.push({ name, passed: true, observed }); },
  tileDraws = (calls) => calls.filter((call) => call.file === "tiles.png"),
  actorDraws = (calls) => calls.filter((call) => call.file === "player.png"),
  pixel = (canvas, x, y) => [...canvas.getContext().data.slice((y * canvas.width + x) * 4, (y * canvas.width + x) * 4 + 4)];

check("cropped periodic tiles sample only their canonical layer cells and animation indices", () => {
  const t = scene(), read = [], original = t.game.tileAnimations.tile.bind(t.game.tileAnimations);
  t.game.tileAnimations.tile = (layer, index) => { read.push(index); return original(layer, index); };
  const calls = t.draw(), tiles = tileDraws(calls);
  assert.equal(tiles.length, 81); assert.equal(read.length, 81);
  for (const call of tiles) {
    const x = call.source[0] / 16, y = call.source[1] / 16;
    assert.ok(x >= 2 && x < 6 && y >= 1 && y < 5);
  }
  assert.ok(new Set(read).size === 16 && new Set(read).size < read.length);
  for (const index of read) assert.ok(index % 8 >= 2 && index % 8 < 6 && Math.floor(index / 8) >= 1 && Math.floor(index / 8) < 5);
  return { tileImages: tiles.length, sourceCells: new Set(read).size };
});
for (const [direction, position, endpoint] of [
  ["right", { x: 5, y: 2 }, { x: 2, y: 2 }], ["left", { x: 2, y: 2 }, { x: 5, y: 2 }],
  ["down", { x: 3, y: 4 }, { x: 3, y: 1 }], ["up", { x: 3, y: 1 }, { x: 3, y: 4 }],
]) check(`actual FieldGame ${direction} seam remains one short motion with visible actor and tiles`, () => {
  const t = scene({ position }), actor = t.game.player, baseline = actor.steps;
  assert.equal(t.game.move(direction), true); const motion = structuredClone(actor.motion);
  assert.equal(Math.abs(motion.to.x - motion.from.x) + Math.abs(motion.to.y - motion.from.y), 1);
  for (let elapsed = 0; elapsed < 240; elapsed += 40) {
    if (elapsed) t.game.advance(40);
    const calls = t.draw(); assert.equal(t.game.stop, null);
    assert.ok(actorDraws(calls).some((call) => call.rect[0] === 60 && call.rect[1] === 58));
    assert.ok(tileDraws(calls).length >= 64);
  }
  t.game.advance(40); t.draw(); assert.deepEqual({ x: actor.x, y: actor.y }, endpoint);
  assert.equal(actor.motion, null); assert.equal(actor.steps, baseline + 1); assert.equal(t.game.player, actor);
  return { endpoint, steps: actor.steps - baseline };
});
check("single-axis loops keep the other dimension bounded", () => {
  for (const loop of [{ horizontal: true, vertical: false }, { horizontal: false, vertical: true }]) {
    const t = scene({ loop }), tiles = tileDraws(t.draw());
    assert.equal(tiles.length, 36);
    const rows = new Set(tiles.map((call) => call.rect[1])), columns = new Set(tiles.map((call) => call.rect[0]));
    assert.equal(rows.size, loop.vertical ? 9 : 4); assert.equal(columns.size, loop.horizontal ? 9 : 4);
  }
});
check("large viewports render every visible actor image without cloning actor state", () => {
  const t = scene(), actor = t.game.player, animation = actor.animation, before = animation.snapshot();
  const images = actorDraws(t.draw());
  assert.equal(images.length, 9); assert.equal(new Set(images.map((call) => call.rect.join(","))).size, 9);
  assert.equal(Object.values(t.game.actors).length, 1); assert.equal(t.game.player, actor);
  assert.equal(actor.animation, animation); assert.deepEqual(animation.snapshot(), before);
  return { drawImages: images.length, actorOwners: 1 };
});
check("fallback camera traverses negative and multiple periods without blank map or duplicate owners", () => {
  const t = scene(), expected = t.draw(), pixels = t.canvas.getContext().data.slice();
  for (const [x, y] of [[-9, 4], [1, -1], [7, -11]]) {
    const shifted = scene({ offset: { x: x * 64, y: y * 64 } });
    assert.deepEqual(shifted.draw(), expected); assert.deepEqual(shifted.canvas.getContext().data, pixels);
  }
});
check("loop source camera and fallback camera use the same crop instead of border clamping", () => {
  const a = scene(), b = scene({ camera: true });
  assert.deepEqual(b.draw(), a.draw());
  assert.deepEqual(b.canvas.getContext().data, a.canvas.getContext().data);
});
check("absent and explicit non-loop topology retain identical ordinary rendering", () => {
  const loop = { horizontal: false, vertical: false }, a = scene({ loop }), b = scene({ loop, topology: false });
  assert.deepEqual(a.draw(), b.draw()); assert.deepEqual(a.canvas.getContext().data, b.canvas.getContext().data);
  assert.equal(actorDraws(a.canvas.calls).length, 1);
});
check("native ordinary composition repeats tiles and actors with source depth across whole camera periods", () => {
  const t = nativeScene(), entity = t.player.native.entity, before = structuredClone(entity),
    cameraBefore = t.camera.snapshot(), pixels = t.draw();
  assert.equal(t.canvas.calls.length, 1); assert.equal(t.canvas.calls[0].kind, "put");
  for (const [x, y] of [[-5, 3], [2, -7], [11, 8]]) {
    t.scroll.x = x * 320; t.scroll.y = y * 256;
    assert.deepEqual(t.draw(), pixels);
  }
  assert.equal(t.player.native.entity, entity); assert.deepEqual(structuredClone(entity), before);
  assert.deepEqual(t.camera.snapshot(), cameraBefore);
  return { cameraPeriods: 3, actorOwners: Object.keys(t.actors).length };
});
check("native large viewport repeats the same actor and opaque tile layer over four complete periods", () => {
  const t = nativeScene({ width: 640, height: 512 }); t.draw();
  for (let y = 0; y < 256; y += 7) for (let x = 0; x < 320; x += 7) {
    assert.deepEqual(pixel(t.canvas, x, y), pixel(t.canvas, x + 320, y));
    assert.deepEqual(pixel(t.canvas, x, y), pixel(t.canvas, x, y + 256));
  }
  const data = t.canvas.getContext().data;
  assert.equal(Array.from({ length: 640 * 512 }, (_, i) => i * 4)
    .filter((i) => data[i] === 255 && data[i + 1] === 0 && data[i + 2] === 0).length, 16 * 24 * 4);
});
check("native canonical owner and unwrapped seam motion render the same fractional image, including corners", () => {
  const t = nativeScene(), actor = t.player, entity = actor.native.entity, animation = actor.animation;
  for (const [x, y, dx, dy] of [[19, 4, 1, 0], [0, 4, -1, 0], [3, 15, 0, 1], [3, 0, 0, -1],
    [19, 15, 1, 1], [0, 0, -1, -1]]) for (const fraction of [0.25, 0.75]) {
    actor.motion = null; actor.x = ((x + dx * fraction) % 20 + 20) % 20;
    actor.y = ((y + dy * fraction) % 16 + 16) % 16;
    const expected = t.draw(), position = { ...entity.position }, playback = animation.snapshot();
    const motion = { from: { x, y }, to: { x: x + dx, y: y + dy }, duration: 1000,
      elapsed: fraction * 1000, manual: true };
    actor.motion = motion;
    assert.deepEqual(t.draw(), expected);
    assert.equal(t.game.player, actor); assert.equal(actor.native.entity, entity); assert.equal(actor.motion, motion);
    assert.equal(actor.animation, animation); assert.deepEqual(entity.position, position);
    assert.deepEqual(animation.snapshot(), playback);
  }
  return { fractionalSamples: 12, ownerCountUnchanged: true };
});
check("native Upper and Ceil render-target sampling follows the repeated actor and layer together", () => {
  const t = nativeScene({ targets: true }), expected = t.draw();
  const colors = new Set(); for (let i = 0; i < expected.length; i += 4) colors.add([...expected.slice(i, i + 4)].join(","));
  assert.ok([...colors].some((value) => /^\d+,\d+,\d+,171$/.test(value)), "two material attachment passes must be observable");
  t.scroll.x = -4 * 320; t.scroll.y = 6 * 256; assert.deepEqual(t.draw(), expected);
  for (const layer of t.content.map.layers) if (layer.name !== "BottomLayer") layer.data.fill(0);
  assert.notDeepEqual(t.draw(), expected, "periodic render targets clear with the current source layer");
});
check("topology/camera/range failures reject before publishing visible pixels", () => {
  for (const mutate of [
    (t) => { delete t.content.map.topology; },
    (t) => { t.content.map.topology.loop.horizontal = false; },
    (t) => { t.content.map.topology.range = { ...t.content.map.topology.range, x: 1 }; },
    (t) => { t.content.map.topology.range = { ...t.content.map.topology.range, width: 0 }; },
  ]) {
    const t = nativeScene(); mutate(t);
    assert.throws(() => t.draw(), /拓扑|topology/); assert.deepEqual(t.canvas.calls, []);
  }
});
check("periodicity does not grant missing native bindings, world palette or effect providers", () => {
  const t = nativeScene(); t.player.native.entity.viewBinding.properties.contextId = "f".repeat(64);
  assert.throws(() => t.draw()); assert.deepEqual(t.canvas.calls, []);
  const f = fieldActorFactoryFixture(); f.mapPackage.data.texture.push({ name: "plain_pal_anim", asset: "plain_pal_anim" });
  assert.throws(() => compileFieldActorView(f.sources, f.tilemap, f.mapPackage, f.map.mapRange), /palette/);
  const fx = nativeScene(); fx.game.fieldEffectsSnapshot = { kind: "field-effects-v1", boards: [] };
  fx.renderer.effectProvider = { prepare: () => { throw new Error("must not consume an unadmitted loop effect provider"); } };
  assert.throws(() => fx.draw(), /周期投影/); assert.deepEqual(fx.canvas.calls, []);
});

const report = { kind: "field-loop-ui", passed: true, checks,
  rendererSha256: createHash("sha256").update(await readFile(resolve(root, "apps/game/renderer.js"))).digest("hex"),
  topologySha256: createHash("sha256").update(await readFile(resolve(root, "src/core/field-map-topology.ts"))).digest("hex"),
  evidence: { controlledCanvas: true, actualRenderer: true, actualFieldGame: true, actualNativeActorProjection: true,
    authoredOrdinaryMaterials: true, sourceWorldPaletteAdmitted: false, browserVerified: false, originalGameParityVerified: false } };
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ result: "pass", cases: checks.length, output, controlledCanvas: true, originalGameParityVerified: false }));
