import {GameCommands} from "../src/core/game-commands.js";
import test from 'node:test';import assert from 'node:assert/strict';
import {logicalWorldEffectsFixture} from './fixtures/logical-world-effects.js';
import {GameFlow} from '../src/core/game-flow.js';import {GameMapLoader} from '../src/core/game-map-loader.js';
import {GameSession} from '../src/core/game-session.js';import {GameBattleHandoff} from '../src/core/game-battle-handoff.js';
import {GameEventSaveCoordinator} from '../src/core/game-event-save.js';import {CheckpointStorage} from '../src/core/saved-game.js';
import {bindFieldEffectFlatProjection,validateFieldEffectFlatContext,flatFieldEffectGroupBlockers,WEB_FLAT_FIELD_EFFECTS} from '../src/core/field-effect-flat-projection.js';
const ready={visible:true,mediaReady:true,overlayOpen:false};
async function fixture(options:Parameters<typeof logicalWorldEffectsFixture>[0]={}){const f=await logicalWorldEffectsFixture({...options,flatBirdview:true}),game=await f.make(),flow=new GameFlow(game);flow.start();flow.advance(10,ready);assert.equal(game.field.stop,null);return{f,game,flow};}
test('actual initialized session retains source board/placement, one owner and stable legacy world-v11 shape',async()=>{
 const{f,game}=await fixture();const fx=game.field.fieldEffectsSnapshot!;assert.equal(fx.boards.length,1);assert.equal(fx.boards[0]!.definition.birdviewPuppet,true);assert.equal(fx.boards[0]!.flatProjection!.mapId,f.map.mapId);assert.equal(fx.boards[0]!.flatProjection!.layer,0);
 game.advance(30);const saved=game.checkpoint();assert.equal(saved.world.kind,'idle-world-v11');assert.equal(saved.world.logicalEffects!.kind,'web-logical-field-effects-checkpoint-v1');assert.equal(saved.world.logicalEffects!.catalogHash,f.map.fieldEffects!.webPolicy!.catalogHash);
 const restored=f.restore(saved);assert.deepEqual(restored.checkpoint(),saved);assert.equal(restored.field.fieldEffectsSnapshot!.instanceCount,1);assert.equal(restored.field.content.developmentProfile!.fieldEffectProjection,WEB_FLAT_FIELD_EFFECTS);
 const actual=game.field.content,entity=actual.map.groups!.entity_default!.entities.find(e=>e.kind===11)!;assert(bindFieldEffectFlatProjection(actual,entity,'entity_default'));
 for(const change of [(c:typeof actual)=>{delete c.developmentProfile!.fieldEffectProjection;},(c:typeof actual)=>{delete c.fieldEffects!.webPolicy!.boardProjection;}]){const c=structuredClone(actual);change(c);assert.throws(()=>validateFieldEffectFlatContext(c),/marker|context/);}
 const group=structuredClone(actual.map.groups!.entity_default!);group.blockers.push({source:entity.source,reason:'Field effect birdview scale provider is unavailable'},{source:entity.source,reason:'Unproved collider'});
 const remaining=flatFieldEffectGroupBlockers(group,{...actual,mapId:f.map.mapId});assert.equal(remaining.some(b=>b.reason==='Unproved collider'),true);assert.equal(remaining.some(b=>b.reason.includes('birdview')),false);
});
test('source mismatches and saved projected layer/position changes reject without touching the original owner',async()=>{
 const{f,game}=await fixture();const saved=game.checkpoint(),before=game.field.fieldEffectsSnapshot;
 for(const change of [(s:typeof saved)=>s.world.logicalEffects!.state.boards[0]!.flatProjection!.layer=1,(s:typeof saved)=>s.world.logicalEffects!.state.boards[0]!.position.x=999,(s:typeof saved)=>{delete s.world.logicalEffects!.state.boards[0]!.flatProjection;},(s:typeof saved)=>s.world.logicalEffects!.catalogHash='f'.repeat(64)]){
  const s=structuredClone(saved);change(s);assert.throws(()=>f.restore(s));assert.deepEqual(game.field.fieldEffectsSnapshot,before);
 }
 const actual=structuredClone(game.field.content),entity=actual.map.groups!.entity_default!.entities.find(e=>e.kind===11)!;entity.layer=1;assert.throws(()=>bindFieldEffectFlatProjection(actual,entity,'entity_default'),/current source group/);
});
test('actual map media failure/cancel/retry and empty-map return preserve allocation history and exact new map reference',async()=>{
 const{f,game,flow}=await fixture(),first=game.field,fx=first.fieldEffectsSnapshot,owned=game.state.snapshot();first.startEvent('go-world');
 let fail=true,hold=false,release!:()=>void,entered!:()=>void;const waiting=new Promise<void>(r=>release=r),reached=new Promise<void>(r=>entered=r);
 const loader=new GameMapLoader(flow,{world:async()=>f.world,map:async id=>f.maps.find(m=>m.mapId===id)!},{prepare:async()=>{if(hold){entered();await waiting;}if(fail)throw Error('controlled projected FX media');return null;},discard(){}});
 assert.equal((await loader.load()).status,'failed');assert.equal(game.field,first);assert.deepEqual(game.state.snapshot(),owned);assert.deepEqual(first.fieldEffectsSnapshot,fx);
 fail=false;hold=true;const pending=loader.load();await reached;loader.cancel();release();assert.equal((await pending).status,'cancelled');assert.equal(game.field,first);assert.deepEqual(first.fieldEffectsSnapshot,fx);
 hold=false;assert.equal((await loader.load()).status,'committed');flow.advance(10,ready);const second=game.field;assert.notEqual(second,first);assert.equal(second.fieldEffectsSnapshot!.instanceCount,2);assert.equal(second.fieldEffectsSnapshot!.boards[0]!.flatProjection!.mapId,f.worldMap.mapId);
 const saved=game.checkpoint();assert.deepEqual(f.restore(saved).checkpoint(),saved);second.startEvent('world-return');assert.equal((await loader.load()).status,'committed');flow.advance(10,ready);assert.equal(game.field.fieldEffectsSnapshot!.instanceCount,3);assert.equal(game.field.fieldEffectsSnapshot!.boards[0]!.flatProjection!.mapId,f.map.mapId);assert.equal(first.fieldEffectsSnapshot!.instanceCount,1);
});
test('actual event save quota retry/restore keeps the same projected pool and runs the original continuation once',async()=>{
 const{f,game,flow}=await fixture();game.field.startEvent('go-world');const candidate=game.world.prepare(f.world,f.worldMap);assert.equal(game.world.commit(candidate),true);flow.advance(10,ready);const before=game.state.snapshot().items.find(i=>i.id===701)!.count;
 game.field.startEvent('world-save');const request=game.eventSaveRequest,fx=game.field.fieldEffectsSnapshot;assert(request);let fail=true;const files=new Map<string,string>(),storage=new CheckpointStorage({getItem:k=>files.get(k)??null,setItem:(k,v)=>{if(fail)throw Error('controlled quota');files.set(k,v);}}),save=new GameEventSaveCoordinator(flow,storage);
 assert.equal((await save.save(100)).status,'failed');assert.equal(game.eventSaveRequest,request);assert.deepEqual(game.field.fieldEffectsSnapshot,fx);fail=false;assert.equal((await save.save(101)).status,'committed');
 const checkpoint=(await storage.load())!.checkpoint;assert.equal(checkpoint.world.kind,'event-world-v2');const restored=f.restore(checkpoint);assert.deepEqual(restored.field.fieldEffectsSnapshot,fx);restored.advance(10);assert.equal(restored.state.snapshot().items.find(i=>i.id===701)!.count,before+2);restored.advance(10);assert.equal(restored.state.snapshot().items.find(i=>i.id===701)!.count,before+2);
});
test('battle handoff failure/retry and settlement keep the same field owner and pause projected effect time',async()=>{
 const{game,flow}=await fixture();game.field.startEvent('fx-battle');flow.advance(10,ready);const field=game.field,fx=field.fieldEffectsSnapshot;assert.equal(field.stop?.kind,'encounter');let fail=true;
 const handoff=new GameBattleHandoff(flow,{prepareStart:async()=>{if(fail)throw Error('controlled FX battle media');return null;},prepareReturn:async()=>null,discard(){}});
 assert.equal((await handoff.start()).status,'failed');assert.equal(game.field,field);assert.deepEqual(field.fieldEffectsSnapshot,fx);fail=false;assert.equal((await handoff.start()).status,'committed');
 const during=field.fieldEffectsSnapshot,battle=game.battle!,commands=new GameCommands(flow,game);game.advance(100);assert.deepEqual(field.fieldEffectsSnapshot,during);
 for(let i=0;i<5000&&battle.phase==='active';i++){for(const actor of battle.ready){const target=battle.enemies.find(e=>e.hp>0);if(target)commands.command(battle,actor.id,10,target.id,100);}flow.advance(10,ready);}
 assert.equal(battle.phase,'victory');assert.deepEqual(field.fieldEffectsSnapshot,during);assert.equal((await handoff.return()).status,'committed');flow.advance(10,ready);
 assert.equal(game.battle,null);assert.equal(game.field,field);assert.equal(field.fieldEffectsSnapshot!.instanceCount,1);assert.equal(field.fieldEffectsSnapshot!.boards[0]!.flatProjection!.entityId,'900');
});
