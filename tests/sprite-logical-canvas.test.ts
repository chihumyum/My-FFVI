import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { validateSpriteLogicalCanvas, SPRITE_LOGICAL_CANVAS, sourceCanvasRgba, assertWorldMediaAdapter } from "../src/compiler/sprite-logical-canvas.js";

function fixture(filter=0) {
  const width=5,height=5,rgba=Buffer.alloc(width*height*4),crop=Buffer.from([91,20,11,127,42,31,19,0]);
  crop.copy(rgba,(2*width+1)*4);
  const chunk=(kind:string,data:Buffer)=>{const size=Buffer.alloc(4);size.writeUInt32BE(data.length);return Buffer.concat([size,Buffer.from(kind),data,Buffer.alloc(4)]);};
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
  const scan=Buffer.alloc((width*4+1)*height);
  for(let y=0;y<height;y++) {scan[y*(width*4+1)]=filter;for(let x=0;x<width*4;x++) {
    const i=y*width*4+x,a=x<4?0:rgba[i-4]!,b=y?rgba[i-width*4]!:0,c=!y||x<4?0:rgba[i-width*4-4]!,p=a+b-c,
      paeth=Math.abs(p-a)<=Math.abs(p-b)&&Math.abs(p-a)<=Math.abs(p-c)?a:Math.abs(p-b)<=Math.abs(p-c)?b:c;
    scan[y*(width*4+1)+x+1]=(rgba[i]!-[0,a,b,Math.floor((a+b)/2),paeth][filter]!)&255;
  }}
  const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(scan)),chunk('IEND',Buffer.alloc(0))]);
  const proof={kind:SPRITE_LOGICAL_CANVAS,metadata:{logicalRect:[0,0,width,height],pivot:[.5,0],pixelsPerUnit:1,textureRect:[0,.125,2,1],
    textureRectOffset:[1,2.125],atlasRectOffset:[0,-24],settingsRaw:1,packed:true,packingMode:0,packingRotation:0,downscaleMultiplier:1,
    mesh:{vertices:[[-1.5,2,0],[.5,2,0],[.5,3,0]],uv:[[0,0],[0,0],[0,0]],triangles:[[[0,1,2]]]}},
    decodedSize:[2,1],decodedRgbaSha256:createHash('sha256').update(crop).digest('hex'),padding:{left:1,right:2,top:2,bottom:2}};
  return {png,proof,sprite:{width,height,pivot:[.5,0]},rgba};
}
test("all PNG filters preserve exact source crop, zero-alpha colors and original logical anchor",()=>{
  for(let filter=0;filter<5;filter++){const f=fixture(filter);assert.deepEqual(sourceCanvasRgba(f.png,5,5),f.rgba);
    assert.deepEqual(validateSpriteLogicalCanvas(f.proof,f.sprite,f.png),f.proof);}
});
test("unknown geometry, wrong anchor, modified alpha and malformed PNG cannot claim source projection",()=>{
  const f=fixture();
  const mutations=[(p:typeof f.proof)=>{p.padding.top=1;},(p:typeof f.proof)=>{p.metadata.mesh.uv[0]![0]=.5;},
    (p:typeof f.proof)=>{p.metadata.mesh.vertices[0]![0]= -1.25;},(p:typeof f.proof)=>{p.metadata.settingsRaw=128;},
    (p:typeof f.proof)=>{p.decodedRgbaSha256="0".repeat(64);}];
  for(const change of mutations){const p=structuredClone(f.proof);change(p);assert.throws(()=>validateSpriteLogicalCanvas(p,f.sprite,f.png));}
  assert.throws(()=>sourceCanvasRgba(f.png.subarray(0,-1),5,5));
  assert.throws(()=>validateSpriteLogicalCanvas(f.proof,{...f.sprite,width:6},f.png));
});
test("media generation declares its entire Sprite projection domain",()=>{
  assertWorldMediaAdapter({adapterVersion:'world-media-0.1.0'});
  assert.throws(()=>assertWorldMediaAdapter({adapterVersion:'world-media-0.1.0',spriteLogicalCanvas:{}}));
  const f=fixture(),source={file:'source.bundle',assetPath:'Sprite.png',objectId:'-9223372036854775807'},sprite={...f.sprite,source,
    sha256:'a'.repeat(64),representation:SPRITE_LOGICAL_CANVAS,logicalCanvas:f.proof};
  const media={adapterVersion:'world-media-0.2.0',characters:{asset:{sprites:{Default:sprite}}},
    spriteLogicalCanvas:{kind:SPRITE_LOGICAL_CANVAS,projections:[{asset:'asset',sprite:'Default',source,imageSha256:sprite.sha256,padding:f.proof.padding}],unresolved:[]}};
  assertWorldMediaAdapter(media);
  assert.throws(()=>assertWorldMediaAdapter({...media,spriteLogicalCanvas:{...media.spriteLogicalCanvas,projections:[]}}));
});
