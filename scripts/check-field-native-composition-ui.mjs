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
try { ({ Renderer } = await import(pathToFileURL(root + "apps/game/renderer.js").href)); } finally { hook.deregister(); }
const [{ fieldActorFactoryFixture }, { createFieldActorFactoryCandidate }, { createNativeFieldActorProjections, createNativeFieldActorProjection },
  { compileFieldNativeComposition }, { fieldCameraCellToWorld }, { ordinaryFieldCompositionRenderHost },
  { compileFieldActorView }, { projectFieldActorView }] = await Promise.all([
  load("tests/fixtures/field-actor-factory.js"), load("src/core/field-actor-factory.js"), load("src/core/field-native-actors.js"),
  load("src/compiler/field-native-composition.js"), load("src/core/field-camera.js"), load("src/core/field-native-composition.js"),
  load("src/compiler/field-actor-view.js"), load("src/core/field-actor-view.js")]);
const { ActorAnimation } = await load("src/core/actor-animation.js");
const {vehicleLifecycleSessionFixture}=await load("tests/fixtures/vehicle-lifecycle-session.js");
class Canvas {
  constructor(width = 0, height = 0) { this.width = width; this.height = height; this.draws = []; this.fills = 0; this.puts = 0;
    this.ownerDocument = { createElement: () => new Canvas() }; }
  getContext() { return this.context ??= new Context(this); }
}
class Context {
  constructor(canvas) { this.canvas = canvas; this.data = new Uint8ClampedArray(canvas.width * canvas.height * 4); this.globalAlpha = 1; }
  save() { (this.stack ??= []).push({ globalAlpha: this.globalAlpha, transform: { ...(this.transform ?? { x: 0, y: 0, sx: 1, sy: 1 }) } }); }
  restore() { const state = this.stack.pop(); this.globalAlpha = state.globalAlpha; this.transform = state.transform; }
  translate(x, y) { const t = this.transform ??= { x: 0, y: 0, sx: 1, sy: 1 }; t.x += t.sx * x; t.y += t.sy * y; }
  scale(x, y) { const t = this.transform ??= { x: 0, y: 0, sx: 1, sy: 1 }; t.sx *= x; t.sy *= y; }
  createImageData(width, height) { return { width, height, data: new Uint8ClampedArray(width * height * 4) }; }
  getImageData() { return { width: this.canvas.width, height: this.canvas.height, data: this.data.slice() }; }
  putImageData(image) { this.canvas.puts++; this.data.set(image.data); }
  fillRect() { this.canvas.fills++; for (let i = 0; i < this.data.length; i += 4) this.data.set([9, 17, 27, 255], i); }
  drawImage(image, ...args) {
    this.canvas.draws.push({ image, args });
    const src = image instanceof Canvas ? image.getContext().data : image.data;
    const [sx, sy, sw, sh, dx, dy, dw, dh] = args.length === 2 ? [0, 0, image.width, image.height, ...args, image.width, image.height] : args;
    for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
      const t = this.transform ?? { x: 0, y: 0, sx: 1, sy: 1 };
      const tx = Math.floor(t.x + t.sx * (dx + x + .5)), ty = Math.floor(t.y + t.sy * (dy + y + .5));
      if (tx < 0 || ty < 0 || tx >= this.canvas.width || ty >= this.canvas.height) continue;
      const si = (Math.floor(sy + y * sh / dh) * image.width + Math.floor(sx + x * sw / dw)) * 4;
      const di = (ty * this.canvas.width + tx) * 4, a = (src[si + 3] / 255) * this.globalAlpha,
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
const {FieldLayerScrolling,fieldLayerTweenSample}=await load("src/core/field-layer-scrolling.js");
run("one finite scrolling owner moves native CPU tile sampling and keeps native actor coordinates and collision anchors",()=>{
  const t=fixture(),image={width:32,height:16,data:new Uint8ClampedArray(32*16*4)};
  for(let y=0;y<16;y++)for(let x=0;x<32;x++)image.data.set(x<16?[0,255,0,255]:[0,0,255,255],(y*32+x)*4);
  t.renderer.images.set("scroll-tiles.png",image);t.renderer.sets=[{firstgid:1,tilewidth:16,tileheight:16,columns:2,image:"scroll"}];t.content.map.textures.scroll="scroll-tiles.png";
  const layer={name:"BottomLayer",opacity:1,width:20,height:16,data:Array.from({length:320},(_,i)=>i%20%2+1)};t.content.map.layers=[layer];
  const owner=new FieldLayerScrolling("controlled-renderer-map",["BottomLayer"]),command={kind:"tween",mask:1,layers:[0],axis:"x",from:0,to:16,seconds:1,easing:"linear"};
  t.game.fieldTileLayerOffset=name=>owner.tileOffset(name);const before=structuredClone(t.player.native.entity.position),cells=[...layer.data];
  t.renderer.draw(t.game);assert.deepEqual([...t.canvas.getContext().data.slice(0,4)],[0,255,0,255]);
  owner.prepare({kind:"apply",actions:fieldLayerTweenSample(command,.5,0).actions}).commit();t.renderer.draw(t.game);
  assert.deepEqual([...t.canvas.getContext().data.slice(8*4,8*4+4)],[0,0,255,255]);assert.deepEqual([...t.canvas.getContext().data.slice(0,4)],[0,255,0,255]);
  owner.prepare({kind:"apply",actions:fieldLayerTweenSample(command,1,0).actions}).commit();t.renderer.draw(t.game);assert.deepEqual([...t.canvas.getContext().data.slice(0,4)],[0,0,255,255]);
  assert.deepEqual(t.player.native.entity.position,before);assert.deepEqual(layer.data,cells);
});
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
    (t) => { t.player.native.entity.fadeAlpha = 1.1; }]) {
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
run("source-initialized Session vehicle is drawn by the one actual native renderer and hide/lose remove its actual pixels", () => {
 const source=vehicleLifecycleSessionFixture(),t=fixture();source.run('park');const field=source.game.field,body=field.actors[source.actorId];
 // The display fixture supplies a controlled offscreen allocation and pixel
 // decoder. The game, native body/factory, source VM and visibility are real.
 const game={...t.game,actors:field.actors,player:field.player,time:field.time,isEntityVisible:id=>field.isEntityVisible(id)};
 for(const actor of Object.values(field.actors))if(actor!==body)actor.native.entity.visible=false;
 t.renderer.draw(game);const drawn=t.canvas.getContext().data.slice();assert(drawn.some((v,i)=>i%4===0&&v===255));
 source.run('hide');for(const actor of Object.values(field.actors))if(actor!==body)actor.native.entity.visible=false;t.renderer.draw(game);const hidden=t.canvas.getContext().data.slice();assert.notDeepEqual(hidden,drawn);assert.equal(body.native.entity.visible,false);
 source.run('show');for(const actor of Object.values(field.actors))if(actor!==body)actor.native.entity.visible=false;t.renderer.draw(game);assert.deepEqual(t.canvas.getContext().data,drawn);
 source.run('lose');for(const actor of Object.values(field.actors))actor.native.entity.visible=false;t.renderer.draw(game);assert.equal(field.actors[source.actorId],undefined);assert.deepEqual(t.canvas.getContext().data,hidden);
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

const { startFieldActorVisibility, tickFieldActorVisibility } = await load("src/core/field-actor-visibility.js");
const applyVisibility = (entity, next) => { entity.visible = next.visible; entity.fadeAlpha = next.fadeAlpha;
  if (Object.hasOwn(next, "visibilityFade")) entity.visibilityFade = next.visibilityFade; };
const { compileFrameworkFieldPresentation } = await load("src/compiler/framework-field-presentation.js");
run("real ordinary Renderer applies the two material alpha stages without changing frame alpha or actor owner", () => {
  const t = fixture(), entity = t.player.native.entity, animation = t.player.animation;
  applyVisibility(entity, startFieldActorVisibility(entity, false, 1, 0));
  applyVisibility(entity, tickFieldActorVisibility(entity, .5));
  t.renderer.draw(t.game);
  assert.deepEqual(pixel(t, 56, 49), [255, 0, 0, 64]);
  assert.equal(t.player.native.entity, entity); assert.equal(t.player.animation, animation);
  assert.equal(t.player.animation.frame().alpha, 1); assert.equal(entity.fadeAlpha, .5);
  assert.equal(t.canvas.puts, 1); assert.equal(t.canvas.draws.length, 0);
});
run("head RT RGBA lerps happen after source material-alpha product, rather than final-image opacity", () => {
  const t = fixture({ targets: true, host: true }); addTargetTile(t, [0, 0, 255, 128]);
  const entity = t.player.native.entity;
  applyVisibility(entity, startFieldActorVisibility(entity, false, 1, 0));
  applyVisibility(entity, tickFieldActorVisibility(entity, .5));
  t.renderer.draw(t.game);
  assert.deepEqual(pixel(t, 56, 11), [194, 3, 35, 64]);
  assert.equal(entity.fadeAlpha, .5); assert.equal(t.canvas.puts, 1);
});
run("flat-field Web presentation draws the same existing actor opacity through real Canvas inputs", () => {
  const t = fixture({ host: true }), tilemap = structuredClone(t.f.tilemap), group = tilemap.data.layers[0];
  group.visible = true; group.opacity = 1;
  for (const layer of group.layers) Object.assign(layer, { visible: true, opacity: 1, width: 20, height: 16, data: Array(320).fill(0) });
  const flat = compileFrameworkFieldPresentation({ policy: "framework-ordinary-field-flat-v1", sources: t.f.sources,
    tilemap, mapPackage: t.f.mapPackage, mapSize: { width: 20, height: 16 }, mapRange: t.f.map.mapRange,
    renderHost: ordinaryFieldCompositionRenderHost() });
  t.content.map.nativeComposition = flat.composition;
  t.content.map.layers = group.layers;
  t.content.developmentProfile = { fieldPresentation: flat.view.policy }; t.content.entry = { viewPlan: { isWorld: false } };
  for (const actor of Object.values(t.actors)) {
    const entity = actor.native.entity;
    entity.viewBinding = { map: flat.view.contextId, layer: entity.layer, properties: projectFieldActorView(flat.view, entity.layer) };
    entity.transparentTextures = { first: null, second: null };
  }
  const entity = t.player.native.entity, animation = t.player.animation;
  applyVisibility(entity, startFieldActorVisibility(entity, false, 1, 0));
  applyVisibility(entity, tickFieldActorVisibility(entity, .5));
  t.renderer.draw(t.game);
  assert.deepEqual(pixel(t, 56, 11), [71, 13, 20, 255]);
  assert.equal(t.player.native.entity, entity); assert.equal(t.player.animation, animation);
  assert.equal(entity.fadeAlpha, .5); assert.equal(t.canvas.puts, 1);
});

run("ordinary fading does not grant mounted actor alpha propagation", () => {
  const t=mountedFixture();t.game.transportationPresentation="framework-development";
  t.player.native.entity.fadeAlpha=.5;
  assert.throws(()=>t.renderer.draw(t.game),/骑乘/);assert.equal(t.canvas.puts,0);assert.equal(t.canvas.draws.length,0);
});


const { prepareFieldMapAnimations } = await load("src/core/field-map-animation.js");
function animatedFixture() {
 const t=fixture({host:true}),tilemap=structuredClone(t.f.tilemap),group=tilemap.data.layers[0];
 group.visible=true;group.opacity=1;for(const layer of group.layers)Object.assign(layer,{visible:true,opacity:1,width:20,height:16,data:Array(320).fill(0)});
 const flat=compileFrameworkFieldPresentation({policy:"framework-ordinary-field-flat-v1",sources:t.f.sources,tilemap,mapPackage:t.f.mapPackage,mapSize:{width:20,height:16},mapRange:t.f.map.mapRange,renderHost:ordinaryFieldCompositionRenderHost()});
 t.content.map.nativeComposition=flat.composition;t.content.map.layers=group.layers;t.content.developmentProfile={fieldPresentation:flat.view.policy,mapAnimatedEntities:"web-field-animated-map-entities-v1"};t.content.entry={viewPlan:{isWorld:false}};
 for(const actor of Object.values(t.actors)){const entity=actor.native.entity;entity.viewBinding={map:flat.view.contextId,layer:entity.layer,properties:projectFieldActorView(flat.view,entity.layer)};entity.transparentTextures={first:null,second:null};entity.visible=false;}
 const asset=t.player.asset,source={file:"synthetic-map.bundle",assetPath:"Root/animated.json",pointer:"/layers/0/objects/0"},definition={kind:"source-field-animated-map-entity-v1",group:"entity_default",entityId:"500",sourceEntityId:500,source,sourceDirection:15,geometry:{x:48,y:64,width:16,height:16,layer:0},asset:{id:188,asset,animationAsset:asset.toUpperCase(),source},playOnAwake:true,collision:true,front:true,split:false,building:true,affected:true,zOffset:2};
 const row=prepareFieldMapAnimations({definitions:[definition],policy:"web-field-animated-map-entities-v1",factory:t.f.factory,characters:t.f.characters,mapRange:t.f.map.mapRange,providers:t.f.input.providers,existingActorIds:Object.keys(t.actors)}).actors[0];
 const actor=createNativeFieldActorProjection(row,t.f.map.mapRange,t.f.partyCatalog);t.actors[actor.id]=actor;
 t.content.map.groups={entity_default:{entities:[{id:"500",kind:10,mapAnimation:structuredClone(definition)}]}};
 return{...t,animated:actor};
}
run("explicit Web kind10 draws exact source Default without cardinal facing and keeps playback/native owner",()=>{
 const t=animatedFixture(),actor=t.animated,entity=actor.native.entity,animation=actor.animation,before=animation.snapshot();
 assert.equal(actor.direction,null);assert.equal(entity.character,false);t.renderer.draw(t.game);
 assert.equal(t.canvas.puts,1);assert.equal(actor.native.entity,entity);assert.equal(actor.animation,animation);assert.deepEqual(animation.snapshot(),before);
 assert.deepEqual(pixel(t,56,3),[255,0,0,255]);assert.ok(t.renderer.presentationOmissions.some(x=>x.kind==="web-animated-map-entity"&&x.actorId==="500"&&x.nativeParity===false));
 entity.visible=false;t.renderer.draw(t.game);assert.deepEqual(pixel(t,56,3),[9,17,27,255]);entity.visible=true;t.renderer.draw(t.game);assert.deepEqual(pixel(t,56,3),[255,0,0,255]);
});
run("kind10 cannot grant itself Web display through its source definition or native actor",()=>{
 const t=animatedFixture();delete t.content.developmentProfile.mapAnimatedEntities;
 assert.throws(()=>t.renderer.draw(t.game),/Web显示策略/);assert.equal(t.canvas.puts,0);
});
run("foreign source entity refuses draw before publishing an image",()=>{
 const t=animatedFixture();t.animated.native.mapAnimation.source.pointer="/layers/0/objects/99";
 assert.throws(()=>t.renderer.draw(t.game),/Web显示策略/);assert.equal(t.canvas.puts,0);
});
run("actual Renderer reads first Cue/Play and later direct replay from the same native ActorAnimation owner",()=>{
 const t=fixture(),actor=t.player,entity=actor.native.entity,animation=actor.animation,c=animation.character,base=c.animations.Default;
 c.animations.FiniteA={...base,duration:.125,mode:0,next:"FiniteB",frames:base.frames.map(frame=>({...frame,x:0}))};
 c.animations.FiniteB={...base,duration:.125,mode:0,next:"FiniteA",frames:base.frames.map(frame=>({...frame,x:4}))};
 animation.play("FiniteA",false,1);assert.equal(animation.snapshot().key,"FiniteB");let before=animation.snapshot();t.renderer.draw(t.game);
 const first=t.canvas.getContext().data.slice();assert.deepEqual(animation.snapshot(),before);
 animation.advance(130);animation.replayEntity("FiniteA",1);assert.equal(animation.snapshot().key,"FiniteA");before=animation.snapshot();t.renderer.draw(t.game);
 assert.notDeepEqual(t.canvas.getContext().data,first);assert.deepEqual(animation.snapshot(),before);assert.equal(actor.native.entity,entity);assert.equal(actor.animation,animation);assert.equal(entity.animation,animation);
});
const {compileFieldNativeNpc}=await load("src/compiler/field-native-npc.js"),{prepareFieldNativeNpcGroup}=await load("src/core/field-native-npc.js");
run("explicit birdview NPC flat lane draws through the same Renderer with source layer and the same native animation owner",()=>{
 const t=fixture(),source={file:"controlled-flat-npc.bundle",assetPath:"Room/entities.json",pointer:"/layers/0/objects/0"},asset=Object.keys(t.f.characters)[0],
   entity={id:"603",kind:6,layer:1,source},raw={x:64,y:80,width:16,height:16},properties={object_type:6,entity_id:603,asset_id:77,direction:4,move_type:0,birdview_puppet:true,all_layers:false};
 const result=compileFieldNativeNpc({group:"entity_default",object:raw,entity,properties,tables:{"mapobject.csv":[{id:"77",asset_name:asset,shadow_type:"0"}]},flatProjection:"web-source-npc-flat-projection-v1"});assert.ok(result.definition);
 const metadata=prepareFieldNativeNpcGroup({definitions:[result.definition],factory:t.f.factory,characters:t.f.characters,mapRange:t.f.map.mapRange,providers:t.f.input.providers,existingActorIds:Object.keys(t.actors),standbyAnchorPosition:{x:30000,y:30000}}).actors[0],
   actor=createNativeFieldActorProjection(metadata,t.f.map.mapRange,t.f.partyCatalog),native=actor.native.entity,animation=actor.animation;
 t.actors[actor.id]=actor;t.player.native.entity.visible=false;t.content.developmentProfile={npcProjection:"web-source-npc-flat-projection-v1"};
 t.renderer.draw(t.game);const visible=t.canvas.getContext().data.slice();assert(visible.some((v,i)=>i%4===0&&v===255));
 assert.equal(actor.layer,1);assert.equal(native.layer,10);assert.equal(native.position.z,249);assert.equal(actor.native.entity,native);assert.equal(actor.animation,animation);
 native.visible=false;t.renderer.draw(t.game);assert.notDeepEqual(t.canvas.getContext().data,visible);native.visible=true;t.renderer.draw(t.game);assert.deepEqual(t.canvas.getContext().data,visible);
 assert.equal(actor.native.entity,native);assert.equal(actor.animation,animation);
});
const report={kind:"animated-map-entity-actual-renderer-v1",passed:tests.length,tests,controlledCanvas:true,browserVerified:false,nativeParity:false};
await writeFile(resolve(root, "build/reports/field-native-composition-ui-check.json"),JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify({passed:tests.length,controlledCanvas:true,browserVerified:false}));
