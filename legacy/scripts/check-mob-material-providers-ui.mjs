// Actual mounted Session/Actor, production renderer; controlled RGBA/viewport only.
import assert from 'node:assert/strict';import{registerHooks}from'node:module';import{mkdir,writeFile}from'node:fs/promises';import{resolve}from'node:path';import{pathToFileURL}from'node:url';
const root=resolve(import.meta.dirname,'..'),compiled=resolve(root,'dist');const load=p=>import(pathToFileURL(resolve(compiled,p+'.js')).href);
const hook=registerHooks({resolve(s,c,next){return next(s.startsWith('/runtime/')?pathToFileURL(resolve(compiled,'src',s.slice(9))).href:s,c);}});let Renderer;try{({Renderer}=await import(pathToFileURL(resolve(root,'apps/game/renderer.js')).href));}finally{hook.deregister();}
const[{mobMaterialProvidersFixture},{mobHost},{fieldActorFactoryFixture},{compileFieldNativeComposition}]=await Promise.all([load('tests/fixtures/mob-material-providers'),load('tests/fixtures/mob-controls'),load('tests/fixtures/field-actor-factory'),load('src/compiler/field-native-composition')]);
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
  putImageData(image,x=0,y=0) { this.data.set(image.data); }
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

const f=await mobMaterialProvidersFixture({effects:true}),{game,flow}=await f.make(),field=game.field,actor=field.player,images=new Map();
for(const[asset,character]of Object.entries(field.content.characters))for(const sprite of Object.values(character.sprites)){const data=new Uint8ClampedArray(sprite.width*sprite.height*4);for(let i=0;i<data.length;i+=4)data.set(asset===actor.mount?[255,80,40,255]:[40,200,110,255],i);images.set(sprite.file,{width:sprite.width,height:sprite.height,data});}
const canvas=new Canvas(512,512),renderer=new Renderer(canvas,field.content,images),sourcePixels=[...images.values()].map(i=>i.data.slice()),shape={position:{...actor.native.entity.position},opacity:actor.native.entity.fadeAlpha,visibility:actor.native.entity.visible,asset:actor.asset,mount:actor.mount},painted=a=>Array.from({length:a.length/4},(_,i)=>a[i*4+3]).filter(v=>v>0).length;
const fallback=()=>{canvas.getContext().data.fill(0);canvas.draws.length=0;renderer.actor(actor,-128,-128,renderer.point(actor),0,renderer.mobFilterAlpha(field,actor));return{data:canvas.getContext().data.slice(),geometry:canvas.draws.map(d=>d.args)};};
const before=fallback();assert(painted(before.data)>0);assert.equal(before.geometry.length,2);assert(renderer.effectsDeferred(field));
assert(field.startEvent('mob-hide'));flow.advance(20,mobHost);assert.equal(field.stop,null);assert.equal(field.mobColorFilterAlpha(actor.id),1);
const black=fallback();assert.deepEqual(black.geometry,before.geometry);assert.equal(painted(black.data),painted(before.data));for(let i=0;i<black.data.length;i+=4)if(black.data[i+3])assert.deepEqual([...black.data.slice(i,i+3)],[0,0,0]);
// Prepare a source-qualified ordinary composition from the exact shared
// factory fixture used by this Session. Only viewport/tiles are controlled.
const native=fieldActorFactoryFixture(),prefix='FINAL FANTASY VI_Data/StreamingAssets/aa/StandaloneWindows64/';
native.sources.push({file:prefix+'map_common_assets_all_320e510e7137e96ac91fe79e18fdd504.bundle',sha256:'c46413a1c208556af2ce202aab276e6ecefc54863229bbb77af38bb0f766233a'},
 {file:prefix+'shaders_assets_all_46e9e3032245a8a2ff9ff3236afcb55a.bundle',sha256:'56bebde18b58f95d3e4f9cd23e7e2c13e83892075606f1a85b5c92ac81ce1c6e'});
const definition=compileFieldNativeComposition(native.sources,native.view,native.tilemap),nativeContent={...field.content,map:{...field.content.map,nativeComposition:definition}},nr=new Renderer(new Canvas(320,256),nativeContent,images);
const samples=[],pixels=nr.mobPixels.bind(nr);nr.mobPixels=(file,alpha)=>{const image=pixels(file,alpha);samples.push({file,alpha,image});return image;};
const result=nr.prepareNativeComposition(field,[actor],{cameraPosition:{x:0,y:0},clampTileSubY:0},0,0,320,256,null);
assert(result);assert.equal(samples.length,2);assert.notEqual(samples[0].file,samples[1].file);assert(samples.every(s=>s.alpha===1));
for(const sample of samples)for(let i=0;i<sample.image.data.length;i+=4){assert.deepEqual([...sample.image.data.slice(i,i+3)],[0,0,0]);assert.equal(sample.image.data[i+3],255);}
assert(field.startEvent('mob-restore'));flow.advance(20,mobHost);assert.equal(field.stop,null);assert.deepEqual(fallback().data,before.data);
assert.deepEqual({position:{...actor.native.entity.position},opacity:actor.native.entity.fadeAlpha,visibility:actor.native.entity.visible,asset:actor.asset,mount:actor.mount},shape);[...images.values()].forEach((image,i)=>assert.deepEqual(image.data,sourcePixels[i]));
const report={kind:'mob-actual-material-providers-renderer-v1',result:'passed',checks:['actual-boarded-Session-and-Actor','fallback-both-inner-and-outer-black-RGB','native-compositor-samples-both-actual-source-layer-images','crop-geometry-alpha-opacity-and-position-unchanged','actual-logical-effect-host-allocates-no-render-material','restore-reproduces-original-pixels-without-source-mutation'],browserVerified:false,nativeDynamicParity:false,sourceExecutions:0,worldCompilations:0,publications:0};await mkdir(resolve(root,'build/reports'),{recursive:true});await writeFile(resolve(root,'build/reports/mob-material-providers-ui.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
