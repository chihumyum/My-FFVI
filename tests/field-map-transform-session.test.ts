import test from "node:test";
import assert from "node:assert/strict";
import {nonEncounterSessionFixture}from "./fixtures/non-encounter-area-session.js";
import {encounterReady}from "./fixtures/source-encounter-session.js";
import {sealBatchContent}from "./fixtures/content-batch.js";
import {CheckpointStorage}from "../src/core/saved-game.js";
import {GameBattleHandoff}from "../src/core/game-battle-handoff.js";
import {GameEventSaveCoordinator}from "../src/core/game-event-save.js";
import {WEB_FIELD_MAP_TRANSFORMS,projectFlatOrient}from "../src/core/field-map-transforms.js";
import {compileFieldWaterCatalog}from "../src/compiler/field-map-transforms.js";
import {WEB_SOURCE_FIELD_UI}from "../src/core/field-ui.js";
import type {Op}from "../src/field/types.js";
function fixture(withUi=false){
 const f=nonEncounterSessionFixture(),map=f.map.map!;
 f.map.developmentProfile!.mapTransforms=WEB_FIELD_MAP_TRANSFORMS;
 const command=(from:number,to:number,seconds:number)=>({kind:"field-map-transform",command:{kind:"render-area",target:1,from,to,seconds,heightFrom:1,heightTo:1}});
 const scripts:Record<string,Record<string,unknown>[]>={water:[command(1,2,1),{kind:"exit"}],barrier:[command(1.7,1.7,0),{kind:"event-save"},{kind:"exit"}],orient:[{kind:"field-map-transform",command:{kind:"orient",target:0}},{kind:"exit"}]};
 for(const[name,values]of Object.entries(scripts)){f.map.scripts[name]=values.map((v,index)=>({...v,script:name,index,source:f.source})as Op);f.map.scriptPuppetContexts![name]={...f.map.scriptPuppetContexts!.reserved!,scriptHash:"7".repeat(64)};f.map.scriptLocals![name]=null;f.map.scriptTransitionMetadata![name]={customAnimations:"none"};f.map.scriptSystemFlags![name]={keepBadStatusVisual:false};}
 if(withUi){f.runtime.sourceFieldUi=WEB_SOURCE_FIELD_UI;const title={kind:'source-field-ui',command:{kind:'title',location:{areaId:'authored-area',locationId:'authored-town'},area:'Region',title:'Town'}};
  for(const[name,values]of Object.entries({'ui-title':[title,{kind:'exit'}],'ui-barrier':[command(1.7,1.7,0),title,{kind:'event-save'},{kind:'source-field-ui',command:{kind:'all'}},{kind:'exit'}]})){
   f.map.scripts[name]=values.map((v,index)=>({...v,script:name,index,source:f.source})as Op);f.map.scriptPuppetContexts![name]={...f.map.scriptPuppetContexts!.reserved!,scriptHash:'8'.repeat(64)};f.map.scriptLocals![name]=null;f.map.scriptTransitionMetadata![name]={customAnimations:'none'};f.map.scriptSystemFlags![name]={keepBadStatusVisual:false};
  }
 }
 Object.assign(f.map,sealBatchContent(f.map));f.world.maps[f.map.mapId]!.contentHash=f.map.contentHash;Object.assign(f.world,sealBatchContent(f.world));f.content.mapContentHash=f.map.contentHash;f.content.worldCatalogHash=f.world.contentHash;Object.assign(f.content,sealBatchContent(f.content));f.runtime.mapTransforms=WEB_FIELD_MAP_TRANSFORMS;return f;
}
test("actual Session/Flow pauses the shared visual clock, Storage restores stable state without granting authority",async()=>{
 const f=fixture(),live=f.make();assert(live.game.field.startEvent("water"));live.flow.advance(500,encounterReady);assert.equal(live.game.field.mapTransformSnapshot!.areas[1]!.scale,1.5);
 const before=live.game.field.mapTransformSnapshot;assert(live.flow.pause(true));live.flow.advance(1000,encounterReady);assert.deepEqual(live.game.field.mapTransformSnapshot,before);assert(live.flow.pause(false));live.flow.advance(510,encounterReady);
 const values=new Map<string,string>(),storage=new CheckpointStorage({getItem:k=>values.get(k)??null,setItem:(k,v)=>{values.set(k,v);}},"framework","map-transform");const saved=live.game.checkpoint();assert.equal(saved.world.field.kind,"idle-field-v20");await storage.save(saved,1);assert.deepEqual(f.restore((await storage.load())!.checkpoint).checkpoint(),saved);delete f.runtime.mapTransforms;assert.throws(()=>f.restore(saved),/runtime authority/);
});
test("actual map preparation rebuilds destination source state, rejects stale commit and retires discarded clocks",()=>{
 const f=fixture(),live=f.make();assert(live.game.field.startEvent("water"));live.flow.advance(1010,encounterReady);const old=live.game.field;assert(old.startEvent("region-travel"));
 const canceled=live.game.world.prepare(f.world,f.map),initial=canceled.field.mapTransformSnapshot;assert.equal(initial!.areas[1]!.scale,1);canceled.field.advance(1000);assert.deepEqual(canceled.field.mapTransformSnapshot,initial);live.game.world.discard(canceled);
 const stale=live.game.world.prepare(f.world,f.map),winner=live.game.world.prepare(f.world,f.map);assert(live.game.world.commit(winner));assert.equal(live.game.world.commit(stale),false);assert.equal(live.game.field.mapTransformSnapshot!.areas[1]!.scale,1);const before=old.mapTransformSnapshot;old.advance(1000);assert.deepEqual(old.mapTransformSnapshot,before);
 assert(canceled.field.startEvent("water"));assert.equal(canceled.field.stop?.kind,"unsupported");
});
test("event barrier restores the same map-local owner and resumes after Storage acknowledgement",async()=>{
 const f=fixture(),live=f.make();assert(live.game.field.startEvent("barrier"));assert(live.game.eventSaveRequest);const values=new Map<string,string>(),storage=new CheckpointStorage({getItem:k=>values.get(k)??null,setItem:(k,v)=>{values.set(k,v);}},"framework","map-transform-event");assert.equal((await new GameEventSaveCoordinator(live.flow,storage).save(2)).status,"committed");const saved=(await storage.load())!.checkpoint;assert.equal(saved.world.field.kind,"event-field-v11");const restored=f.restore(saved);live.flow.advance(10,encounterReady);restored.advance(10);assert.deepEqual(restored.checkpoint(),live.game.checkpoint());
});
test("actual Puppet Orient reads the camera target vector and updates existing native actor/animation",()=>{
 const f=fixture(),live=f.make(),field=live.game.field,before={...field.player.native!.entity.position},camera=field.cameraSnapshot!.dummy.position,expected=projectFlatOrient(before,camera,field.player.direction);
 assert(field.startEvent("orient"));assert.equal(field.stop,null);assert.equal(field.player.direction,expected);assert.equal(field.player.native!.entity.direction,expected);assert.deepEqual(field.player.native!.entity.position,before);
});
test("battle retains and pauses the same map visual owner until the actual return",async()=>{
 const f=fixture(),live=f.make();assert(live.game.field.startEvent("water"));live.flow.advance(1010,encounterReady);assert(live.game.field.startEvent("source-fight"));for(let i=0;i<100&&!live.game.field.stop;i++)live.flow.advance(10,encounterReady);const before=live.game.field.mapTransformSnapshot;
 const handoff=new GameBattleHandoff(live.flow,{prepareStart:async()=>null,prepareReturn:async()=>null,discard(){}});assert.equal((await handoff.start()).status,"committed");const battle=live.game.battle!;for(let i=0;i<2500&&battle.phase==="active";i++){for(const actor of battle.ready){const enemy=battle.enemies.find(u=>u.hp>0);if(enemy)live.commands.command(battle,actor.id,10,{kind:"single",id:enemy.id},100);}live.flow.advance(20,encounterReady);}assert.equal(battle.phase,"victory");assert.deepEqual(live.game.field.mapTransformSnapshot,before);assert.equal((await handoff.return()).status,"committed");live.flow.advance(10,encounterReady);assert.notDeepEqual(live.game.field.mapTransformSnapshot,before);
});
test('joint map-transform and active UI codec resumes the v20/v11 Storage continuation without closing a title',async()=>{
 const f=fixture(true),live=f.make();assert(live.game.field.startEvent('ui-barrier'));assert(live.game.eventSaveRequest);
 const ui=live.game.field.sourceFieldUiSnapshot!,transform=live.game.field.mapTransformSnapshot!;assert.ok(ui.title);
 const values=new Map<string,string>(),storage=new CheckpointStorage({getItem:k=>values.get(k)??null,setItem:(k,v)=>{values.set(k,v);}},'framework','joint-ui-transform');
 assert.equal((await new GameEventSaveCoordinator(live.flow,storage).save(3)).status,'committed');
 const saved=(await storage.load())!.checkpoint;assert.equal(saved.world.field.kind,'event-field-v11');
 const restored=f.restore(saved);assert.deepEqual(restored.field.sourceFieldUiSnapshot,ui);assert.deepEqual(restored.field.mapTransformSnapshot,transform);
 live.flow.advance(10,encounterReady);restored.advance(10);assert.deepEqual(restored.checkpoint(),live.game.checkpoint());
 assert.equal(restored.field.sourceFieldUiSnapshot?.view,'all');assert.ok(restored.field.sourceFieldUiSnapshot?.title);
 const idle=restored.checkpoint();assert.equal(idle.world.field.kind,'idle-field-v20');assert.deepEqual(f.restore(idle).checkpoint(),idle);
 delete f.runtime.sourceFieldUi;assert.throws(()=>f.restore(idle),/runtime authority/);
});
test('encodable active UI does not grant a checkpoint through an unfinished map transform',()=>{
 const f=fixture(true),live=f.make();assert(live.game.field.startEvent('ui-title'));assert(live.game.field.startEvent('water'));
 live.flow.advance(500,encounterReady);assert.ok(live.game.field.sourceFieldUiSnapshot?.title);assert.equal(live.game.checkpointReady,false);assert.throws(()=>live.game.checkpoint());
 live.flow.advance(510,encounterReady);assert.equal(live.game.checkpointReady,true);assert.ok(live.game.field.sourceFieldUiSnapshot?.title);assert.deepEqual(f.restore(live.game.checkpoint()).checkpoint(),live.game.checkpoint());
});
