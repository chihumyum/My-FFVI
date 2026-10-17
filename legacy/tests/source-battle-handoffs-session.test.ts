import {WEB_BATTLE_EVENT_EFFECTS,createWebBattleEventEffectHost} from '../src/core/battle-event-effect.js';
import {authoredBattleEffect} from './fixtures/battle-event-effect.js';
import {playerSessionFixture} from './fixtures/battle-player-game.js';
import {GameState} from '../src/core/game-state.js';
import {BattleGame} from '../src/core/battle.js';
import {encounterContent} from '../src/core/battle-content.js';
import {WEB_BATTLE_EVENT_CONTROLS} from '../src/core/battle-controls.js';
import {WEB_SOURCE_BATTLE_HANDOFFS,sourceFinalWaiting} from '../src/core/source-battle-handoffs.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {sourcePartySelectionSessionFixture,selectionHost} from './fixtures/source-party-selection-session.js';
import {emptyPartyState} from '../src/core/party.js';
import {CheckpointStorage} from '../src/core/saved-game.js';
import {GameFlow} from '../src/core/game-flow.js';
import {GameCommands} from '../src/core/game-commands.js';
import type {BattleEventOp} from '../src/core/battle-event.js';

function open(ops?:BattleEventOp[]) {
  const fixture=sourcePartySelectionSessionFixture({handoffs:true,...(ops?{handoffOps:ops}:{})}),h=fixture.make();
  assert(h.game.field.startEvent('selection-final'));h.flow.advance(10,selectionHost);
  assert.equal(h.flow.phase,'party-selection',h.game.field.stop?.message);
  return {...h,fixture};
}
function drain(h:ReturnType<typeof open>){for(let n=0;n<100&&!h.game.checkpointReady;n++)h.flow.advance(10,selectionHost);assert(h.game.checkpointReady,h.game.field.stop?.message);}
function select(h:ReturnType<typeof open>) {
  const before=h.game.state.snapshot(),slots=emptyPartyState().slots;
  slots[0][0].id=before.roster[0]!.id;slots[1][2].id=before.roster[1]!.id;
  const request=h.commands.sourcePartySelection()!;
  assert(h.commands.completeSourcePartySelection(request.token,{kind:'confirm',slots}));drain(h);
  return {before,slots,request};
}
function startBattle(h:ReturnType<typeof open>){assert(h.game.field.startEvent('stone-battle'));h.flow.advance(10,selectionHost);assert(h.game.battle,h.game.encounterPreparationError??h.game.field.stop?.message);return h.game.battle;}

test('the actual final-wave owner returns Next on the clock with no pending registers',()=>{
  const ops:BattleEventOp[]=[{kind:'blank'},{kind:'source-final-player-switch'},
    {kind:'calc',index:0,operator:'←',right:{kind:'immediate',value:7}},
    {kind:'blank'},{kind:'force-return'},{kind:'exit'}];
  for (const pending of [false,true]) {
    const h=open(ops);
    if (pending) select(h);
    else {const request=h.commands.sourcePartySelection()!;assert(h.commands.completeSourcePartySelection(request.token,{kind:'cancel'}));drain(h);}
    const battle=startBattle(h),generation=battle.playerExecution!.nextGeneration;
    h.game.advance(10);
    if (pending) {
      assert.equal(battle.eventExecution.state!.wait?.kind,'source-final-player-entry');
      assert.equal(battle.eventExecution.state!.locals[0],0);
      h.game.advance(10);
    }
    assert.equal(battle.eventExecution.state!.pc,3);
    assert.equal(battle.eventExecution.state!.wait?.kind,'blank');
    assert.deepEqual(battle.eventExecution.state!.locals,[7,0,2]);
    assert.equal(battle.playerExecution!.nextGeneration,generation+(pending?1:0));
  }
});

test('actual native final menu produces durable numeric waiting IDs; the existing Battle consumes them and returns once through Flow/Storage',async()=>{
  const h=open([{kind:'blank'},{kind:'capture-source-0055'},{kind:'source-final-player-switch'},{kind:'force-return'}]),{before,slots}=select(h);
  const organized=h.game.state.snapshot();assert.equal(organized.formatVersion,17);
  assert.deepEqual(organized.sourceBattleHandoffs?.finalWaiting?.ownedIds,[before.roster[1]!.ownedId]);
  const bytes=new Map<string,string>(),storage=new CheckpointStorage({getItem:k=>bytes.get(k)??null,setItem:(k,v)=>{bytes.set(k,v);}});
  (await storage.prepareSave(h.game.checkpoint(),0)).commit();const loaded=h.fixture.restore((await storage.load())!.checkpoint);
  assert.deepEqual(loaded.checkpoint(),h.game.checkpoint());
  const flow=new GameFlow(loaded);flow.start();flow.observeHost(selectionHost);const commands=new GameCommands(flow,loaded);
  assert(loaded.field.startEvent('stone-battle'));flow.advance(10,selectionHost);assert(loaded.battle,loaded.encounterPreparationError??undefined);
  const battle=loaded.battle,survivor=battle.players[0]!;survivor.hp=Math.floor(survivor.maxHp/2);survivor.mp=1;
  for(let n=0;n<30&&battle.phase!=='forced';n++)flow.advance(10,selectionHost);
  assert.equal(battle.phase,'forced');assert.equal(battle.players[0],survivor,'living actual instance survives a partial switch');
  assert.deepEqual(battle.players.map(p=>battle.playerOwnedId(p.id)),before.roster.map(p=>p.id));
  assert.equal(battle.players[1]!.id,'player:dynamic:1');
  assert.equal(battle.playerExecution!.slots[1]!.instanceId,'player:dynamic:1','the first native empty Corps cell receives the waiting owner');
  assert.deepEqual(loaded.state.snapshot(),organized,'Battle facts remain tentative before the return owner commits');
  const facts=battle.sourceBattleHandoffReturn!;assert.deepEqual(facts.finalWaiting!.remaining.ownedIds,[]);
  assert.deepEqual(facts.takeOver0055!.characters.map(p=>[p.id,p.ownedId,p.hp,p.mp]),[[survivor.id,before.roster[0]!.ownedId,survivor.hp,1]]);
  const original=loaded.field.prepareEncounterReturn.bind(loaded.field);
  loaded.field.prepareEncounterReturn=()=>{throw Error('Controlled handoff return failure');};
  assert.throws(()=>loaded.continueForcedReturn(),/Controlled handoff return/);assert.deepEqual(loaded.state.snapshot(),organized);
  assert.deepEqual(battle.sourceBattleHandoffReturn,facts);loaded.field.prepareEncounterReturn=original;
  assert(loaded.continueForcedReturn());assert.equal(loaded.continueForcedReturn(),false);loaded.advance(10);
  const settled=loaded.state.snapshot();assert.equal(settled.completedBattles.length,1);assert.deepEqual(settled.party,{selectedSlot:0,slots});
  assert.deepEqual(settled.sourceBattleHandoffs?.finalWaiting?.ownedIds,[]);assert.deepEqual(settled.sourceBattleHandoffs?.takeOver0055,facts.takeOver0055);
  assert.equal(commands.sourcePartySelection(),null);
  (await storage.prepareSave(loaded.checkpoint(),1)).commit();const restored=h.fixture.restore((await storage.load())!.checkpoint);
  assert.deepEqual(restored.checkpoint(),loaded.checkpoint());
  const recover=restored.state.fieldSourceBattleHandoffs.prepare('restore-0055');
  assert.deepEqual(recover.targets,[before.roster[0]!.id]);recover.commit();assert.throws(recover.commit,/Stale/);
  assert.equal(restored.state.snapshot().roster[0]!.mp,1);assert.deepEqual(restored.state.snapshot().sourceBattleHandoffs,settled.sourceBattleHandoffs,'restore retains native history');
});

test('final menu cancellation still derives waiting facts from preserved Corps; pause, final host failure and stale tokens publish none',()=>{
  const h=open(),before=h.game.state.snapshot(),request=h.commands.sourcePartySelection()!;
  h.flow.pause(true);assert.equal(h.commands.completeSourcePartySelection(request.token,{kind:'cancel'}),false);h.flow.pause(false);
  let reads=0;
  assert.throws(()=>h.game.completeSourcePartySelection(request.token,{kind:'cancel'},()=>{if(++reads===3)throw Error('Controlled final UI host');return true;}),/Controlled final UI host/);
  assert.deepEqual(h.game.state.snapshot(),before);assert.equal(Object.hasOwn(before,'sourceBattleHandoffs'),false);
  assert(h.commands.completeSourcePartySelection(request.token,{kind:'cancel'}));drain(h);
  assert.equal(h.game.state.snapshot().formatVersion,17);assert.deepEqual(h.game.state.snapshot().party,{...before.party,selectedSlot:0});
  assert.deepEqual(h.game.state.snapshot().sourceBattleHandoffs?.finalWaiting?.ownedIds,[]);
  assert.equal(h.commands.completeSourcePartySelection(request.token,{kind:'cancel'}),false);
});

test('a late source request preserves prior completed Battle frames and retries without duplicate capture or participant identities',()=>{
  const h=open([{kind:'blank'},{kind:'capture-source-0055'},{kind:'source-final-player-switch'},{kind:'condition-list',target:{side:'player',id:0},conditionId:305,action:'add'}]);
  select(h);const battle=startBattle(h);h.game.advance(10);
  // The switch spans the existing event clocks. Its prior completed frames
  // stay published; the later frame's failed source request cannot invent a
  // whole-Battle rollback or a second capture/participant generation.
  let failure:unknown;for(let n=0;n<20;n++){try{h.game.advance(10);}catch(error){failure=error;break;}}
  assert.match(String(failure),/condition-list lifecycle owner/);const units=[...battle.combatants],before=structuredClone(battle.combatants),
    fact=battle.sourceBattleHandoffReturn,event=battle.eventExecution,participants=battle.playerExecution,time=battle.time;
  assert(fact?.takeOver0055);assert.equal(battle.playerExecution!.nextGeneration,2);
  assert.throws(()=>h.game.advance(10),/condition-list lifecycle owner/);assert.deepEqual(battle.combatants,before);
  assert(battle.combatants.every((unit,index)=>unit===units[index]));assert.deepEqual(battle.sourceBattleHandoffReturn,fact);
  assert.deepEqual(battle.eventExecution,event);assert.deepEqual(battle.playerExecution,participants);assert.equal(battle.time,time);
  assert.equal(h.game.state.snapshot().sourceBattleHandoffs?.takeOver0055,undefined);
});

test('a legacy owned save and an ordinary three-party request never grant a final waiting queue or source0055 capture',()=>{
  const old=sourcePartySelectionSessionFixture().make(),before=old.game.state.snapshot();
  assert.throws(()=>old.game.state.fieldSourceBattleHandoffs.prepare('restore-0055'),/catalog/);
  assert(old.game.field.startEvent('selection-final'));old.flow.advance(10,selectionHost);
  assert.equal(old.game.field.stop?.kind,'unsupported');assert.deepEqual(old.game.state.snapshot(),before);
  assert.equal(Object.hasOwn(before,'sourceBattleHandoffs'),false);
});

test('actual native Field Colosseum uses ScenarioVariable6 numeric owner, refreshes once, restores through Storage and borrows recovered values',async()=>{
  const f=sourcePartySelectionSessionFixture({handoffs:true,handoffOps:[{kind:'blank'},{kind:'force-return'}]}),h=f.make(),owned=h.game.state.snapshot(),target=owned.roster[1]!;
  const death=f.battle.common.conditions.hpZeroConditionId;target.hp=0;target.mp=1;target.conditionIds=[death];h.game.state.restore(owned);
  h.game.field.eventState.write({category:'ScenarioVariable',index:6},target.ownedId);const actor=h.game.field.player,native=h.game.field.nativeActorStateFingerprint;
  assert(h.game.field.startEvent('handoff-colosseum-recovery'));h.flow.advance(10,selectionHost);assert.equal(h.game.field.stop,null,h.game.field.stop?.message);
  const healed=h.game.state.snapshot();assert.equal(healed.roster[1]!.hp,target.maxHp);assert.equal(healed.roster[1]!.mp,target.maxMp);assert.deepEqual(healed.roster[1]!.conditionIds,[]);
  assert.deepEqual(healed.roster[0],owned.roster[0]);assert.equal(h.game.field.player,actor);assert.equal(healed.formatVersion,owned.formatVersion);
  const store=new Map<string,string>(),storage=new CheckpointStorage({getItem:k=>store.get(k)??null,setItem:(k,v)=>{store.set(k,v);}});
  (await storage.prepareSave(h.game.checkpoint(),0)).commit();const restored=f.restore((await storage.load())!.checkpoint);assert.deepEqual(restored.checkpoint(),h.game.checkpoint());
  assert.equal(typeof native,'string');assert(restored.field.startEvent('stone-battle'));restored.advance(10);assert(restored.battle,restored.encounterPreparationError??undefined);
  assert.equal(restored.battle.players[1]!.hp,target.maxHp);assert.equal(restored.battle.players[1]!.mp,target.maxMp);
});

test('a final Colosseum actor publication callback cannot perform ScenarioVariable6 ABA and authorize the obsolete target',()=>{
  const f=sourcePartySelectionSessionFixture({handoffs:true}),h=f.make(),owned=h.game.state.snapshot();owned.roster[0]!.mp=1;h.game.state.restore(owned);
  const events=h.game.field.eventState,ref={category:'ScenarioVariable' as const,index:6},target=owned.roster[0]!.ownedId;events.write(ref,target);
  const before=h.game.state.snapshot(),appearance=h.game.field.partyActorCheckpoint,native=h.game.field.nativeActorStateFingerprint,port=h.game.state.fieldSourceBattleHandoffs,prepare=port.prepare.bind(port);
  port.prepare=(...args)=>{const candidate=prepare(...args);return{...candidate,commitWith:publish=>candidate.commitWith(()=>{events.write(ref,target+1);events.write(ref,target);publish();})};};
  const checkpoint=h.game.checkpoint();assert(h.game.field.startEvent('handoff-colosseum-recovery'));h.flow.advance(10,selectionHost);
  assert.match(h.game.field.stop!.message,/Stale source handoff scenario/);assert.deepEqual(h.game.state.snapshot(),before);
  assert.deepEqual(h.game.field.partyActorCheckpoint,appearance);assert.equal(h.game.field.nativeActorStateFingerprint,native);
  port.prepare=prepare;const retry=f.restore(checkpoint);assert(retry.field.startEvent('handoff-colosseum-recovery'));retry.advance(10);assert.equal(retry.field.stop,null);
  assert.equal(retry.state.snapshot().roster[0]!.mp,before.roster[0]!.maxMp);assert.equal(h.game.field.startEvent('handoff-colosseum-recovery'),false);
});

test('owned17 actual facts coexist with saved forced-return receipts in both version-upgrade orders and survive Storage',async()=>{
  for(const capture of [false,true]) {
    const ops:BattleEventOp[]=[{kind:'blank'},...(capture?[{kind:'capture-source-0055'} as const]:[]),{kind:'force-save-return'}];
    const f=sourcePartySelectionSessionFixture({handoffs:true,handoffOps:ops}),base=f.make();
    const h={...base,fixture:f};
    if(capture){assert(h.game.field.startEvent('selection-final'));h.flow.advance(10,selectionHost);
      const pending=h.commands.sourcePartySelection()!;assert(h.commands.completeSourcePartySelection(pending.token,{kind:'cancel'}));drain(h);}
    const battle=startBattle(h);battle.players[0]!.mp=1;
    for(let n=0;n<20&&battle.phase!=='forced';n++)h.flow.advance(10,selectionHost);
    assert.equal(battle.phase,'forced');assert.equal(battle.previewForcedReturn()!.resultType,6);assert(h.game.continueForcedReturn());h.game.advance(10);
    if(!capture){assert(h.game.field.startEvent('selection-final'));h.flow.advance(10,selectionHost);const pending=h.commands.sourcePartySelection()!;
      assert(h.commands.completeSourcePartySelection(pending.token,{kind:'cancel'}));drain(h);}
    const saved=h.game.checkpoint();assert.equal(saved.owned.formatVersion,17);assert.equal(saved.owned.completedBattles[0]!.outcome,'forced-save');
    assert.equal(saved.owned.sourceBattleHandoffs?.takeOver0055!==undefined,capture);
    const bytes=new Map<string,string>(),storage=new CheckpointStorage({getItem:k=>bytes.get(k)??null,setItem:(k,v)=>{bytes.set(k,v);}});
    (await storage.prepareSave(saved,0)).commit();assert.deepEqual(f.restore((await storage.load())!.checkpoint).checkpoint(),saved);
  }
});

test('dead-first pending entry with a later living owner keeps ordinary defeat explicit; the source end-disabled path can finish on existing event clocks',()=>{
  for(const disabled of [false,true]) {
    const f=playerSessionFixture(),catalog={kind:'source-battle-handoff-catalog-v1' as const,policy:WEB_SOURCE_BATTLE_HANDOFFS,sourceSetHash:'authored',
      conditions:f.battle.common.conditions.rules.definitions.map(({id,type})=>({id,type,untilType:0}))};
    f.battle.gameState.sourceBattleHandoffs=catalog;
    const state=new GameState(f.battle.gameState,f.battle.common.players,f.battle.contentHash,f.battle.common.conditions),injured=state.snapshot();
    for(const id of ['a','b','c']){const member=injured.roster.find(m=>m.id===id)!;member.hp=0;member.conditionIds=[305];}state.restore(injured);
    const content=encounterContent(f.battle,1000)!,ops:BattleEventOp[]=[{kind:'blank'},...(disabled?[{kind:'end-enabled',enabled:false} as const]:[]),
      {kind:'source-final-player-switch'},{kind:'end-enabled',enabled:true},{kind:'force-return'},{kind:'exit'}];
    content.lifecycle={kind:'battle-lifecycle-v1',mode:'script',scriptId:1,program:{kind:'battle-event-v1',source:null,entry:0,end:ops.length,
      localNames:['AI','unused','phase'],initialLocals:[0,0,0],blockers:[],instructions:ops.map(op=>({mnemonic:op.kind,op}))}};
    const lease=state.openBattle(1000,undefined,content.playerParticipants),entry=state.sourceBattleHandoffEntry(lease);
    entry.finalWaiting=sourceFinalWaiting(injured.party,injured.roster,catalog);
    const battle=new BattleGame(content,337,state.battlePlayers(lease),state.battleInventory(lease),undefined,undefined,undefined,state.battlePlayerBorrow(lease),
      {sourceHandoffs:entry,controls:WEB_BATTLE_EVENT_CONTROLS}),before={units:structuredClone(battle.combatants),event:battle.eventExecution,players:battle.playerExecution},identities=[...battle.combatants];
    if(!disabled){
      assert.throws(()=>battle.advance(10),/native defeat\/entry ordering/);assert.equal(battle.time,0);assert.equal(battle.sourceBattleHandoffReturn,undefined);
      assert.deepEqual({units:battle.combatants,event:battle.eventExecution,players:battle.playerExecution},before);assert(battle.combatants.every((unit,i)=>unit===identities[i]));
      assert.throws(()=>battle.advance(0),/native defeat\/entry ordering/);
    }else{
      battle.advance(10);assert.equal(battle.phase,'active');assert.deepEqual(battle.players.map(p=>battle.playerOwnedId(p.id)),['c']);
      for(let n=0;n<10&&battle.phase==='active';n++)battle.advance(10);assert.equal(battle.phase,'forced');
      assert.deepEqual(battle.players.map(p=>battle.playerOwnedId(p.id)),['c','d']);assert(battle.players[1]!.hp>0);
    }
  }
});

test('same-frame actual capture and a final resource failure publish no prefix and retry on the original Battle frame',()=>{
  let fail=true;const base=createWebBattleEventEffectHost(),fixture=sourcePartySelectionSessionFixture({handoffs:true,
    handoffOps:ids=>[{kind:'blank'},{kind:'capture-source-0055'},authoredBattleEffect(1,ids[0]!),{kind:'force-return'}],
    battleEventEffects:{policy:WEB_BATTLE_EVENT_EFFECTS,prepare(request){const resource=base.prepare(request);return{...resource,commit(){if(fail)throw Error('Controlled capture effect failure');resource.commit();}};}}}),
    h={...fixture.make(),fixture},battle=startBattle(h);h.game.advance(10);
  const owned=h.game.state.snapshot(),units=[...battle.combatants],
    before={units:structuredClone(battle.combatants),event:battle.eventExecution,players:battle.playerExecution,time:battle.time};
  assert.equal(battle.sourceBattleHandoffReturn,undefined);assert.throws(()=>h.game.advance(10),/Controlled capture effect failure/);
  assert.equal(battle.sourceBattleHandoffReturn,undefined);assert.deepEqual(h.game.state.snapshot(),owned);
  assert.deepEqual({units:battle.combatants,event:battle.eventExecution,players:battle.playerExecution,time:battle.time},before);
  assert(battle.combatants.every((unit,index)=>unit===units[index]));fail=false;battle.advance(0);
  const facts=(battle as BattleGame).sourceBattleHandoffReturn;assert.equal(battle.phase,'forced');assert(facts);assert.equal(facts.takeOver0055?.characters.length,battle.players.length);
  assert(h.game.continueForcedReturn());assert.equal(h.game.state.snapshot().completedBattles.length,1);
});

test('a failed actual final-player resource preparation rolls the same-frame capture, retirement, RNG and instance generation back before retry',()=>{
  const h=open([{kind:'blank'},{kind:'capture-source-0055'},{kind:'source-final-player-switch'},{kind:'force-return'}]);select(h);const battle=startBattle(h),
    units=[...battle.combatants],before={units:structuredClone(battle.combatants),event:battle.eventExecution,players:battle.playerExecution,time:battle.time},
    key=battle.players[0]!.sprites.idle,media=battle.content.sprites[key]!;delete battle.content.sprites[key];
  assert.throws(()=>h.game.advance(10),/Missing borrowed player media/);assert.equal(battle.sourceBattleHandoffReturn,undefined);
  assert.deepEqual({units:battle.combatants,event:battle.eventExecution,players:battle.playerExecution,time:battle.time},before);
  assert(battle.combatants.every((unit,index)=>unit===units[index]));battle.content.sprites[key]=media;battle.advance(0);
  assert.equal(battle.playerExecution!.nextGeneration,2);assert.equal((battle as BattleGame).sourceBattleHandoffReturn?.takeOver0055?.characters.length,1);
  for(let n=0;n<10&&battle.phase==='active';n++)h.game.advance(10);assert.equal(battle.phase,'forced');
  assert(h.game.continueForcedReturn());assert.equal(h.game.continueForcedReturn(),false);
});
