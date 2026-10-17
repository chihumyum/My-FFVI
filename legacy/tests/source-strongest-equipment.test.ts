import assert from 'node:assert/strict';
import test from 'node:test';
import { GameSession } from '../src/core/game-session.js';
import { GameFlow } from '../src/core/game-flow.js';
import { CheckpointStorage } from '../src/core/saved-game.js';
import { magicStonesSessionFixture } from './fixtures/magic-stones-session.js';
import { sealBatchContent } from './fixtures/content-batch.js';
import { createNewGame } from '../src/core/new-game.js';
import type { EquipmentCatalog } from '../src/core/equipment.js';
import { equipmentGameFixture } from './fixtures/equipment-game.js';
import { readyHost } from './fixtures/game-flow.js';
import type { SourceEquipmentCommand } from '../src/core/source-owned-equipment.js';
const command: SourceEquipmentCommand = {kind:'strongest-non-accessories',sourceId:1};
function setup({clamp=false,extra=true,mutate}:{clamp?:boolean;extra?:boolean;mutate?:(cat:EquipmentCatalog)=>void}={}) {
 const f=equipmentGameFixture(),system=f.catalog.gameState.equipmentSystem!,cat=system.catalog;
 for(const item of Object.values(cat.definitions))item.strongest={sortId:item.kind==='weapon'?1000+item.id:item.id,weaponCategory:item.kind==='weapon'?1:null,twoHanded:false};
 // Deliberately smaller attack, larger source SortId. The choice must not use
 // current/confirmed attack or arbitrary content order as an invented score.
 cat.definitions[103]={...structuredClone(cat.definitions[101]!),id:103,equipmentId:1103,ordinaryWeapon:{...structuredClone(cat.definitions[101]!.ordinaryWeapon!),contentId:103,weaponId:1103},strongest:{sortId:9999,weaponCategory:1,twoHanded:false}};
 cat.definitions[103].parameter!.values.attack=1;
 if(extra)system.initialStock.push({id:103,count:1},{id:202,count:1});
 if(clamp){cat.definitions[301]!.parameter!.values.hp=30;cat.definitions[401]!.parameter!.values.hp=-20;f.catalog.common.players[0]!.hp=140;f.catalog.common.players[1]!.hp=130;}
 mutate?.(cat);
 const source={file:'synthetic',assetPath:'strongest-common-contract'};
 f.field.scripts.strongest=[{kind:'source-owned-equipment',command,script:'strongest',index:0,source},{kind:'exit',script:'strongest',index:1,source}];
 const game=new GameSession(f.field,f.catalog,314),flow=new GameFlow(game);flow.start();flow.advance(0,readyHost);return {...f,game,flow,cat};
}
function run(f:ReturnType<typeof setup>){assert(f.game.field.startEvent('strongest'));f.flow.advance(10,readyHost);assert.equal(f.game.field.stop,null);assert(f.game.field.menuReady);}
test('common source selection uses SortId, real free copies, forward removal and leaves both accessories untouched',()=>{
 const f=setup({clamp:true}),before=f.game.state.snapshot(),ticket=f.game.state.fieldRoster.prepareEquipment!(command);
 assert.deepEqual(ticket.targets,['a']);assert.deepEqual(ticket.changes.map(c=>c.slot),[1,2,3,4,1,2,3,4]);
 run(f);const after=f.game.state.snapshot();assert.deepEqual(after.equipmentStock,before.equipmentStock);assert.deepEqual(after.roster[0]!.equipment,[103,202,301,401,501,5]);
 assert.equal(after.roster[0]!.hp,110);assert.equal(after.roster[0]!.maxHp,140);assert.deepEqual(after.roster[1],before.roster[1]);assert.deepEqual(after.party,before.party);
 assert.equal(f.game.players[0]!.physical!.attack,21);assert.throws(ticket.validate,/Stale/);
});
test('left-dominant owner shares the algorithm and enabled reserves keep their inventory registrations',()=>{
 const f=setup({extra:false}),before=f.game.state.snapshot();before.party.slots[0][1]!.id=null;f.game.state.restore(before);
 f.game.state.fieldRoster.prepareEquipment!(command).commitWith(()=>{});assert.equal(f.game.state.snapshot().roster[0]!.equipment[0],101);
 const left=f.game.state.fieldRoster.prepareEquipment!({kind:'strongest-non-accessories',sourceId:2});
 assert.deepEqual(left.changes.map(c=>c.slot),[1,2,3,4,2,1,3,4]);left.commitWith(()=>{});
 assert.deepEqual(f.game.state.snapshot().roster[1]!.equipment,[201,102,301,401,5,5]);assert.deepEqual(f.game.state.snapshot().equipmentStock,before.equipmentStock);
});
test('unknown ranking, tied native list order, selected effects and unsupported hand providers reject the entire draft',()=>{
 for(const mutate of [
  (cat:EquipmentCatalog)=>{delete cat.definitions[103]!.strongest;},
  (cat:EquipmentCatalog)=>{cat.definitions[101]!.strongest!.sortId=9999;},
  (cat:EquipmentCatalog)=>{cat.definitions[103]!.blockers=['unresolved selected effect'];},
  (cat:EquipmentCatalog)=>{cat.definitions[103]!.strongest!.twoHanded=true;},
  (cat:EquipmentCatalog)=>{cat.definitions[103]!.strongest!.weaponCategory=13;},
 ]){const f=setup({mutate}),before=f.game.state.snapshot();assert.throws(()=>f.game.state.fieldRoster.prepareEquipment!(command),/strongest|Unimplemented/);assert.deepEqual(f.game.state.snapshot(),before);}
 const f=setup();const state=f.game.state.snapshot();state.equipmentStock.find(s=>s.id===3)!.count=0;f.game.state.restore(state);const before=f.game.state.snapshot();assert.throws(()=>f.game.state.fieldRoster.prepareEquipment!(command),/Missing owned empty/);assert.deepEqual(f.game.state.snapshot(),before);
});
test('actual live and map draft ownership supports cancellation/retry and rejects reentry, asynchronous or stale publication',()=>{
 const f=setup(),before=f.game.state.snapshot(),ticket=f.game.state.fieldRoster.prepareEquipment!(command);
 assert.throws(()=>ticket.commitWith(()=>{throw Error('cancelled');}),/cancelled/);assert.deepEqual(f.game.state.snapshot(),before);
 assert.throws(()=>ticket.commitWith(()=>f.game.state.fieldInventory.prepare({kind:'grant-gil',amount:1}).commit()),/publication/);
 assert.throws(()=>ticket.commitWith(async()=>{}),/synchronous/);assert.deepEqual(f.game.state.snapshot(),before);
 ticket.commitWith(()=>{});assert.throws(ticket.validate,/Stale/);
 const stale=f.game.state.fieldRoster.prepareEquipment!(command);f.game.state.fieldInventory.prepare({kind:'grant-gil',amount:1}).commit();assert.throws(stale.validate,/Stale/);
 const draft=f.game.state.prepareFieldState(),candidate=draft.ports.roster.prepareEquipment!(command),live=f.game.state.snapshot();
 assert.throws(()=>candidate.commitWith(()=>{throw Error('cancelled');}),/cancelled/);assert.deepEqual(f.game.state.snapshot(),live);candidate.commitWith(()=>{});assert.deepEqual(f.game.state.snapshot(),live);
 const old=draft.ports.roster.prepareEquipment!(command);assert(draft.commit());assert.throws(old.validate,/Stale/);draft.ports.roster.prepareEquipment!(command).commitWith(()=>{});
});
test('Field to actual Battle/retry/return then Storage preserves one owned equipment and stock owner',async()=>{
 const f=setup();run(f);const entry=f.game.state.snapshot();assert(f.game.field.startEvent('fight'));f.game.advance(10);assert.equal(f.game.battle!.phase,'active');assert.equal(f.game.battle!.players[0]!.physical!.attack,21);
 assert.throws(()=>f.game.state.fieldRoster.prepareEquipment!(command),/reserved by an active battle/);
 for(const p of f.game.battle!.players){p.hp=0;p.conditionIds=[305];}f.game.advance(10);assert.equal(f.game.battle!.phase,'defeat');assert(f.game.retryBattle());assert.deepEqual(f.game.state.snapshot(),entry);
 for(const enemy of f.game.battle!.enemies)enemy.hp=0;f.game.advance(10);assert.equal(f.game.battle!.phase,'victory');assert(f.game.continueVictory());f.game.advance(10);
 assert.deepEqual(f.game.state.snapshot().roster[0]!.equipment,entry.roster[0]!.equipment);assert.deepEqual(f.game.state.snapshot().equipmentStock,entry.equipmentStock);
 const checkpoint=f.game.checkpoint(),values=new Map<string,string>(),store=new CheckpointStorage({getItem:k=>values.get(k)??null,setItem:(k,v)=>{values.set(k,v);}},'framework','strongest-contract');await store.save(checkpoint,100);const saved=await store.load();assert(saved);
 const restored=GameSession.restore(saved.checkpoint,f.field,f.catalog);assert.deepEqual(restored.checkpoint(),checkpoint);const flow=new GameFlow(restored);flow.start();flow.advance(0,readyHost);assert(restored.field.startEvent('strongest'));flow.advance(10,readyHost);assert.equal(restored.field.stop,null);assert.deepEqual(restored.state.snapshot().equipmentStock,entry.equipmentStock);
});

test('source initializer owned abilities survive selected passive removal/re-addition, failed publication and Storage without duplication',async()=>{
 const f=magicStonesSessionFixture(),owner=f.battle.gameState,initial=owner.sourceNewGame!,cat=initial.equipment;
 for(const item of Object.values(cat.definitions))item.strongest={sortId:item.kind==='weapon'?1000+item.id:item.id,weaponCategory:item.kind==='weapon'?1:null,twoHanded:false};
 const shield=Object.values(cat.definitions).find(i=>i.kind==='armor'&&!i.empty&&i.parts[1])!;assert(shield);
 cat.definitions[8001]={...structuredClone(shield),id:8001,equipmentId:9001,strongest:{sortId:900,weaponCategory:null,twoHanded:false},abilityCost:{kind:'equipment-mp-cost',modifier:'half',ability:{abilityId:8002,contentId:8003,skillLevel:0}}};
 initial.inventory.push({kind:'equipment',id:8001,count:1});const fresh=createNewGame(initial);
 owner.equipmentSystem!.catalog=structuredClone(cat);owner.equipmentSystem!.initialStock=structuredClone(fresh.owned.equipmentStock);
 const sourceId=initial.characters[0]!.template.initial.sourceId,id=initial.characters[0]!.id;
 f.map.scripts['passive-strongest']=[{kind:'source-owned-equipment',command:{kind:'strongest-non-accessories',sourceId},script:'passive-strongest',index:0,source:f.source},{kind:'exit',script:'passive-strongest',index:1,source:f.source}];
 f.map.scriptPuppetContexts!['passive-strongest']={...f.map.scriptPuppetContexts!.reserved!};
 Object.assign(f.battle,sealBatchContent(f.battle));Object.assign(f.map,sealBatchContent(f.map));f.world.maps[f.map.mapId]!.contentHash=f.map.contentHash;Object.assign(f.world,sealBatchContent(f.world));
 f.content.battleCatalogHash=f.battle.contentHash;f.content.mapContentHash=f.map.contentHash;f.content.worldCatalogHash=f.world.contentHash;Object.assign(f.content,sealBatchContent(f.content));
 const game=f.make(),before=game.state.snapshot();assert(game.field.startEvent('passive-strongest'));game.advance(10);assert.equal(game.field.stop,null);
 const after=game.state.snapshot(),member=after.roster.find(m=>m.id===id)!;assert(member.equipment.includes(8001));assert.deepEqual(member.abilities!.owned.filter(a=>a.abilityId===8002),[{abilityId:8002,contentId:8003,skillLevel:0}]);assert.deepEqual(after.equipmentStock,before.equipmentStock);
 const repeated=game.state.fieldRoster.prepareEquipment!({kind:'strongest-non-accessories',sourceId});assert.throws(()=>repeated.commitWith(()=>{throw Error('cancelled');}),/cancelled/);assert.deepEqual(game.state.snapshot(),after);repeated.commitWith(()=>{});assert.deepEqual(game.state.snapshot(),after);
 const checkpoint=game.checkpoint(),values=new Map<string,string>(),store=new CheckpointStorage({getItem:k=>values.get(k)??null,setItem:(k,v)=>{values.set(k,v);}},'framework','strongest-passive');await store.save(checkpoint,1);const restored=f.restore((await store.load())!.checkpoint);assert.deepEqual(restored.checkpoint(),checkpoint);
 restored.state.fieldRoster.prepareEquipment!({kind:'strongest-non-accessories',sourceId}).commitWith(()=>{});assert.deepEqual(restored.state.snapshot(),after);
});
