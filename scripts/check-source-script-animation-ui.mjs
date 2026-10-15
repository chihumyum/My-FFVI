// Custom source animation frames through actual production Renderer/native projections.
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

const {compileSourceScriptAnimations}=await load('src/compiler/source-script-animations.js'),{SOURCE_FORMAT_FLAG_IMPORT}=await load('src/core/source-format-import.js'),{hash}=await load('src/compiler/content.js'),{runtimeDigest}=await import('./runtime-digest.mjs');
const runtimeSha256=await runtimeDigest(root,args[1]??'dist'),cases=[];
function install(t,{x=3,y=4,alpha=1,flip=false}={}){
 const source={file:'authored-animation.bundle',assetPath:'Authored/Pose.json',objectId:'9007199254740993',serializedFile:'authored-cab',sha256:'a'.repeat(64)},sources=[{file:'GameAssembly.dll',sha256:SOURCE_FORMAT_FLAG_IMPORT.nativeSha256},{file:source.file,sha256:source.sha256}],
 result=compileSourceScriptAnimations({sourceSetHash:hash(sources),manifest:{parentSourceSetHash:'d'.repeat(64),sources},assets:[{id:'authored-pose',kind:'script',source,data:{SystemFlag:{},Animations:[{name:'CustomPose',frames:[{sprite_name:'body',offsetx:x,offsety:y,alpha,rgb:{r:1,g:1,b:1,a:1},flip}],play_speed:.1,play_mode:0,is_reverse:false,next_anim_name:''}]}}]});
 const animation=t.player.animation.clone();animation.prepareSourceCustomKey('CustomPose',result.byProgram['authored-pose'],{catalog:result.catalog,baseKeys:Object.keys(animation.character.animations)});animation.cue('CustomPose',0);t.player.animation=animation;return result;
}
function bounds(t){const data=t.canvas.getContext().data,points=[];for(let y=0;y<t.canvas.height;y++)for(let x=0;x<t.canvas.width;x++){const i=(y*t.canvas.width+x)*4;if(data[i]===255&&data[i+1]===0&&data[i+2]===0)points.push([x,y]);}assert.ok(points.length);return [Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))];}
{
 const baseline=fixture();baseline.renderer.draw(baseline.game);const original=bounds(baseline),t=fixture(),before={x:t.player.x,y:t.player.y,layer:t.player.layer,direction:t.player.direction,position:structuredClone(t.player.native.entity.position)};install(t);assert.equal(t.content.characters[t.player.asset].animations.CustomPose,undefined);t.renderer.draw(t.game);
 assert.deepEqual(bounds(t),[original[0]+3,original[1]-4,original[2]+3,original[3]-4]);assert.equal(t.canvas.puts,1);assert.deepEqual({x:t.player.x,y:t.player.y,layer:t.player.layer,direction:t.player.direction,position:t.player.native.entity.position},before);cases.push('actual native composition uses custom resolved sprite+offset without changing logical pose or base dictionary');
}
{
 const t=fixture();install(t,{x:0,y:0,alpha:.5,flip:true});for(let y=0;y<24;y++)for(let x=0;x<16;x++)t.image.data.set(x<8?[255,0,0,255]:[0,255,0,255],(y*16+x)*4);t.renderer.draw(t.game);const at=x=>[...t.canvas.getContext().data.slice((49*320+x)*4,(49*320+x)*4+4)];assert.deepEqual(at(49),[0,255,0,128]);assert.deepEqual(at(62),[255,0,0,128]);cases.push('actual Canvas publication retains per-frame flip and constant alpha under existing native material');
}
{
 const t=fixture();install(t);t.renderer.images.clear();assert.throws(()=>t.renderer.draw(t.game));assert.equal(t.canvas.puts,0);assert.equal(t.canvas.draws.length,0);cases.push('missing actual sprite image rejects before visible Canvas publication');
}
assert.equal(await runtimeDigest(root,args[1]??'dist'),runtimeSha256);const report={kind:'controlled-source-script-animation-renderer-check-v1',runtimeSha256,cases,result:'passed',actualRenderer:true,actualNativeActorProjection:true,actualCanvasPixels:true,originalSourceExecutions:0,originalProgramExecutions:0,browserExecuted:false,originalGameParity:false};await mkdir(resolve(root,'build/reports'),{recursive:true});await writeFile(resolve(root,'build/reports/source-script-animation-ui-check.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
