// Production Renderer with a real controlled GameSession and recorded RGBA
// Canvas. This is display wiring evidence, not a browser/native pixel oracle.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = resolve(import.meta.dirname, '..'), args = process.argv.slice(2);
assert(!args.length || args.length === 2 && args[0] === '--compiled-dir');
const compiled = resolve(root, args[1] ?? 'dist'), load = name => import(pathToFileURL(resolve(compiled, name + '.js')).href);
const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(specifier.startsWith('/runtime/') ? pathToFileURL(resolve(compiled, 'src', specifier.slice(9))).href : specifier, context);
} });
let Renderer; try { ({ Renderer } = await import(pathToFileURL(resolve(root, 'apps/game/renderer.js')).href)); } finally { hooks.deregister(); }
const [{ birdViewActorsFixture, birdHost }, { fieldActorFactoryFixture }, { compileFieldNativeComposition }] = await Promise.all([
  load('tests/fixtures/bird-view-actors'), load('tests/fixtures/field-actor-factory'), load('src/compiler/field-native-composition'),
]);
class Canvas {
  constructor(width = 0, height = 0) { this.width = width; this.height = height; this.draws = []; this.ownerDocument = { createElement: () => new Canvas() }; }
  getContext() { return this.context ??= new Context(this); }
}
class Context {
  constructor(canvas) { this.canvas = canvas; this.data = new Uint8ClampedArray(canvas.width * canvas.height * 4); this.globalAlpha = 1; this.transform = { x: 0, y: 0, sx: 1, sy: 1 }; this.stack = []; }
  save() { this.stack.push({ transform: { ...this.transform }, globalAlpha: this.globalAlpha }); }
  restore() { Object.assign(this, this.stack.pop()); }
  translate(x, y) { this.transform.x += this.transform.sx * x; this.transform.y += this.transform.sy * y; }
  scale(x, y) { this.transform.sx *= x; this.transform.sy *= y; }
  createImageData(width, height) { return { width, height, data: new Uint8ClampedArray(width * height * 4) }; }
  getImageData() { return { width: this.canvas.width, height: this.canvas.height, data: this.data.slice() }; }
  fillRect() { for (let i = 0; i < this.data.length; i += 4) this.data.set([9, 17, 27, 255], i); }
  drawImage(image, ...args) {
    this.canvas.draws.push({ args, transform: { ...this.transform } });
    const src = image instanceof Canvas ? image.getContext().data : image.data;
    const [sx, sy, sw, sh, dx, dy, dw, dh] = args.length === 2 ? [0, 0, image.width, image.height, ...args, image.width, image.height] : args;
    for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
      const t = this.transform, tx = Math.floor(t.x + t.sx * (dx + x + .5)), ty = Math.floor(t.y + t.sy * (dy + y + .5));
      if (tx < 0 || ty < 0 || tx >= this.canvas.width || ty >= this.canvas.height) continue;
      const si = (Math.floor(sy + y * sh / dh) * image.width + Math.floor(sx + x * sw / dw)) * 4, di = (ty * this.canvas.width + tx) * 4;
      this.data.set(src.slice(si, si + 4), di);
    }
  }
}
const f = await birdViewActorsFixture(), { game, flow } = await f.make(), field = game.field;
assert(field.startEvent('bird-up')); const actor = field.actors['native:puppet:0'], entity = actor.native.entity;
const ground = structuredClone(entity.position), camera = field.cameraSnapshot;
const images = new Map(); for (const character of Object.values(field.content.characters)) for (const sprite of Object.values(character.sprites)) {
  const data = new Uint8ClampedArray(sprite.width * sprite.height * 4);
  for (let i = 0; i < data.length; i += 4) data.set([255, 0, 0, 255], i);
  images.set(sprite.file, { width: sprite.width, height: sprite.height, data });
}
const canvas = new Canvas(512, 512), renderer = new Renderer(canvas, field.content, images);
const draw = () => { renderer.actor(actor, -128, -128, renderer.point(actor), renderer.actorElevation(field, actor)); return canvas.draws.at(-1); };
const first = draw(); assert.equal(renderer.actorElevation(field, actor), 0);
// A controlled material definition from the same real native fixture is only
// an offscreen render dependency; it cannot mutate the live content or actor.
const material = fieldActorFactoryFixture(), prefix = 'FINAL FANTASY VI_Data/StreamingAssets/aa/StandaloneWindows64/';
material.sources.push({ file: prefix + 'map_common_assets_all_320e510e7137e96ac91fe79e18fdd504.bundle', sha256: 'c46413a1c208556af2ce202aab276e6ecefc54863229bbb77af38bb0f766233a' },
  { file: prefix + 'shaders_assets_all_46e9e3032245a8a2ff9ff3236afcb55a.bundle', sha256: '56bebde18b58f95d3e4f9cd23e7e2c13e83892075606f1a85b5c92ac81ce1c6e' });
const nativeComposition = compileFieldNativeComposition(material.sources, material.view, material.tilemap);
assert.equal(nativeComposition.contextId, entity.viewBinding.properties.contextId);
const nativeContent = { ...field.content, map: { ...field.content.map, nativeComposition } }, nativeRenderer = new Renderer(new Canvas(512, 512), nativeContent, images);
const projection = field.cameraProjection({ aspect: 1, orthographicSize: 256, isClamp: true, effectOffset: { x: 0, y: 0 } });
const nativeFrame = () => nativeRenderer.prepareNativeComposition(field, [actor], projection, -128, -128, 512, 512, null);
const bounds = image => { const rows = []; for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
  const at = (y * image.width + x) * 4; if (image.data[at] === 255 && image.data[at + 1] === 0 && image.data[at + 2] === 0) rows.push([x, y]);
} assert(rows.length); return { x: Math.min(...rows.map(r => r[0])), y: Math.min(...rows.map(r => r[1])), pixels: rows.length }; };
const nativeFirst = bounds(nativeFrame()); flow.advance(250, birdHost); const second = draw(), nativeSecond = bounds(nativeFrame());
assert.equal(field.birdViewActorElevation(actor.id), 60); assert.equal(second.transform.x, first.transform.x); assert.equal(second.transform.y, first.transform.y - 60);
assert.equal(nativeSecond.x, nativeFirst.x); assert.equal(nativeSecond.y, nativeFirst.y - 60); assert.equal(nativeSecond.pixels, nativeFirst.pixels);
assert.equal(field.actors[actor.id], actor); assert.equal(actor.native.entity, entity); assert.deepEqual(entity.position, ground); assert.deepEqual(field.cameraSnapshot, camera);
assert.equal(renderer.actorElevation(field, field.player), 0); assert.throws(() => renderer.actorElevation({}, actor), /所有者/);
const report = { kind: 'field-bird-view-actor-production-renderer-v1', result: 'passed', checks: ['actual-GameSession-PuppetCore-component', 'fallback-Canvas-single-actor-60px-lift', 'native-material-RGBA-same-60px-lift-and-pixel-count', 'ground-camera-and-other-actor-unchanged', 'unknown-render-owner-rejected'],
  nativeDynamicParity: false, browserVerified: false, sourceExecutions: 0, worldCompilations: 0, publications: 0 };
await mkdir(resolve(root, 'build/reports'), { recursive: true }); await writeFile(resolve(root, 'build/reports/field-bird-view-actors-ui.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report));
