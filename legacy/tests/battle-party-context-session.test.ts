import {participantLoop} from './fixtures/battle-participant-game.js';
import test from 'node:test';import assert from 'node:assert/strict';
import {childAdmissionSessionFixture} from './fixtures/battle-child-admission.js';
import {WEB_BATTLE_PARTY_CONTEXT,parseBattlePartyContext,type BattlePartyDescriptor} from '../src/core/battle-party-context.js';
import {GameSession} from '../src/core/game-session.js';import {GameFlow} from '../src/core/game-flow.js';
import {CheckpointStorage} from '../src/core/saved-game.js';
import type {BattleEventOp} from '../src/core/battle-event.js';
import {DEVELOPMENT_TRANSPARENT_FADE} from '../src/core/field-fade.js';
import {WEB_BATTLE_GLOBAL_FADE} from '../src/core/battle-global-fade.js';
import {WEB_BATTLE_FORCED_SAVE} from '../src/core/battle-forced-save.js';
const ready={visible:true,mediaReady:true,overlayOpen:false};
function fixture(ops:BattleEventOp[],values=[2,5,7]){
 const f=childAdmissionSessionFixture(ops);f.catalog.common.battleAppearance!.conditions.push({id:305,type:5},{id:304,type:4});const e=f.catalog.encounters[1000]!,entries:Record<string,BattlePartyDescriptor>={};
 for(const [i,id]of [1000,501,502].entries()){
  const child=e.childPartyAdmission!.entries[id];
  entries[id]={partyId:id,source:child?.source??{file:'controlled.bundle',assetPath:'Assets/Master/monster_party.csv',serializedFile:'controlled',objectId:'90071992547409939',rowId:String(id)},
   battleFlagGroupId:child?.flagGroupId??0,flagRows:structuredClone(child?.flagRows??[]),notEscape:child?.notEscape??0,
   backgroundId:9,bgmId:7,appearanceProduction:0,getAp:0,getValue:values[i]!,scriptId:0,patterns:[1,0,0,0,0,0]};
 }
 e.partyContext=parseBattlePartyContext({kind:'source-battle-party-context-v1',policy:WEB_BATTLE_PARTY_CONTEXT,rootPartyId:1000,entries});
 e.rewardPolicy={kind:'battle-reward-policy-v1',ap:0,magicPoints:values[0]!};
 return f;
}
function start(f:ReturnType<typeof fixture>){
 const runtime={...f.runtime},game=new GameSession(f.field,f.catalog,71,runtime),flow=new GameFlow(game);
 game.field.eventState.write({category:'ScenarioVariable',index:8},1);flow.start();flow.advance(0,ready);assert(game.field.startEvent('fight'));flow.advance(10,ready);assert(game.prepareBattleStart()!.commit());
 return {...f,runtime,game,flow,battle:game.battle!};
}
function win(f:ReturnType<typeof start>){
 for(let n=0;n<10000&&f.battle.phase==='active';n++){
  for(const actor of f.battle.ready){const target=f.battle.targets(actor.id,10)[0];if(target)f.battle.command(actor.id,10,target.id);}
  f.flow.advance(10,ready);
 }
 assert.equal(f.battle.phase,'victory');
}
const switchTo=(partyId:number):BattleEventOp=>({kind:'change-enemy-party',partyId,hidden:false});
test('actual Session uses final current descriptor rewards, one return and Storage, while entry facts stay fixed',async()=>{
 for(const values of [[2,5,7],[0,0,9],[7,7,7],[9,5,0]]){
  const input=fixture([],values),lifecycle=input.catalog.encounters[1000]!.lifecycle!;if(lifecycle.mode!=='script')throw Error('Missing fixture program');lifecycle.program=participantLoop([switchTo(501),{kind:'wait',seconds:.02},switchTo(502)]);
  const f=start(input),owned=f.game.state.snapshot(),old=f.battle;
  win(f);assert.deepEqual(old.partyContextExecution,{rootPartyId:1000,partyId:502,generation:2});assert.equal(old.reward!.magicPoints,values[2]);
  assert.equal(f.game.state.battleRewardPolicy((f.game as unknown as {battleLease:never}).battleLease).magicPoints,values[0]);
  const lease=(f.game as unknown as {battleLease:import('../src/core/game-state.js').BattleLease}).battleLease;
  if(values[0]!==values[2])assert.throws(()=>f.game.state.prepareVictory(lease,{...old.previewVictory()!,magicPoints:values[0]!}),/magic points disagree/);
  const cancelled=f.game.prepareBattleReturn()!;cancelled.discard();assert.deepEqual(f.game.state.snapshot(),owned);
  const prepare=f.game.field.prepareEncounterReturn.bind(f.game.field);let fail=true;
  f.game.field.prepareEncounterReturn=(...args)=>{const candidate=prepare(...args);return Object.assign(()=>candidate(),{validate(){candidate.validate();if(fail)throw Error('controlled late field return');},commitWith:candidate.commitWith});};
  assert.throws(()=>f.game.prepareBattleReturn()!.commit(),/controlled late field return/);assert.deepEqual(f.game.state.snapshot(),owned);assert.equal(f.game.battle,old);
  fail=false;const returned=f.game.prepareBattleReturn()!;assert(returned.commit());assert.equal(returned.commit(),false);assert.equal(f.game.state.snapshot().completedBattles.length,1);
  for(const member of f.game.state.snapshot().roster)assert.equal(member.magicLearningValue,owned.roster.find(m=>m.id===member.id)!.magicLearningValue+values[2]!);
  assert.throws(()=>old.advance(10),/Retired/);f.game.advance(2000);assert(f.game.checkpointReady);
  const data=new Map<string,string>(),storage=new CheckpointStorage({getItem:k=>data.get(k)??null,setItem:(k,v)=>{data.set(k,v);}});await storage.save(f.game.checkpoint(),1);const loaded=(await storage.load())!;
  const restored=GameSession.restore(loaded.checkpoint,f.field,f.catalog,undefined,f.runtime);assert.deepEqual(restored.checkpoint(),loaded.checkpoint);
  assert(!JSON.stringify(loaded.checkpoint).includes('source-battle-party-context-v1'),'current descriptor is battle temporary state, not saved authority');
  assert(restored.field.startEvent('fight'));restored.advance(10);assert(restored.prepareBattleStart()!.commit());assert.deepEqual(restored.battle!.partyContextExecution,{rootPartyId:1000,partyId:1000,generation:0});
 }
});
test('late same-frame shared owner failure restores descriptor generation, instance identities, AI and RNG before retry',()=>{
 const input=fixture([switchTo(501),{kind:'force-return'},{kind:'wait',seconds:.1},{kind:'global-fade',direction:'out',seconds:0,color:{r:0,g:0,b:0,a:1}},{kind:'exit'}]);input.field.entry.fade=structuredClone(DEVELOPMENT_TRANSPARENT_FADE);
 const runtime={...input.runtime,battleGlobalFade:WEB_BATTLE_GLOBAL_FADE},game=new GameSession(input.field,input.catalog,71,runtime),flow=new GameFlow(game);flow.start();assert(game.field.startEvent('fight'));flow.advance(10,ready);assert(game.prepareBattleStart()!.commit());const battle=game.battle!;
 const owner=game.field.fader,prepare=owner.prepareFrame.bind(owner);let fail=true;
 owner.prepareFrame=()=>{const f=prepare(),p=f.prepareCommit.bind(f);f.prepareCommit=()=>{const c=p();return {...c,validate(){c.validate();if(fail&&battle.partyContextExecution!.partyId===501)throw Error('controlled late descriptor host');}};};return f;};
 const before={context:battle.partyContextExecution,units:structuredClone(battle.combatants),party:battle.participantExecution,owned:game.state.snapshot(),event:battle.eventExecution,fade:owner.snapshot()};
 for(let i=0;i<2;i++){assert.throws(()=>flow.advance(10,ready),/controlled late descriptor host/);assert.deepEqual(battle.partyContextExecution,before.context);assert.deepEqual(battle.combatants,before.units);assert.deepEqual(battle.participantExecution,before.party);assert.deepEqual(game.state.snapshot(),before.owned);assert.deepEqual(battle.eventExecution,before.event);assert.deepEqual(owner.snapshot(),before.fade);}
 fail=false;battle.advance(0);assert.deepEqual(battle.partyContextExecution,{rootPartyId:1000,partyId:501,generation:1});for(let i=0;i<10&&battle.phase==='active';i++)flow.advance(10,ready);assert.equal(battle.phase,'forced');assert(game.prepareBattleReturn()!.commit());assert.equal(game.state.snapshot().completedBattles.length,1);
 const cleanInput=fixture([switchTo(501),{kind:'force-return'},{kind:'wait',seconds:.1},{kind:'global-fade',direction:'out',seconds:0,color:{r:0,g:0,b:0,a:1}},{kind:'exit'}]);cleanInput.field.entry.fade=structuredClone(DEVELOPMENT_TRANSPARENT_FADE);const clean=new GameSession(cleanInput.field,cleanInput.catalog,71,{...cleanInput.runtime,battleGlobalFade:WEB_BATTLE_GLOBAL_FADE});clean.advance(0);assert(clean.field.startEvent('fight'));clean.advance(10);assert(clean.prepareBattleStart()!.commit());for(let i=0;i<10&&clean.battle!.phase==='active';i++)clean.advance(10);assert.deepEqual(battle.combatants,clean.battle!.combatants);assert.deepEqual(battle.participantExecution,clean.battle!.participantExecution);
});
test('entry unsupported result flags keep an explicit gate despite zero rewards; child metadata cannot replace entry applicability',()=>{
 for(const flag of [3,9,10,11,12,13]){
  const f=fixture([{kind:'force-return'},{kind:'exit'}],[0,0,0]),root=f.catalog.encounters[1000]!.partyContext!.entries[1000]!;root.battleFlagGroupId=80;root.flagRows=[{flagId:flag,source:{...root.source,assetPath:'Assets/Master/battle_flag_group.csv',rowId:'1'}}];
  assert.throws(()=>start(f),new RegExp('reward flag '+flag));
 }
 const f=fixture([switchTo(501),{kind:'force-return'},{kind:'exit'}],[0,0,0]),e=f.catalog.encounters[1000]!,child=e.childPartyAdmission!.entries[501]!;
 child.flagRows.push({flagId:3,source:{...child.flagRows[0]!.source,rowId:'83'}});child.gates.push({code:'enemy-party-flags',reason:'unclosed child applicability',dependency:{table:'battle_flag_group.csv',id:77,field:null}});e.partyContext!.entries[501]!.flagRows=structuredClone(child.flagRows);delete e.participants!.enemyParties![501];
 assert.throws(()=>start(f),/Missing admitted replacement enemy party/);
});
test('Force4 and Save6 keep their existing resource domains under current descriptor changes',()=>{
 for(const save of [false,true]){
  const f=fixture([switchTo(501),{kind:'force-save-return' as const},{kind:'wait',seconds:.1},{kind:'exit'}]);if(!save)f.catalog.encounters[1000]!.lifecycle!.mode==='script'&&(f.catalog.encounters[1000]!.lifecycle!.program.instructions[1]!.op={kind:'force-return'});
  if(save)f.catalog.encounters[1000]!.forcedSavePolicy={kind:WEB_BATTLE_FORCED_SAVE};const live=start(f),before=live.game.state.snapshot();for(let i=0;i<10&&live.battle.phase==='active';i++)live.flow.advance(10,ready);assert.equal(live.battle.previewForcedReturn()!.resultType,save?6:4);assert(live.game.prepareBattleReturn()!.commit());
  const after=live.game.state.snapshot();for(const key of ['gil','items','equipmentStock'] as const)assert.deepEqual(after[key],before[key]);for(const m of after.roster)assert.equal(m.magicLearningValue,before.roster.find(p=>p.id===m.id)!.magicLearningValue);
 }
});

test('prepared retry cancellation preserves the old binding; publication retires old Battle progression authority',()=>{
 const input=fixture([],[0,5,7]),e=input.catalog.encounters[1000]!;if(e.lifecycle!.mode!=='script')throw Error('Missing fixture');e.lifecycle!.program=participantLoop([]);
 input.catalog.common.abilities[13]!.power=9999;input.catalog.common.initialAtb={player:[0,0],enemy:[100,100]};for(const enemy of e.enemies){enemy.hp=9999;e.participants!.enemyDefinitions[enemy.sourceId]!.hp=9999;}
 const f=start(input),old=f.battle;for(let n=0;n<20000&&old.phase==='active';n++)f.flow.advance(10,ready);assert.equal(old.phase,'defeat');
 const lease=(f.game as unknown as {battleLease:import('../src/core/game-state.js').BattleLease}).battleLease,project=f.game.state.battleProgression(lease,f.catalog.common.experience,()=>old)!;
 assert.doesNotThrow(()=>project(old.players[0]!,0,[],0));const cancelled=f.game.prepareBattleRetry()!;cancelled.discard();assert.equal(f.game.battle,old);assert.doesNotThrow(()=>project(old.players[0]!,0,[],0));
 assert(f.game.prepareBattleRetry()!.commit());assert.notEqual(f.game.battle,old);assert.deepEqual(f.game.battle!.partyContextExecution,{rootPartyId:1000,partyId:1000,generation:0});assert.throws(()=>project(old.players[0]!,0,[],0),/stale actual battle party context/);assert.throws(()=>old.advance(10),/Retired/);
});
test('a zero-to-positive current descriptor validates the actual owned progression provider before any child factory publication',async()=>{
 const input=fixture([switchTo(501),{kind:'force-return'},{kind:'exit'}],[0,5,0]),{BattleGame}=await import('../src/core/battle.js'),{encounterContent}=await import('../src/core/battle-content.js'),content=encounterContent(input.catalog,1000,71)!;
 const b=new BattleGame(content,71,undefined,undefined,undefined,undefined,undefined,undefined,{childPartyAdmission:input.runtime.battleChildPartyAdmission,controls:input.runtime.battleEventControls}),before={units:structuredClone(b.combatants),context:b.partyContextExecution};
 assert.throws(()=>b.advance(10),/owned progression provider before child preparation/);assert.deepEqual(b.combatants,before.units);assert.deepEqual(b.partyContextExecution,before.context);
});
