import test from "node:test";
import assert from "node:assert/strict";
import {FieldGame}from "../src/core/field.js";
import {compileFieldMapTransform,compileFieldWaterCatalog}from "../src/compiler/field-map-transforms.js";
import {projectFieldWaterLayers,FieldMapTransforms,WEB_FIELD_MAP_TRANSFORMS,projectFlatOrient,fieldRenderAreaSample,projectFlatWaterPixels,flatMapViewport,type FieldMapTransformCommand}from "../src/core/field-map-transforms.js";
import {nonEncounterFieldContent,nonEncounterSource}from "./fixtures/non-encounter-area-session.js";
import {fieldPuppetActorsFixture}from "./fixtures/field-puppet-actors.js";
const source=nonEncounterSource;
export function mapTransformFixture(){
  const content=nonEncounterFieldContent();content.sourceSetHash="a".repeat(64);content.parentSourceSetHash="b".repeat(64);
  content.map.layers=[{name:"BottomWater",sourceGroup:"WaterGroup",width:12,height:12,data:Array(144).fill(0),opacity:1}];
  content.map.water=compileFieldWaterCatalog({sourceSetHash:content.sourceSetHash,parentSourceSetHash:content.parentSourceSetHash,tilemap:{source,data:{width:12,height:12,layers:[{type:"group",name:"WaterGroup",visible:true,opacity:1,layers:[{...content.map.layers[0],type:"tilelayer",visible:true,id:3}],properties:[]}]}}});
  content.map.layers=projectFieldWaterLayers(content.map,content.map.water);
  content.developmentProfile={kind:"framework-development-v1",policy:"omit-anonymous-environment-particles-v1",sourceContentHash:"e".repeat(64),omissions:[],mapTransforms:WEB_FIELD_MAP_TRANSFORMS};
  const install=(name:string,command:FieldMapTransformCommand)=>content.scripts[name]=[{kind:"field-map-transform",command,script:name,index:0,source},{kind:"exit",script:name,index:1,source}];
  install("zoom",{kind:"render-area",target:0,from:1,to:2,seconds:1,heightFrom:1,heightTo:1});
  install("water",{kind:"water",target:0,key:"_WaterOffsetY",from:0,to:48,seconds:1});
  install("instant",{kind:"water",target:0,key:"_WaterOffsetY",from:32,to:80,seconds:0});
  install("absent",{kind:"water",target:1,key:"_WaterOffsetY",from:0,to:80,seconds:0});
  const field=new FieldGame(content,undefined,undefined,undefined,{mapTransforms:WEB_FIELD_MAP_TRANSFORMS});return{content,field,install};
}
test("source wrappers preserve selector identity, complete operands and independent unknown keys",()=>{
  const raw=(mnemonic:string,type:number,i:number[],r:number[],s:string[])=>({mnemonic,type,operands:{iValues:[...i,...Array(8-i.length).fill(0)],rValues:[...r,...Array(8-r.length).fill(0)],sValues:[...s,...Array(8-s.length).fill("")]}});
  assert.deepEqual(compileFieldMapTransform(raw("Orient",2,[-1001],[],[])).command,{kind:"orient",target:-1001});
  assert.deepEqual(compileFieldMapTransform(raw("Water",1,[0],[32,80,0],["_WaterOffsetY"])).command,{kind:"water",target:0,key:"_WaterOffsetY",from:32,to:80,seconds:0});
  assert.throws(()=>compileFieldMapTransform(raw("Water",1,[0],[1,2,1],["unknown"])),/Unknown Water/);
  assert.throws(()=>compileFieldMapTransform(raw("Orient",2,[0],[1],[])),/operand form/);
});
test("explicit Web look consumes world target vector, Y polarity, diagonal/tie/zero rules",()=>{
  assert.equal(projectFlatOrient({x:0,y:0},{x:2,y:1},"down"),"right");assert.equal(projectFlatOrient({x:0,y:0},{x:2,y:2},"down"),"up");
  assert.equal(projectFlatOrient({x:0,y:0},{x:0,y:0},"left"),"left");assert.throws(()=>projectFlatOrient({x:0,y:0},{x:0,y:0},null),/existing direction/);
});
test("water uses real named source layer, zero-duration start key, asynchronous clock and atomic missing-layer rejection",()=>{
  const{field}=mapTransformFixture();const actors={x:field.player.x,y:field.player.y};assert(field.startEvent("water"));assert.equal(field.busy,false);assert.equal(field.checkpointReady,false);
  field.advance(500);assert.equal(field.mapTransformSnapshot!.water[0]!.values._WaterOffsetY,24);field.advance(500);assert(field.checkpointReady);
  assert(field.startEvent("instant"));assert.equal(field.mapTransformSnapshot!.water[0]!.values._WaterOffsetY,32);
  const before=field.mapTransformSnapshot;assert(field.startEvent("absent"));assert.equal(field.stop?.kind,"unsupported");assert.deepEqual(field.mapTransformSnapshot,before);assert.deepEqual({x:field.player.x,y:field.player.y},actors);
});
test("render-area owns Core first-clock values and finite wait without changing actor, collision or camera anchors",()=>{
  const{field,content}=mapTransformFixture(),before={x:field.player.x,y:field.player.y,camera:field.cameraSnapshot,collision:structuredClone(content.map.collisions)};
  assert(field.startEvent("zoom"));assert.equal(field.startEvent("instant"),false);assert.equal(field.checkpointReady,false);field.advance(500);assert.equal(field.mapTransformSnapshot!.areas[0]!.scale,1.5);field.advance(500);assert.equal(field.busy,false);assert.equal(field.mapTransformSnapshot!.areas[0]!.scale,2);
  assert.deepEqual({x:field.player.x,y:field.player.y,camera:field.cameraSnapshot,collision:content.map.collisions},before);
  const command={kind:"render-area"as const,target:0 as const,from:.01,to:.6,seconds:0,heightFrom:0,heightTo:0};assert.equal(fieldRenderAreaSample(command,10,10).scale,Math.fround(.6));
});
test("stable map state restores only under identical content/catalog and runtime authority; old saves stay old",()=>{
  const{field,content}=mapTransformFixture();assert(field.startEvent("instant"));const saved=field.checkpoint();assert.equal(saved.kind,"idle-field-v20");assert.deepEqual(FieldGame.restore(content,saved,{mapTransforms:WEB_FIELD_MAP_TRANSFORMS}).checkpoint(),saved);assert.throws(()=>FieldGame.restore(content,saved,{}),/runtime authority/);
  const oldContent=nonEncounterFieldContent(),old=new FieldGame(oldContent),oldSave=old.checkpoint();oldContent.developmentProfile=content.developmentProfile!;const restored=FieldGame.restore(oldContent,oldSave,{mapTransforms:WEB_FIELD_MAP_TRANSFORMS});assert.equal(restored.mapTransformSnapshot,null);assert.deepEqual(restored.checkpoint(),oldSave);
  const changed=structuredClone(content);changed.map.water!.layers[0]!.name="GroundWater";assert.throws(()=>FieldGame.restore(changed,saved,{mapTransforms:WEB_FIELD_MAP_TRANSFORMS}),/actual source/);
});
test("independent key animations, source color normalization, replacement and stale prepared transaction",()=>{
  const{field,content}=mapTransformFixture(),owner=new FieldMapTransforms("test",content.map.water);
  owner.prepareWater({kind:"water",target:-1,key:"_WaterColor:R",from:0,to:255,seconds:1}).commit();owner.prepareWater({kind:"water",target:0,key:"_WaterOffsetY",from:0,to:48,seconds:2}).commit();owner.advance(500);
  assert.equal(owner.snapshot().water[0]!.values["_WaterColor:R"],.5);assert.equal(owner.snapshot().water[0]!.values._WaterOffsetY,12);
  const stale=owner.prepareArea(1,2,.5);owner.advance(10);assert.throws(()=>stale.commit(),/Stale/);
  owner.prepareWater({kind:"water",target:0,key:"_WaterColor:R",from:128,to:0,seconds:0}).commit();assert.equal(owner.snapshot().water[0]!.values["_WaterColor:R"],128/255);assert(Object.hasOwn(owner.snapshot().water[0]!.tweens,"_WaterOffsetY"));
  const prior=field.mapTransformSnapshot;field.retireMapTransforms();field.advance(100);assert.deepEqual(field.mapTransformSnapshot,prior);
});
test("source material keys have real pixel consumers and viewport inverse is reversible",()=>{
  const{field}=mapTransformFixture(),v=field.mapTransformSnapshot!.water[0]!.values,input={width:8,height:8,data:new Uint8ClampedArray(Array.from({length:64},(_,i)=>[30+i*7,60,100,255]).flat())};
  for(const key of ["_WaterColor:R","_WaterColor:G","_WaterColor:B","_WaterColor:A","_FluctuationMagnification","_HighlightIntensity","_CondensingPatternIntensity"]as const){const changed={...v,[key]:key.includes(":")?0:key==="_FluctuationMagnification"?3:5};assert.notDeepEqual(projectFlatWaterPixels(input,changed,100).data,projectFlatWaterPixels(input,v,100).data,key);}
  const p=flatMapViewport({scale:2,height:.5},320,180),point={x:107,y:22};assert.equal(((point.x*p.sx+p.x)-p.x)/p.sx,point.x);assert.equal(((point.y*p.sy+p.y)-p.y)/p.sy,point.y);
});
