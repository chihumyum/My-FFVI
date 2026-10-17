// Actual production Canvas lane, controlled pixels and exact source PNGs.
// No public build, browser run, source story execution or Unity parity.
import assert from "node:assert/strict";
import { readFile,writeFile,mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { Canvas,decodeLayerTestPng } from "./field-layer-renderer-fixture.mjs";
const args=process.argv.slice(2);assert.equal(args.length,4);assert.equal(args[0],"--source-root");assert.equal(args[2],"--source-catalog");
const root=resolve(import.meta.dirname,".."),sourceRoot=resolve(args[1]),bytes=await readFile(resolve(args[3])),catalog=JSON.parse(bytes),sha=b=>createHash("sha256").update(b).digest("hex"),compiled=resolve(root,"dist"),load=n=>import(pathToFileURL(resolve(compiled,n+".js")));
const hook=registerHooks({resolve(s,c,next){return next(s.startsWith("/runtime/")?pathToFileURL(resolve(compiled,"src",s.slice(9))).href:s,c);}});let Renderer;try{({Renderer}=await import("../apps/game/renderer.js"));}finally{hook.deregister();}
const [{FieldLayerScrolling,fieldLayerTweenSample},{verifyFieldSceneryWorldCatalog},{nonEncounterFieldContent},{FieldGame}]=await Promise.all([load("src/core/field-layer-scrolling"),load("src/compiler/field-background"),load("tests/fixtures/non-encounter-area-session"),load("src/core/field")]);verifyFieldSceneryWorldCatalog(catalog);
const tests=[];globalThis.OffscreenCanvas=Canvas;
const c=nonEncounterFieldContent(),layer={name:"BottomLayer",width:12,height:12,data:Array.from({length:144},(_,i)=>i%12%2+1),opacity:1};c.map.layers=[layer];c.map.tilesets=[{firstgid:1,tilewidth:16,tileheight:16,columns:2,image:"authored"}];c.map.textures={authored:"authored.png"};c.developmentProfile={kind:"framework-development-v1",policy:"omit-anonymous-environment-particles-v1",sourceContentHash:"e".repeat(64),omissions:[],fieldLayerScrolling:"web-field-layer-scrolling-v1"};
const command={kind:"tween",mask:1,layers:[0],axis:"x",from:0,to:16,seconds:1,easing:"linear"};c.scripts.scroll=[{kind:"field-layer-scrolling",command,script:"scroll",index:0,source:c.map.source},{kind:"exit",script:"scroll",index:1,source:c.map.source}];
const field=new FieldGame(c,undefined,undefined,undefined,{fieldLayerScrolling:"web-field-layer-scrolling-v1"}),tileImage={width:32,height:16,data:new Uint8ClampedArray(32*16*4)};for(let y=0;y<16;y++)for(let x=0;x<32;x++)tileImage.data.set(x<16?[255,0,0,255]:[0,255,0,255],(y*32+x)*4);
const canvas=new Canvas(32,16),renderer=new Renderer(canvas,c,new Map([["authored.png",tileImage]])),draw=()=>{canvas.getContext().clearRect();renderer.layer(layer,0,0,32,16,field,0);return canvas.getContext().data.slice();},at=(data,x)=>[...data.slice(x*4,x*4+4)],position={x:field.player.x,y:field.player.y},cells=[...layer.data];
assert.deepEqual(at(draw(),0),[255,0,0,255]);assert(field.startEvent("scroll"));field.advance(500);const middle=draw();assert.deepEqual(at(middle,0),[255,0,0,255]);assert.deepEqual(at(middle,8),[0,255,0,255]);field.advance(500);assert.deepEqual(at(draw(),0),[0,255,0,255]);assert.equal(field.busy,false);assert.deepEqual({x:field.player.x,y:field.player.y},position);assert.deepEqual(layer.data,cells);tests.push("actual Field finite tween moves production Canvas tile positions while retaining actor/collision cells");
let imageEvidence=null;
for(const[mapId,map]of Object.entries(catalog.maps)){
  for(const target of map.layers.filter(l=>l.scenery===1&&l.blend===0&&l.texture.width>16)){
    const png=await readFile(resolve(sourceRoot,"build",target.texture.url.slice(1)));assert.equal(sha(png),target.texture.sha256);const image=decodeLayerTestPng(png);assert.equal(image.width,target.texture.width);assert.equal(image.height,target.texture.height);
    const width=Math.min(128,image.width),height=Math.min(512,image.height),surface=new Canvas(width,height),r=new Renderer(surface,{map:{tilesets:[],backgrounds:[],scenery:map}},new Map([[target.texture.url,image]])),owner=new FieldLayerScrolling("source-renderer-"+mapId,[],map);
    const actions=map.layers.map(l=>({kind:l.id===target.id&&l.scenery===1?"show":"hide",id:l.id,scenery:l.scenery,seconds:0}));owner.prepare({kind:"apply",actions}).commit();
    const game={get fieldSceneryProjection(){return{catalog:map,state:owner.snapshot()}}},render=()=>{r.background(surface.getContext(),{cameraPosition:{x:0,y:0}},width,height,undefined,undefined,game);return surface.getContext().data.slice();},before=render();owner.prepare({kind:"apply",actions:[{kind:"scenery-velocity",id:target.id,scenery:1,enabled:true,x:16,y:0}]}).commit();owner.advance(1000);const after=render();
    if(Buffer.compare(Buffer.from(before),Buffer.from(after))===0)continue;
    let compared=0;for(let y=0;y<height;y++)for(let x=16;x<width;x++){const a=(y*width+x)*4,b=(y*width+x-16)*4;assert.deepEqual([...after.slice(a,a+4)],[...before.slice(b,b+4)]);compared++;}
    imageEvidence={mapId,source:target.source,texture:target.texture,viewport:{width,height},sourceProviderCatalogHash:catalog.contentHash,scenery:target.scenery,id:target.id,speed:{x:16,y:0},seconds:1,pixelOffset:owner.snapshot().scenery.find(l=>l.id===target.id&&l.scenery===1).offset,comparedPixels:compared,pixelsBeforeSha256:sha(before),pixelsAfterSha256:sha(after),sourceBodiesExecuted:0,nativeParity:false};break;
  }if(imageEvidence)break;
}
assert(imageEvidence,"No source image position evidence");tests.push("actual source PNG moves sixteen pixels through production scenery Canvas lane with every overlap pixel compared");
await mkdir(resolve(root,"build/reports"),{recursive:true});const report={kind:"field-layer-actual-renderer-v1",result:"passed",tests,passed:tests.length,sourceCatalogSha256:sha(bytes),sourceCatalogHash:catalog.contentHash,imageEvidence,controlledCanvas:true,browserVerified:false,nativeParity:false,sourceBodiesExecuted:0,worldCompilations:0,publications:0};await writeFile(resolve(root,"build/reports/field-layer-renderer.json"),JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify({result:report.result,passed:tests.length,sourceImageMap:imageEvidence.mapId,comparedPixels:imageEvidence.comparedPixels,nativeParity:false}));
