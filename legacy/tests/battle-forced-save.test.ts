import test from 'node:test';import assert from 'node:assert/strict';
import {BattleGame} from '../src/core/battle.js';import{encounterContent}from'../src/core/battle-content.js';import {GameState} from '../src/core/game-state.js';import {GameSession} from '../src/core/game-session.js';import {GameFlow} from '../src/core/game-flow.js';
import {GameBattleHandoff} from '../src/core/game-battle-handoff.js';import{CheckpointStorage}from'../src/core/saved-game.js';
import {WEB_BATTLE_EVENT_CONTROLS}from'../src/core/battle-controls.js';
import {WEB_BATTLE_FORCED_SAVE,BattleRetainedLootLedger,parseBattleSavedForcedReturnResult,parseWebBattleForcedSave,type BattleSavedForcedReturnResult}from'../src/core/battle-forced-save.js';
import {projectCommittedBattleResult}from'../src/core/source-battle-result.js';
import {battleMessageProgram,battleMessageContent,battleMessageSessionFixture,messageRaw}from'./fixtures/battle-event-message.js';
import {ownedConditionGameFixture,magitekRowId}from'./fixtures/owned-condition.js';import{fixtureParty}from'./fixtures/party.js';
import{participantLoop}from'./fixtures/battle-participant-game.js';
import{WEB_BATTLE_EVENT_EFFECTS,createWebBattleEventEffectHost}from'../src/core/battle-event-effect.js';import{authoredBattleEffect}from'./fixtures/battle-event-effect.js';
import {playerSessionFixture}from'./fixtures/battle-player-game.js';
import{checkpointFixture}from'./fixtures/checkpoint-game.js';
const policy={kind:WEB_BATTLE_FORCED_SAVE},ready={visible:true,mediaReady:true,overlayOpen:false},save=()=>messageRaw('BattleForceExitOnSave'),force=()=>messageRaw('BattleForceExit');
const program=()=>battleMessageProgram([save(),messageRaw('Wait',.1),messageRaw('Exit')]);
function setup(p=program(),configure?:(f:ReturnType<typeof battleMessageSessionFixture>)=>void){
 const f=battleMessageSessionFixture(p);configure?.(f);f.battle.encounters[1000]!.forcedSavePolicy={...policy};
 const runtime={...f.runtime,battleEventControls:WEB_BATTLE_EVENT_CONTROLS},game=new GameSession(f.field,f.battle,73,runtime),flow=new GameFlow(game);
 flow.start();assert(game.field.startEvent('fight'));flow.advance(10,ready);assert(game.prepareBattleStart()!.commit());return {...f,runtime,game,flow,battle:game.battle!};
}
function terminal(f:ReturnType<typeof setup>){f.flow.advance(10,ready);assert.equal(f.battle.phase,'forced');const result=f.battle.previewForcedReturn()!;assert.equal(result.resultType,6);if(result.kind!=='battle-save-return-v1')throw Error('Expected actual Save result');return result;}
test('source Save decodes the exact zero padding, stays Next and needs its own declared lease/content policy',()=>{
 assert.deepEqual(program().instructions[0]!.op,{kind:'force-save-return'});
 for(const key of ['iValues','rValues','sValues']as const){const raw=save();(raw.operands[key]as(number|string)[])[7]=key==='sValues'?'extra':1;assert.equal(battleMessageProgram([raw,messageRaw('Exit')]).instructions[0]!.op.kind,'blocked');}
 assert.throws(()=>new BattleGame(battleMessageContent(program()),1),/explicit Web|forced-return policy/);
 assert.throws(()=>parseWebBattleForcedSave({...policy,extra:true}));assert.throws(()=>parseWebBattleForcedSave({kind:'unknown'}));
});
test('actual Save outranks live enemies/dead players, preserves resources and rows without victory, growth, Gil or a second loot draw',()=>{
 const f=setup(),before=f.game.state.snapshot();f.battle.players[0]!.hp=1;f.battle.players[0]!.mp=0;f.battle.players[0]!.row='back';
 f.battle.enemies[0]!.hp=0;f.battle.enemies[0]!.conditionIds=[305];
 const result=terminal(f);assert.equal(f.battle.reward,null);assert.equal(result.players[0]!.hp,1);assert.equal(result.players[0]!.mp,0);
 assert.deepEqual(result.retainedLoot,{kind:'battle-retained-loot-v1',stolen:[],drops:[]});assert.equal(f.battle.enemies[1]!.hp,10);
 const candidate=f.game.prepareBattleReturn()!;assert.deepEqual(f.game.state.snapshot(),before);assert(candidate.commit());assert.equal(candidate.commit(),false);
 const after=f.game.state.snapshot();assert.equal(after.formatVersion,15);assert.equal(after.roster[0]!.hp,1);assert.equal(after.roster[0]!.mp,0);assert.equal(after.party.slots[0][0].row,'back');
 assert.deepEqual(after.completedBattles,[{serial:0,encounterId:1000,outcome:'forced-save'}]);assert.deepEqual(f.game.state.completedEncounters,[]);
 for(const key of ['gil','totalGil','items','equipmentStock','learnedAbilityIds']as const)assert.deepEqual(after[key],before[key]);
 assert.equal(after.roster[0]!.exp,before.roster[0]!.exp);assert.equal(after.roster[0]!.level,before.roster[0]!.level);
 assert.throws(()=>projectCommittedBattleResult(after,1),/previous-result publication/);
});
test('Force keeps its native priority over Save in both request orders and disabled end judgment retains the Save request',()=>{
 for(const ops of [[force(),save()],[save(),force()]]){const f=setup(battleMessageProgram([...ops,messageRaw('Wait',.1),messageRaw('Exit')]));f.battle.players[0]!.hp=1;f.flow.advance(10,ready);assert.equal(f.battle.previewForcedReturn()!.resultType,4);assert(f.game.prepareBattleReturn()!.commit());assert.equal(f.game.state.snapshot().formatVersion,12);assert.equal(f.game.state.snapshot().roster[0]!.hp,80);}
 const enabled=messageRaw('BattleEndEnabled');enabled.operands.iValues[0]=1;
 const f=setup(battleMessageProgram([messageRaw('BattleEndEnabled'),save(),messageRaw('Wait',.03),enabled,messageRaw('Exit')]));f.flow.advance(10,ready);assert.equal(f.battle.phase,'active');f.flow.advance(30,ready);assert.equal(f.battle.previewForcedReturn()!.resultType,6);
});
test('Save returns committed spell and item costs while an already confirmed action remains staged; pending work is never charged twice',()=>{
 for(const kind of ['spell','item']as const){
  const f=setup(battleMessageProgram([messageRaw('Wait',.65),save(),messageRaw('Wait',.1),messageRaw('Exit')]),data=>{
   data.battle.gameState.initialItems=[{id:10,count:2}];data.battle.common.commands[3]={id:3,name:'Controlled item',kind:'item',abilityIds:[],referencedAbility:null,forbiddenConditionIds:[]};for(const p of data.battle.common.players)p.commands!.push(3);
  }),before=f.game.state.snapshot();f.battle.players[0]!.hp=40;
  assert.equal(kind==='spell'?f.battle.command('a',11,'a'):f.battle.commandItem('a',10,{kind:'single',id:'a'},3),true);
  for(let n=0;n<100&&f.battle.phase==='active';n++)f.flow.advance(10,ready);
  assert.equal(f.battle.phase,'forced');assert(f.battle.action?.resolved);const result=f.battle.previewForcedReturn()!;assert.equal(result.resultType,6);
  assert(f.game.prepareBattleReturn()!.commit());const after=f.game.state.snapshot();
  assert.equal(after.roster[0]!.mp,before.roster[0]!.mp-(kind==='spell'?2:0));assert.equal(after.items.find(i=>i.id===10)!.count,kind==='item'?1:2);assert.equal(after.completedBattles.length,1);
  assert.equal(f.game.prepareBattleReturn(),null);
 }
});
test('a saved return clears temporary conditions for disabled and nonparticipating owned records and consumes exact six-slot stock bindings',()=>{
 const f=ownedConditionGameFixture(),c=f.catalog.common.conditions;
 c.rules.definitions.push({id:9010,type:6,overlapped:false,eraseGroupId:3});c.behaviors.push({id:9010,kind:'silence',name:'Controlled temporary',untilType:2});
 f.catalog.gameState.fieldConditions!.definitions.push({id:9010,type:6});f.catalog.gameState.fieldConditions!.behaviors.push({id:9010,kind:'none'});
 const state=f.make(),initial=state.snapshot();initial.party=fixtureParty(['a']);initial.roster[1]!.enabled=false;initial.roster[0]!.conditionIds=[9010,magitekRowId];initial.roster[1]!.conditionIds=[9010,magitekRowId];state.restore(initial);
 const lease=state.openBattle(1000,undefined,undefined,policy),players=state.battlePlayers(lease);players[0]!.conditionIds=[magitekRowId];players[0]!.mp--;
 const result:BattleSavedForcedReturnResult={kind:'battle-save-return-v1',resultType:6,policy,players,participants:players.map(p=>({ownedId:p.id,sourceId:p.sourceId})),consumedItems:[],retainedLoot:{kind:'battle-retained-loot-v1',stolen:[],drops:[]},equipment:state.battleInventory(lease).qualification!};
 const wrong=structuredClone(result);wrong.equipment!.equipmentStock[0]!.count++;assert.throws(()=>state.prepareForcedReturn(lease,wrong),/equipment.*owner/);
 const tx=state.prepareForcedReturn(lease,result);assert.deepEqual(state.snapshot(),initial);tx();assert.throws(tx,/Stale/);
 const after=state.snapshot();assert.deepEqual(after.roster.map(m=>m.conditionIds),[[magitekRowId],[magitekRowId]]);assert.equal(after.roster[1]!.enabled,false);assert.deepEqual(after.equipmentStock,initial.equipmentStock);
 assert.deepEqual(after.roster.map(m=>m.equipment),initial.roster.map(m=>m.equipment));assert.equal(after.roster[0]!.mp,initial.roster[0]!.mp-1);
 const restored=f.make();restored.restore(JSON.parse(JSON.stringify(after)));assert.deepEqual(restored.snapshot(),after);
 const old=structuredClone(after);old.formatVersion=12;assert.throws(()=>restored.restore(old),/version/);
});
test('pending registered enemy deaths are not an existing drop list and Save does not invoke the victory lottery',()=>{
 const f=setup(battleMessageProgram([messageRaw('Wait',.03),save(),messageRaw('Wait',.1),messageRaw('Exit')]),data=>{
  data.battle.common.drops={kind:'battle-drops-v1',weights:[100,0,0,0,0,0,0,0],monsters:[...new Set(data.battle.encounters[1000]!.enemies.map(e=>e.sourceId))].map(id=>({id,rate:100,
   slots:Array.from({length:8},(_,i)=>({contentId:i===0?10:0,count:i===0?1:0}))})),contents:[{id:10,kind:'item'}]};
 });
 f.battle.enemies[0]!.hp=0;f.battle.enemies[0]!.conditionIds=[305];f.flow.advance(10,ready);assert.equal(f.battle.registeredDropMonsters.length,1);
 const random=(f.battle as unknown as{randomState:number}).randomState;f.flow.advance(40,ready);assert.equal(f.battle.phase,'forced');assert.equal((f.battle as unknown as{randomState:number}).randomState,random);
 const result=f.battle.previewForcedReturn()!;assert.equal(result.resultType,6);assert.deepEqual(f.battle.retainedLootSnapshot.drops,[]);assert(f.game.prepareBattleReturn()!.commit());assert.deepEqual(f.game.state.snapshot().items,[]);
});
test('retained loot is a transactional ledger distinct from death registrations; save grants actual steals before used items and retains drop grants',()=>{
 const ledger=new BattleRetainedLootLedger();ledger.record('stolen',[{kind:'grant-item',id:10,count:2}]);ledger.record('drops',[{kind:'grant-item',id:10,count:3}]);
 const snapshot=ledger.snapshot();assert.throws(()=>ledger.record('stolen',[{kind:'grant-equipment',id:10,count:1}]),/Conflicting/);assert.deepEqual(ledger.snapshot(),snapshot);
 const f=checkpointFixture(),owner=new GameState(f.battle.gameState,f.battle.common.players,f.battle.contentHash,f.battle.common.conditions);owner.changeItems([{id:10,count:3}],'grant');const before=owner.snapshot(),
  lease=owner.openBattle(1000,undefined,undefined,policy),players=owner.battlePlayers(lease),result:BattleSavedForcedReturnResult={kind:'battle-save-return-v1',resultType:6,policy,
   players,participants:players.map(p=>({ownedId:p.id,sourceId:p.sourceId})),consumedItems:[{id:10,count:1}],retainedLoot:snapshot,equipment:owner.battleInventory(lease).qualification??null};
 const bad=structuredClone(result);bad.retainedLoot.drops.push({kind:'grant-item',id:99999,count:1});assert.throws(()=>owner.prepareForcedReturn(lease,bad));assert.deepEqual(owner.snapshot(),before);assert.equal(owner.inBattle,true);
 owner.prepareForcedReturn(lease,result)();assert.equal(owner.snapshot().items.find(i=>i.id===10)!.count,Math.min(f.battle.gameState.limits.item,before.items.find(i=>i.id===10)!.count+4));assert.equal(owner.inBattle,false);
 assert.throws(()=>parseBattleSavedForcedReturnResult({...result,extra:true}));
});
test('failed/cancelled/stale prepared Save returns retain the same terminal owner and Storage restores the distinct receipt without reapplying costs',async()=>{
 const f=setup();f.battle.players[0]!.mp=0;terminal(f);const before=f.game.state.snapshot();let finish!:(value:null)=>void;
 const handoff=new GameBattleHandoff(f.flow,{prepareStart:async()=>null,prepareReturn:()=>new Promise<null>(resolve=>{finish=resolve;}),discard(){}});
 const pending=handoff.return();handoff.cancel();finish(null);assert.equal((await pending).status,'cancelled');assert.deepEqual(f.game.state.snapshot(),before);
 let fail=true;const retry=new GameBattleHandoff(f.flow,{prepareStart:async()=>null,prepareReturn:async()=>{if(fail)throw Error('Controlled Save media failure');return null;},discard(){}});
 assert.equal((await retry.return()).status,'failed');assert.equal(f.game.battle,f.battle);fail=false;assert.equal((await retry.return()).status,'committed');f.game.advance(10);
 const values=new Map<string,string>(),storage=new CheckpointStorage({getItem:k=>values.get(k)??null,setItem:(k,v)=>{values.set(k,v);}});await storage.save(f.game.checkpoint(),1000);const saved=await storage.load();assert(saved);
 const restored=GameSession.restore(saved.checkpoint,f.field,f.game.battleCatalog,undefined,f.runtime);assert.deepEqual(restored.checkpoint(),saved.checkpoint);assert.equal(restored.state.snapshot().roster[0]!.mp,0);
 assert(restored.field.startEvent('fight'));restored.advance(10);assert(restored.prepareBattleStart()!.commit());restored.advance(10);assert(restored.prepareBattleReturn()!.commit());assert.deepEqual(restored.state.snapshot().completedBattles.map(b=>b.outcome),['forced-save','forced-save']);
});
test('dynamic borrowed current/retired resources use owned identities once while membership and selected group remain fixed',()=>{
 const f=playerSessionFixture([{kind:'add-player',sourceId:33},{kind:'wait',seconds:.01},{kind:'change-player-group',group:1},{kind:'wait',seconds:.01},{kind:'force-save-return'}]);
 f.battle.encounters[1000]!.forcedSavePolicy=policy;const game=new GameSession(f.field,f.battle,79,{battleEventControls:WEB_BATTLE_EVENT_CONTROLS});const before=game.state.snapshot();game.field.startEvent('fight');
 for(let n=0;n<30&&game.battle?.phase!=='forced';n++)game.advance(10);assert.equal(game.battle!.phase,'forced');const result=game.battle!.previewForcedReturn()!;
 assert.equal(result.resultType,6);assert.equal(new Set(result.participants.map(p=>p.ownedId)).size,result.participants.length);assert(game.prepareBattleReturn()!.commit());const after=game.state.snapshot();assert.deepEqual(after.party,before.party);assert.equal(after.roster.length,before.roster.length);
});

test('actual borrowed equipment is normalized from live instance IDs to entered owned identities and keeps its full stock closure',()=>{
 const f=ownedConditionGameFixture(),state=f.make(),initial=state.snapshot();initial.party=fixtureParty(['a']);initial.roster[1]!.enabled=false;state.restore(initial);
 const plan={kind:'battle-player-plan-v1' as const,profile:'web-owned-borrow-v1' as const,sourceIds:[2],groups:[],rewardScope:'all-entered' as const,returnParty:'preserve-entry' as const};
 const content=encounterContent(f.catalog,1000)!;content.forcedSavePolicy=policy;content.playerParticipants=plan;content.sprites.synthetic={file:'synthetic.png',width:16,height:16};
 content.battleEvents={conditions:content.conditions.rules.definitions.map(({id,type})=>({id,type,attackTarget:type===5?1:0,gameOverTarget:type===5?1:0}))};
 content.lifecycle={kind:'battle-lifecycle-v1',mode:'script',scriptId:1,program:participantLoop([{kind:'add-player',sourceId:2},{kind:'wait',seconds:.01},{kind:'force-save-return'}])};
 const lease=state.openBattle(1000,undefined,plan,policy),inventory=state.battleInventory(lease),b=new BattleGame(content,79,state.battlePlayers(lease),inventory,undefined,undefined,undefined,state.battlePlayerBorrow(lease),{controls:WEB_BATTLE_EVENT_CONTROLS});
 for(let n=0;n<30&&b.phase==='active';n++)b.advance(10);assert.equal(b.phase,'forced');assert(b.players.some(p=>p.id!=='a'&&p.id!=='b'));
 const result=b.previewForcedReturn()!;assert.equal(result.resultType,6);if(result.kind!=='battle-save-return-v1')throw Error('Expected Save');
 assert.deepEqual(result.equipment!.members.map(m=>m.id),['a','b']);assert.equal(result.equipment!.equipmentStock.length,inventory.qualification!.equipmentStock.length);
 state.prepareForcedReturn(lease,result)();const after=state.snapshot();assert.deepEqual(after.party,initial.party);assert.deepEqual(after.equipmentStock,initial.equipmentStock);
 assert.deepEqual(after.roster.map(m=>m.equipment),initial.roster.map(m=>m.equipment));assert.equal(after.roster[1]!.enabled,false);
});
test('same-frame Save, message and effect failures restore the terminal bit and actual owners, then retry once',()=>{
 const p=battleMessageProgram([save(),messageRaw('Nop'),messageRaw('Msg',-1,'ASYNC'),messageRaw('Wait',.1),messageRaw('Exit')]);p.instructions[1]!.op=authoredBattleEffect(1);
 const f=battleMessageSessionFixture(p);f.battle.encounters[1000]!.forcedSavePolicy=policy;const base=createWebBattleEventEffectHost();let fail=true;
 const game=new GameSession(f.field,f.battle,9,{...f.runtime,battleEventControls:WEB_BATTLE_EVENT_CONTROLS,battleEventEffects:{policy:WEB_BATTLE_EVENT_EFFECTS,
  prepare(request){const r=base.prepare(request);return{...r,commit(){if(fail)throw Error('Controlled Save effect failure');r.commit();},discard(){r.discard();}};}}});
 game.field.startEvent('fight');game.advance(10);assert(game.prepareBattleStart()!.commit());const b=game.battle!,before={event:b.eventExecution,message:game.field.sourceMessage.snapshot(),owned:game.state.snapshot()};
 assert.throws(()=>game.advance(10),/Controlled Save effect failure/);assert.equal(b.phase,'active');assert.equal(b.previewForcedReturn(),null);
 assert.deepEqual({event:b.eventExecution,message:game.field.sourceMessage.snapshot(),owned:game.state.snapshot()},before);
 fail=false;b.advance(0);assert.equal(b.previewForcedReturn()!.resultType,6);assert(game.prepareBattleReturn()!.commit());assert.equal(game.field.sourceMessage.active,false);
 assert.equal(game.state.snapshot().completedBattles.length,1);assert.throws(()=>b.advance(10),/Retired/);
});
test('Save item ordering uses caps at each native step and cannot consume newly stolen stock as entry inventory',()=>{
 const f=checkpointFixture();f.battle.gameState.limits.item=4;const owner=new GameState(f.battle.gameState,f.battle.common.players,f.battle.contentHash,f.battle.common.conditions);
 owner.changeItems([{id:10,count:4}],'grant');const lease=owner.openBattle(1000,undefined,undefined,policy),players=owner.battlePlayers(lease);
 const result:BattleSavedForcedReturnResult={kind:'battle-save-return-v1',resultType:6,policy,players,participants:players.map(p=>({ownedId:p.id,sourceId:p.sourceId})),consumedItems:[{id:10,count:1}],
 retainedLoot:{kind:'battle-retained-loot-v1',stolen:[{kind:'grant-item',id:10,count:2}],drops:[]},equipment:owner.battleInventory(lease).qualification??null};
 const wrong=structuredClone(result);wrong.consumedItems[0]!.count=5;assert.throws(()=>owner.prepareForcedReturn(lease,wrong),/stack|count|stock/i);
 owner.prepareForcedReturn(lease,result)();assert.equal(owner.snapshot().items.find(i=>i.id===10)!.count,3);
 const ordinary=f.battle.gameState;const fresh=new GameState(ordinary,f.battle.common.players,f.battle.contentHash,f.battle.common.conditions),forged=fresh.snapshot();forged.formatVersion=15;assert.throws(()=>fresh.restore(forged),/version/);
});
