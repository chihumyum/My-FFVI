// Real production Renderer + actual Session; recorded RGBA is a controlled Web probe.
import assert from 'node:assert/strict';import{registerHooks}from'node:module';import{mkdir,writeFile}from'node:fs/promises';import{resolve}from'node:path';import{pathToFileURL}from'node:url';
const root=resolve(import.meta.dirname,'..'),args=process.argv.slice(2);assert(!args.length||args.length===2&&args[0]==='--compiled-dir');const compiled=resolve(root,args[1]??'dist');
const hooks=registerHooks({resolve(s,c,next){return next(s.startsWith('/runtime/')?pathToFileURL(resolve(compiled,'src',s.slice(9))).href:s,c);}});let Renderer;try{({Renderer}=await import(pathToFileURL(resolve(root,'apps/game/renderer.js')).href));}finally{hooks.deregister();}
const{mobControlsFixture,mobHost}=await import(pathToFileURL(resolve(compiled,'tests/fixtures/mob-controls.js')).href);
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

const f=await mobControlsFixture(),{game,flow}=await f.make(),field=game.field,actor=field.player,images=new Map();
for(const character of Object.values(field.content.characters))for(const sprite of Object.values(character.sprites)){const data=new Uint8ClampedArray(sprite.width*sprite.height*4);for(let i=0;i<data.length;i+=4)data.set([255,80,40,255],i);images.set(sprite.file,{width:sprite.width,height:sprite.height,data});}
const canvas=new Canvas(512,512),renderer=new Renderer(canvas,field.content,images),sourcePixels=[...images.values()].map(i=>i.data.slice()),position={...actor.native.entity.position},opacity=actor.native.entity.fadeAlpha,visibility=actor.native.entity.visible;
const draw=()=>{canvas.getContext().data.fill(0);renderer.actor(actor,-128,-128,renderer.point(actor),renderer.actorElevation(field,actor),renderer.mobFilterAlpha(field,actor));return canvas.getContext().data.slice();};
const before=draw(),paint=a=>Array.from({length:a.length/4},(_,i)=>a[i*4+3]).filter(v=>v>0).length;assert(paint(before)>0);
assert(field.startEvent('mob-hide'));flow.advance(30,mobHost);assert.equal(field.stop,null);const black=draw();assert.equal(paint(black),paint(before));for(let i=0;i<black.length;i+=4)if(black[i+3])assert.deepEqual([...black.slice(i,i+3)],[0,0,0]);
assert.deepEqual(actor.native.entity.position,position);assert.equal(actor.native.entity.fadeAlpha,opacity);assert.equal(actor.native.entity.visible,visibility);
assert(field.startEvent('mob-restore'));flow.advance(30,mobHost);assert.deepEqual(draw(),before);
assert(field.startEvent('mob-darken'));flow.advance(50,mobHost);const alpha=field.mobColorFilterAlpha(actor.id);assert(alpha>0&&alpha<1);const frame=actor.animation.frame(),sprite=field.content.characters[actor.asset].sprites[frame.sprite],material=renderer.mobPixels(sprite.file,alpha);assert.equal(material.data[0],Math.round(255*(1-alpha)));assert.equal(material.data[3],255);
assert.throws(()=>renderer.mobFilterAlpha({},actor),/actual authorized/);[...images.values()].forEach((image,i)=>assert.deepEqual(image.data,sourcePixels[i]));
const report={kind:'field-mob-color-production-renderer-v1',result:'passed',checks:['actual-Session-Main-and-live-Actor','production-fallback-Canvas-black-RGB-preserves-sprite-alpha','restored-material-reproduces-original-pixels','native-material-source-pixels-use-the-same-actual-alpha','original-source-pixels-opacity-position-and-visibility-unchanged','unknown-render-owner-rejected'],browserVerified:false,nativeDynamicParity:false,sourceExecutions:0,worldCompilations:0,publications:0};await mkdir(resolve(root,'build/reports'),{recursive:true});await writeFile(resolve(root,'build/reports/field-mob-controls-ui.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
