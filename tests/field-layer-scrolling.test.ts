import test from "node:test";
import assert from "node:assert/strict";
import { FieldGame } from "../src/core/field.js";
import { EventState } from "../src/core/event-state.js";
import { FieldLayerScrolling, WEB_FIELD_LAYER_SCROLLING, fieldScrollLayerNames, fieldLayerTweenSample, type FieldSceneryCatalog, type FieldLayerCommand } from "../src/core/field-layer-scrolling.js";
import { compileFieldLayerInstruction, sourceFieldLayerSelectors } from "../src/compiler/field-layer-scrolling.js";
import { nonEncounterFieldContent } from "./fixtures/non-encounter-area-session.js";
import type { Op } from "../src/field/types.js";
const source={file:"authored-scenery.bundle",assetPath:"Authored/scenery.json",serializedFile:"CAB-authored",objectId:"9007199254740997",sha256:"a".repeat(64)};
export function sceneryCatalog():FieldSceneryCatalog {
  return {kind:"web-flat-field-scenery-v1",sourceSetHash:"a".repeat(64),parentSourceSetHash:"b".repeat(64),unresolved:[{id:3,scenery:1,source,reason:"Independent particle provider is unresolved"}],layers:[1,2].map(id=>({id,scenery:1,name:"FarBGLayer"+id,source,active:id===1,autoScroll:false,speed:{x:0,y:0},size:{width:320,height:180},offset:{x:0,y:0},manualSpeed:{x:0,y:0},blend:0,texture:{url:"/field-background-media/textures/"+"c".repeat(64)+".png",sha256:"c".repeat(64),width:2,height:2,source,textureSource:source}}))};
}
const raw=(name:string)=>({type:1,mnemonic:"SysCall",operands:{iValues:Array(8).fill(0),rValues:Array(8).fill(0),sValues:[name,...Array(7).fill("")]}});
function fixture(visual=true){
  const content=nonEncounterFieldContent();content.parentSourceSetHash="b".repeat(64);content.sourceSetHash="a".repeat(64);
  content.map.layers=fieldScrollLayerNames.map(name=>({name,width:12,height:12,data:Array(144).fill(0),opacity:1}));
  content.map.scenery=sceneryCatalog();content.developmentProfile={kind:"framework-development-v1",policy:"omit-anonymous-environment-particles-v1",sourceContentHash:"e".repeat(64),omissions:[],fieldLayerScrolling:WEB_FIELD_LAYER_SCROLLING};
  const install=(name:string,command:FieldLayerCommand)=>{content.scripts[name]=[{...compileFieldLayerInstruction(raw("レイヤースクロール：砂漠")),command,script:name,index:0,source},{kind:"exit",script:name,index:1,source}];};
  install("scroll",{kind:"apply",mask:1,actions:[{kind:"velocity",layer:0,x:48,y:0}]});install("reset",{kind:"reset"});
  install("tween",{kind:"tween",mask:9,layers:[0,3],axis:"x",from:0,to:-170,seconds:6,easing:"in-cubic",end:-320});
  install("switch",{kind:"apply",actions:[{kind:"show",id:2,scenery:1,seconds:1},{kind:"hide",id:1,scenery:1,seconds:1}]});
  install("bad",{kind:"apply",mask:3,actions:[{kind:"offset",layer:0,x:100,y:0},{kind:"show",id:3,scenery:1,seconds:0}]});
  const field=new FieldGame(content,new EventState(),undefined,undefined,visual?{fieldLayerScrolling:WEB_FIELD_LAYER_SCROLLING}:{});return {content,field};
}
test("complete source facade family keeps 40 direct wrappers and 5 unresolved callbacks/phase tables independently gated",()=>{
  let typed=0,blocked=0;for(const selector of sourceFieldLayerSelectors){try{compileFieldLayerInstruction(raw(selector));typed++;}catch(error){assert.match(String(error),/unresolved/);blocked++;}}
  assert.deepEqual([typed,blocked],[40,5]);
  const command=compileFieldLayerInstruction(raw("レイヤースクロール：フィガロ城")).command;assert.deepEqual(command,{kind:"apply",mask:1,actions:[{kind:"velocity",layer:0,x:0,y:-32}]});
  const malformed=raw("レイヤースクロール：砂漠");malformed.operands.iValues[3]=1;assert.throws(()=>compileFieldLayerInstruction(malformed),/operands/);
});
test("entire scenery action list resolves before mutation; stale transactions and unknown reset mask never partially publish",()=>{
  const owner=new FieldLayerScrolling("binding",fieldScrollLayerNames,sceneryCatalog()),before=owner.snapshot();
  assert.throws(()=>owner.prepare({kind:"apply",actions:[{kind:"offset",layer:0,x:10,y:0},{kind:"show",id:3,scenery:1,seconds:0}]}),/particle/);assert.deepEqual(owner.snapshot(),before);
  assert.throws(()=>owner.prepare({kind:"reset"}),/Unknown/);
  const stale=owner.prepare({kind:"apply",actions:[{kind:"offset",layer:0,x:10,y:0}]});owner.advance(10);stale.commit();
  const stale2=owner.prepare({kind:"apply",actions:[]});owner.prepare({kind:"apply",actions:[{kind:"offset",layer:0,x:20,y:0}]}).commit();assert.throws(()=>stale2.commit(),/Stale/);
  owner.prepare({kind:"reset"},1).commit();assert.deepEqual(owner.tileOffset("BottomLayer"),{x:0,y:0});
});
test("actual Field uses the existing clock for tile sampling and scenery fades while collision and actor anchors stay unchanged",()=>{
  const {field,content}=fixture(),before={player:{x:field.player.x,y:field.player.y},collision:structuredClone(content.map.collisions),data:content.map.layers.map(l=>[...l.data])};
  assert(field.startEvent("scroll"));field.advance(1000);assert(Math.abs(field.fieldTileLayerOffset("BottomLayer").x-48)<1e-9);assert.equal(field.eventState.read({category:"ScenarioVariable",index:0}),1);
  assert(field.startEvent("switch"));assert.equal(field.checkpointReady,false);field.advance(500);assert.deepEqual(field.fieldSceneryProjection!.state.scenery.map(l=>l.alpha),[.5,.5]);field.advance(500);
  assert.deepEqual(field.fieldSceneryProjection!.state.scenery.map(l=>l.visible),[false,true]);assert.deepEqual(content.map.collisions,before.collision);assert.deepEqual(content.map.layers.map(l=>l.data),before.data);assert.deepEqual({x:field.player.x,y:field.player.y},before.player);
  assert(field.startEvent("reset"));assert.deepEqual(field.fieldTileLayerOffset("BottomLayer"),{x:0,y:0});
  const saved=field.checkpoint();assert.equal(saved.kind,"idle-field-v19");const restored=FieldGame.restore(content,saved,{fieldLayerScrolling:WEB_FIELD_LAYER_SCROLLING});assert.deepEqual(restored.checkpoint(),saved);assert.throws(()=>FieldGame.restore(content,saved,{}),/runtime authority/);
});
test("blocking tween has exact terminal jump, Core r0 and no premature root replacement, save or continuation",()=>{
  const {field}=fixture();assert(field.startEvent("tween"));assert.equal(field.startEvent("scroll"),false);assert.equal(field.checkpointReady,false);field.advance(3000);assert.equal(field.fieldTileLayerOffset("BottomLayer").x,-21);field.advance(3000);assert.equal(field.stop,null);assert.equal(field.busy,false);assert.deepEqual(field.fieldTileLayerOffset("BottomLayer"),{x:-320,y:0});assert.deepEqual(field.fieldTileLayerOffset("CeilLayer"),{x:-320,y:0});
  const op=compileFieldLayerInstruction(raw("レイヤースクロール：停車")).command;assert(op.kind==="tween");assert.equal(fieldLayerTweenSample(op,Math.fround(12.8),0).complete,true);
});
test("runtime/content revocation and unknown particle targets cannot publish mask or partial offset writes",()=>{
  const {field}=fixture(),before=field.fieldLayerSnapshot,events=field.eventState.snapshot();assert(field.startEvent("bad"));assert.equal(field.stop?.kind,"unsupported");assert.deepEqual(field.fieldLayerSnapshot,before);assert.deepEqual(field.eventState.snapshot(),events);
  const missing=fixture(false);assert(missing.field.startEvent("scroll"));assert.equal(missing.field.stop?.kind,"unsupported");assert.equal(missing.field.fieldLayerSnapshot,null);
  const revoked=fixture();assert(revoked.field.startEvent("tween"));const snapshot=revoked.field.fieldLayerSnapshot;delete revoked.field.options.fieldLayerScrolling;revoked.field.advance(10);assert.equal(revoked.field.stop?.kind,"unsupported");assert.deepEqual(revoked.field.fieldLayerSnapshot,snapshot);
});
