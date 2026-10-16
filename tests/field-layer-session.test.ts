import test from "node:test";
import assert from "node:assert/strict";
import { nonEncounterSessionFixture } from "./fixtures/non-encounter-area-session.js";
import { encounterReady } from "./fixtures/source-encounter-session.js";
import { sealBatchContent } from "./fixtures/content-batch.js";
import { CheckpointStorage } from "../src/core/saved-game.js";
import { GameBattleHandoff } from "../src/core/game-battle-handoff.js";
import { GameEventSaveCoordinator } from "../src/core/game-event-save.js";
import { WEB_FIELD_LAYER_SCROLLING, fieldScrollLayerNames, type FieldLayerCommand } from "../src/core/field-layer-scrolling.js";
import type { Op } from "../src/field/types.js";
function fixture(){
  const f=nonEncounterSessionFixture();f.map.map!.layers=fieldScrollLayerNames.map(name=>({name,width:f.map.map!.width,height:f.map.map!.height,data:Array(f.map.map!.width*f.map.map!.height).fill(0),opacity:1}));
  f.map.developmentProfile!.fieldLayerScrolling=WEB_FIELD_LAYER_SCROLLING;
  const scroll:FieldLayerCommand={kind:"apply",mask:1,actions:[{kind:"velocity",layer:0,x:48,y:0}]},set:FieldLayerCommand={kind:"apply",actions:[{kind:"offset",layer:0,x:17,y:0}]};
  const values:Record<string,Record<string,unknown>[]>={scroll:[{kind:"field-layer-scrolling",command:scroll},{kind:"exit"}],barrier:[{kind:"field-layer-scrolling",command:set},{kind:"event-save"},{kind:"exit"}]};
  for(const[name,ops]of Object.entries(values)){f.map.scripts[name]=ops.map((v,index)=>({...v,script:name,index,source:f.source})as Op);f.map.scriptPuppetContexts![name]={...f.map.scriptPuppetContexts!.reserved!,scriptHash:"7".repeat(64)};f.map.scriptLocals![name]=null;f.map.scriptTransitionMetadata![name]={customAnimations:"none"};f.map.scriptSystemFlags![name]={keepBadStatusVisual:false};}
  Object.assign(f.map,sealBatchContent(f.map));f.world.maps[f.map.mapId]!.contentHash=f.map.contentHash;Object.assign(f.world,sealBatchContent(f.world));f.content.mapContentHash=f.map.contentHash;f.content.worldCatalogHash=f.world.contentHash;Object.assign(f.content,sealBatchContent(f.content));f.runtime.fieldLayerScrolling=WEB_FIELD_LAYER_SCROLLING;return f;
}
test("actual Session/Flow pauses one owner, stable scrolling saves through Storage, old untouched save stays untouched",async()=>{
  const f=fixture(),live=f.make(),legacy=live.game.checkpoint();assert.equal(live.game.field.fieldLayerSnapshot,null);assert.deepEqual(f.restore(legacy).checkpoint(),legacy);
  assert(live.game.field.startEvent("scroll"));live.flow.advance(1000,encounterReady);assert(Math.abs(live.game.field.fieldTileLayerOffset("BottomLayer").x-48)<1e-9);
  const before=live.game.field.fieldLayerSnapshot;assert(live.flow.pause(true));live.flow.advance(1000,encounterReady);assert.deepEqual(live.game.field.fieldLayerSnapshot,before);assert(live.flow.pause(false));
  const values=new Map<string,string>(),storage=new CheckpointStorage({getItem:k=>values.get(k)??null,setItem:(k,v)=>{values.set(k,v);}},"framework","field-layers");const saved=live.game.checkpoint();assert.equal(saved.world.field.kind,"idle-field-v19");await storage.save(saved,1);assert.deepEqual(f.restore((await storage.load())!.checkpoint).checkpoint(),saved);
  delete f.runtime.fieldLayerScrolling;assert.throws(()=>f.restore(saved),/runtime authority/);
});
test("actual private map candidates never borrow local scrolling state, cancellation/staleness retire clocks and successful maps start fresh",()=>{
  const f=fixture(),live=f.make();assert(live.game.field.startEvent("scroll"));live.flow.advance(500,encounterReady);const old=live.game.field;
  assert(old.startEvent("region-travel"));const candidate=live.game.world.prepare(f.world,f.map);assert.equal(candidate.field.fieldLayerSnapshot,null);candidate.field.advance(1000);assert.equal(candidate.field.fieldLayerSnapshot,null);live.game.world.discard(candidate);
  const stale=live.game.world.prepare(f.world,f.map),winner=live.game.world.prepare(f.world,f.map);assert(live.game.world.commit(winner));assert.equal(live.game.world.commit(stale),false);assert.equal(live.game.field.fieldLayerSnapshot,null);assert.equal(candidate.field.startEvent("scroll"),true);assert.equal(candidate.field.stop?.kind,"unsupported");
  const prior=old.fieldLayerSnapshot;old.advance(1000);assert.deepEqual(old.fieldLayerSnapshot,prior);
});
test("event barrier Storage restores local visual state and resumes from the same next instruction",async()=>{
  const f=fixture(),live=f.make();assert(live.game.field.startEvent("barrier"));assert(live.game.eventSaveRequest);const values=new Map<string,string>(),storage=new CheckpointStorage({getItem:k=>values.get(k)??null,setItem:(k,v)=>{values.set(k,v);}},"framework","field-layer-event");assert.equal((await new GameEventSaveCoordinator(live.flow,storage).save(2)).status,"committed");const saved=(await storage.load())!.checkpoint;assert.equal(saved.world.field.kind,"event-field-v10");const restored=f.restore(saved);live.flow.advance(10,encounterReady);restored.advance(10);assert.deepEqual(restored.checkpoint(),live.game.checkpoint());
});
test("battle preserves the same map owner and pauses scrolling until actual return",async()=>{
  const f=fixture(),live=f.make();assert(live.game.field.startEvent("scroll"));live.flow.advance(500,encounterReady);assert(live.game.field.startEvent("source-fight"));for(let i=0;i<100&&!live.game.field.stop;i++)live.flow.advance(10,encounterReady);const before=live.game.field.fieldLayerSnapshot;
  const handoff=new GameBattleHandoff(live.flow,{prepareStart:async()=>null,prepareReturn:async()=>null,discard(){}});assert.equal((await handoff.start()).status,"committed");const battle=live.game.battle!;for(let i=0;i<2500&&battle.phase==="active";i++){for(const actor of battle.ready){const enemy=battle.enemies.find(u=>u.hp>0);if(enemy)live.commands.command(battle,actor.id,10,{kind:"single",id:enemy.id},100);}live.flow.advance(20,encounterReady);}assert.equal(battle.phase,"victory");assert.deepEqual(live.game.field.fieldLayerSnapshot,before);assert.equal((await handoff.return()).status,"committed");live.flow.advance(10,encounterReady);assert.notDeepEqual(live.game.field.fieldLayerSnapshot,before);
});
