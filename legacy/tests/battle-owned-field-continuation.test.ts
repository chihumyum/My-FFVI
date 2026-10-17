import { hash } from '../src/compiler/content.js';
import { compileBattleEvent } from '../src/compiler/battle-event.js';
import { createBattleSourceFormatImportResolver } from '../src/compiler/battle-source-format-import.js';
import { SOURCE_FORMAT_FLAG_IMPORT } from '../src/compiler/source-system-flags.js';
import { WEB_BATTLE_BRANCH_EXECUTION } from '../src/core/battle-branch-execution.js';
import { WEB_BATTLE_EVENT_CONDITIONS } from '../src/core/battle-event-condition.js';
import { authoredMessageSource } from './fixtures/battle-event-message.js';
import { WEB_BATTLE_GLOBAL_FADE } from '../src/core/battle-global-fade.js';
import { DEVELOPMENT_TRANSPARENT_FADE } from '../src/core/field-fade.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { GameSession } from '../src/core/game-session.js';
import { GameFlow } from '../src/core/game-flow.js';
import { BattleGame } from '../src/core/battle.js';
import { WEB_BATTLE_EVENT_CONTROLS } from '../src/core/battle-controls.js';
import { CheckpointStorage } from '../src/core/saved-game.js';
import { compileRageLearningRows, compileSourceRageLearning } from '../src/compiler/battle-rage-learning.js';
import { compileReservedScriptBindings } from '../src/compiler/field-reserved-script.js';
import { reservationFingerprint, type BattleFieldReservationHost } from '../src/core/field-reserved-script.js';
import type { FieldContent, Op } from '../src/field/types.js';
import { battleMessageContent, battleMessageProgram, battleMessageSessionFixture, messageRaw } from './fixtures/battle-event-message.js';
import { emptyPartyState } from '../src/core/party.js';
import type { BattleGauEntry } from '../src/core/battle-gau.js';
import type { BattleEventOp, BattleEventProgram } from '../src/core/battle-event.js';
import { EventState } from '../src/core/event-state.js';
import { battleEventSharedSnapshot } from '../src/core/battle-event-shared.js';
function gauEntry():BattleGauEntry { const party=emptyPartyState();party.slots[0][0].id='a';party.slots[0][1].id='b';return {kind:'source-battle-gau-entry-v1',catalogHash:'1'.repeat(64),party,roster:[{id:'a',sourceId:1000,ownedId:1,enabled:true},{id:'b',sourceId:1001,ownedId:2,enabled:true}],field:{mapId:123,transportationId:1,isSavePoint:null,beastFieldController:true,footAttributeType:31},fixedPreemptiveState:null}; }
function gauProgram(ops:BattleEventOp[]):BattleEventProgram{return {kind:'battle-event-v1',source:null,entry:0,end:ops.length,localNames:['AI'],initialLocals:[0],blockers:[],instructions:ops.map(op=>({mnemonic:op.kind,op}))};}
const ready = {visible:true,mediaReady:true,overlayOpen:false};
const first = 'sc_e_0239', shadow = 'sc_secede_shadow';
const syscall = (name:string) => { const m=messageRaw('SysCall');m.operands.sValues[0]=name;return m; };
const ref = (index:number) => ({category:'ScenarioVariable' as const,index});
function bind(field:FieldContent,name=first,index=10) {
  const source={file:'authored-reservation.bundle',assetPath:'authored/'+name,objectId:'9007199254740993',serializedFile:'authored',sha256:'d'.repeat(64)},
    site=(pc:number)=>({script:name,index:pc,source:{...source,pointer:'/Mnemonics/'+pc}});
  field.scripts[name]=[{...site(0),kind:'calc',left:ref(index),operator:'＋',right:{kind:'immediate',value:1}},
    {...site(1),kind:'exit'}] as Op[];
  field.scriptLocals={...field.scriptLocals,[name]:{labels:['original-local'],values:[7]}};
  field.scriptTransitionMetadata={...field.scriptTransitionMetadata,[name]:{customAnimations:'none'}};
  field.scriptSystemFlags={...field.scriptSystemFlags,[name]:{keepBadStatusVisual:false}};
  field.reservedScriptBindings={...field.reservedScriptBindings,[name]:{kind:'source-reserved-field-script-v1',name,
    source,rawHash:'c'.repeat(64),sourceSetHash:field.sourceSetHash,parentSourceSetHash:field.parentSourceSetHash}};
}
function setup(raw=[messageRaw('Blank'),syscall('ガウ初回予約'),messageRaw('BattleForceExit'),messageRaw('Wait',.1),messageRaw('Exit')]) {
  const f=battleMessageSessionFixture(battleMessageProgram(raw));
  f.field.parentSourceSetHash='a'.repeat(64);bind(f.field);bind(f.field,shadow,11);
  const runtime={...f.runtime,battleEventControls:WEB_BATTLE_EVENT_CONTROLS},game=new GameSession(f.field,f.battle,19,runtime),flow=new GameFlow(game);
  for(const index of [8,10,11])game.field.eventState.write(ref(index),0);
  flow.start();flow.advance(0,ready);assert(game.field.startEvent('fight'));flow.advance(10,ready);
  assert(game.prepareBattleStart()!.commit());return {...f,catalog:f.battle,runtime,game,flow,battle:game.battle!};
}
function host():BattleFieldReservationHost{return {entry:null,require:role=>({kind:'source-field-reservation-v1',
  script:role==='gau-first-join'?first:shadow,parentSourceSetHash:'a'.repeat(64)})};}
test('reservation requires the current source alias, local/flag declarations and preserves all bad operand forms',()=>{
  const f=setup();assert.match(reservationFingerprint(f.field,first),/9007199254740993/);
  const changed=structuredClone(f.field);changed.reservedScriptBindings![first]!.source.objectId='99';assert.throws(()=>reservationFingerprint(changed,first),/identity/);
  delete changed.reservedScriptBindings;assert.throws(()=>reservationFingerprint(changed,first),/current package binding/);
  const raw=syscall('ガウ初回予約');assert.deepEqual(battleMessageProgram([raw,messageRaw('Exit')]).instructions[0]!.op,{kind:'reserve-gau-first'});
  for(const key of ['iValues','rValues','sValues'] as const){const bad=structuredClone(raw);(bad.operands[key]as(string|number)[])[7]=key==='sValues'?'bad':1;assert.equal(battleMessageProgram([bad,messageRaw('Exit')]).instructions[0]!.op.kind,'blocked');}
});
test('same leased battle stages ScenarioVariable8 and one queue; cancelled return does not publish either, real continuation runs first',()=>{
  const f=setup(),before=f.game.state.snapshot();f.flow.advance(10,ready);assert.equal(f.battle.phase,'forced');
  assert.equal(f.game.field.eventState.read(ref(8)),0);assert.equal(f.game.reservedFieldScript,null);
  assert.equal(f.battle.eventSharedReturn!.candidate.global[8],1);assert.equal(f.battle.fieldReservationReturn!.candidate!.script,first);
  f.game.prepareBattleReturn()!.discard();assert.deepEqual(f.game.state.snapshot(),before);assert.equal(f.game.reservedFieldScript,null);
  assert(f.game.prepareBattleReturn()!.commit());assert.equal(f.game.field.eventState.read(ref(8)),1);assert.equal(f.game.reservedFieldScript!.script,first);
  assert.equal(f.game.field.eventState.read(ref(10)),0);f.game.advance(10);assert.equal(f.game.field.eventState.read(ref(10)),0);
  assert.equal(f.game.field.eventState.read({category:'ScenarioFlag1',index:1}),1);assert(f.game.checkpointReady);assert.equal(f.game.field.startEvent('fight'),false);
  assert.equal(f.game.field.directionInput('right').kind,'rejected');
  f.game.advance(10);assert.equal(f.game.reservedFieldScript,null);assert.equal(f.game.field.eventState.read(ref(10)),1);
  f.game.advance(30);assert.equal(f.game.field.eventState.read(ref(10)),1);assert.equal(f.game.state.snapshot().completedBattles.length,1);
});
test('stable pending reservation round-trips through actual Storage; old shapes and saves cannot grant a missing provider',async()=>{
  const f=setup();f.flow.advance(10,ready);assert(f.game.prepareBattleReturn()!.commit());f.game.advance(10);
  const saved=f.game.checkpoint();assert.equal(saved.formatVersion,7);
  let bytes:string|null=null;const storage=new CheckpointStorage({getItem:()=>bytes,setItem:(_k,v)=>{bytes=v;}});
  await storage.save(saved,11);const loaded=(await storage.load())!;
  const restored=GameSession.restore(loaded.checkpoint,f.field,f.catalog,undefined,f.runtime);assert.equal(restored.reservedFieldScript!.script,first);
  restored.advance(10);assert.equal(restored.field.eventState.read(ref(10)),1);assert.equal(restored.reservedFieldScript,null);
  const missing=structuredClone(f.field);delete missing.reservedScriptBindings;assert.throws(()=>GameSession.restore(saved,missing,f.catalog,undefined,f.runtime),/package binding/);
  const malformed=structuredClone(saved);Reflect.set(malformed,'formatVersion',5);assert.throws(()=>GameSession.restore(malformed,f.field,f.catalog,undefined,f.runtime));
  const invalid=structuredClone(saved);if(invalid.formatVersion===7)invalid.fieldReservation.script='unbound';assert.throws(()=>GameSession.restore(invalid,f.field,f.catalog,undefined,f.runtime));
});
test('source-binding changes after return preparation reject before owned publication and leave candidate retryable',()=>{
  const f=setup();f.flow.advance(10,ready);const before=f.game.state.snapshot(),pending=f.game.prepareBattleReturn()!;
  const original=f.field.reservedScriptBindings![first]!.rawHash;f.field.reservedScriptBindings![first]!.rawHash='d'.repeat(64);
  assert.throws(()=>pending.commit(),/Stale/);assert.deepEqual(f.game.state.snapshot(),before);assert.equal(f.game.reservedFieldScript,null);assert(f.game.battle);
  f.field.reservedScriptBindings![first]!.rawHash=original;assert(f.game.prepareBattleReturn()!.commit());
});
test('failed source resolution rolls reservation, shared banks, actual unit identities and clock back together',()=>{
  const f=setup(),battle=f.battle,units=[...battle.combatants],before=battle.eventSharedReturn,clock=battle.time;
  delete f.field.reservedScriptBindings![first];assert.throws(()=>battle.advance(10),/package binding/);
  assert.equal(battle.time,clock);assert.deepEqual(battle.eventSharedReturn,before);assert.equal(battle.fieldReservationReturn!.candidate,null);
  assert(battle.combatants.every((unit,i)=>unit===units[i]));assert.equal(f.game.field.eventState.read(ref(8)),0);
});
test('leap checks every actual player condition614; an absent qualifier has no side effects, a matching owner remains a precise gate',()=>{
  const p=gauProgram([{kind:'blank'},{kind:'gau-leap'},{kind:'wait',seconds:1},{kind:'exit'}]),c=battleMessageContent(p),b=new BattleGame(c,1),before=b.players.map(p=>p.id);
  b.advance(10);assert.deepEqual(b.players.map(p=>p.id),before);assert.equal(b.eventExecution.state!.pc,2);
  const gated=structuredClone(c);gated.conditions.rules.definitions.push({id:987,type:614,eraseGroupId:gated.conditions.rules.definitions[0]!.eraseGroupId,overlapped:false});
  const g=new BattleGame(gated,1);g.players[1]!.conditionIds.push(987);const prior=structuredClone(g.combatants);assert.throws(()=>g.advance(10),/Unimplemented active battle condition/);assert.deepEqual(g.combatants,prior);
});
test('Shadow absence still replaces the one reservation; actual held Shadow stays gated and no battle unit is removed',()=>{
  const p=gauProgram([{kind:'blank'},{kind:'shadow-battle-departure'},{kind:'wait',seconds:1},{kind:'exit'}]),c=battleMessageContent(p);c.contentHash='1'.repeat(64);
  const entry=gauEntry(),b=new BattleGame(c,1,undefined,undefined,undefined,undefined,undefined,undefined,{gau:entry,fieldContinuation:host()});b.advance(10);
  assert.equal(b.fieldReservationReturn!.candidate!.script,shadow);assert.equal(b.players.length,2);
  const held=structuredClone(c),source=structuredClone(entry);held.players[0]!.sourceId=4;source.roster[0]!.sourceId=4;
  const g=new BattleGame(held,1,undefined,undefined,undefined,undefined,undefined,undefined,{gau:source,fieldContinuation:host()}),before=structuredClone(g.combatants);
  assert.throws(()=>g.advance(10),/SecedeCharacter/);assert.deepEqual(g.combatants,before);assert.equal(g.fieldReservationReturn!.candidate,null);
});

test('compiler binds only the actual current package aliases and validates original script identity',()=>{
  const source={file:'authored.bundle',sha256:'a'.repeat(64),serializedFile:'authored',assetPath:'authored/'+first,objectId:'9007199254740993'},
    asset={id:'physical',kind:'script' as const,source,data:{Name:first,Mnemonics:[],Animations:[]}},assets=new Map([[asset.id,asset]]);
  assert.deepEqual(compileReservedScriptBindings({},assets,'b'.repeat(64),'c'.repeat(64)),{});
  const bound=compileReservedScriptBindings({[first]:'physical'},assets,'b'.repeat(64),'c'.repeat(64));assert.equal(bound[first]!.source.objectId,source.objectId);
  asset.data.Name='unrelated';assert.throws(()=>compileReservedScriptBindings({[first]:'physical'},assets,'b'.repeat(64),'c'.repeat(64)),/alias\/source/);
});
test('Rage data compiler does not grant abilities and rejects incomplete/duplicate source master closure or fabricated native proof',()=>{
  const rows=[{id:'91',name:'Authored rage A'},{id:'92',name:'Authored rage B'}],compiled=compileRageLearningRows([[7,91],[9,92]],rows);
  assert.equal(compiled.grantsOwnedAbilities,false);assert.deepEqual(compiled.entries.map(e=>e.monsterId),[7,9]);
  assert.throws(()=>compileRageLearningRows([[7,91],[7,92]],rows),/Duplicate/);
  assert.throws(()=>compileRageLearningRows([[7,93]],rows),/Missing\/ambiguous/);
  assert.throws(()=>compileSourceRageLearning({kind:'source-native-rage-map-v1',pairs:[[7,91]]},rows,'a'.repeat(64)));
});


test('imported source flags, condition clocks, shared Fade and reserved continuation roll back and restore together',async()=>{
  const fade=messageRaw('FadeOut',-.7);fade.operands.iValues[3]=255;
  const condition=messageRaw('BattleCondition');condition.operands.iValues=[1,1000,302,1,0,0,0,0];
  const ops=[fade,condition,syscall('ガウ初回予約'),messageRaw('BattleForceExit'),messageRaw('Exit')],
    data={Name:'authored combined import',Title:{main:'',sub:''},Mnemonics:ops,
      Segments:[{Label:'Main',EntryPoint:0,Count:ops.length}],ScriptLocal:['BattleAIFlag'],ScriptLocalValue:[0],
      SystemFlag:{SkipInitialize:0},Animations:[]},
    source=authoredMessageSource,physical={file:source.file,assetPath:source.assetPath,objectId:source.objectId,
      serializedFile:source.serializedFile,sha256:source.sha256},
    sources=[{file:'GameAssembly.dll',sha256:SOURCE_FORMAT_FLAG_IMPORT.nativeSha256},{file:source.file,sha256:source.sha256}],
    resolve=createBattleSourceFormatImportResolver({sourceSetHash:hash(sources),manifest:{parentSourceSetHash:source.sourceSetHash,sources},
      assets:[{kind:'script',source:physical,data}]}),
    program=compileBattleEvent(data,source,undefined,undefined,WEB_BATTLE_BRANCH_EXECUTION,resolve({source,data})),
    f=battleMessageSessionFixture(program);
  assert.deepEqual(program.branchExecution!.sourceProgram,data);
  assert.equal(Object.hasOwn(program.branchExecution!.sourceProgram.SystemFlag,'RidingVehicle'),false);
  f.battle.encounters[1000]!.lifecycle={kind:'battle-lifecycle-v2',mode:'script',scriptId:1,program,branchExecution:WEB_BATTLE_BRANCH_EXECUTION};
  f.battle.common.conditions.rules.definitions.push({id:302,type:10,overlapped:false,eraseGroupId:600});
  f.battle.common.conditions.rules.eraseRules.push({id:600,groupId:600,conditionId:0,type:1,eraseConditionId:0});
  f.battle.common.conditions.behaviors.push({id:302,kind:'poison',name:'Authored poison',untilType:3,hpDivisor:4});
  f.battle.common.battleEvents!.conditions.push({id:302,type:10,attackTarget:0,gameOverTarget:0});
  f.field.parentSourceSetHash='a'.repeat(64);f.field.entry.fade=structuredClone(DEVELOPMENT_TRANSPARENT_FADE);bind(f.field);
  const runtime={...f.runtime,battleBranchExecution:WEB_BATTLE_BRANCH_EXECUTION,battleEventConditions:WEB_BATTLE_EVENT_CONDITIONS,battleEventControls:WEB_BATTLE_EVENT_CONTROLS,battleGlobalFade:WEB_BATTLE_GLOBAL_FADE},
    game=new GameSession(f.field,f.battle,19,runtime),flow=new GameFlow(game);
  for(const index of [8,10])game.field.eventState.write(ref(index),0);
  flow.start();flow.advance(0,ready);assert(game.field.startEvent('fight'));flow.advance(10,ready);assert(game.prepareBattleStart()!.commit());
  const battle=game.battle!,owner=game.field.fader,pose=owner.snapshot(),revision=owner.mutationRevision,
    time=battle.time,units=[...battle.combatants],owned=game.state.snapshot(),binding=f.field.reservedScriptBindings![first]!;
  delete f.field.reservedScriptBindings![first];
  assert.throws(()=>game.advance(10),/package binding/);
  assert.equal(battle.time,time);assert.deepEqual(owner.snapshot(),pose);assert.equal(owner.mutationRevision,revision);
  assert.equal(battle.fadeExecution.length,0);assert.equal(battle.fieldReservationReturn!.candidate,null);
  assert.equal(battle.conditionExecution.length,0);assert.deepEqual(battle.players[0]!.conditionIds,[]);assert.deepEqual(battle.conditionClockState(battle.players[0]!.id),[]);
  assert.equal(game.field.eventState.read(ref(8)),0);assert.deepEqual(game.state.snapshot(),owned);
  assert(battle.combatants.every((unit,i)=>unit===units[i]));
  f.field.reservedScriptBindings![first]=binding;game.advance(0);
  // Session consumed its failed host tick; zero Session time cannot clock a
  // pending inner Battle frame. The next real host tick retries that frame.
  assert.equal(battle.phase,'active');assert.equal(battle.time,time);assert.deepEqual(owner.snapshot(),pose);
  game.advance(10);
  assert.equal(battle.phase,'forced');assert(owner.active);assert.equal(battle.fadeExecution.filter(e=>e.action==='start').length,1);
  assert.equal(battle.conditionExecution.length,1);assert.deepEqual(battle.players[0]!.conditionIds,[302]);assert.equal(battle.conditionClockState(battle.players[0]!.id).length,1);
  assert.equal(battle.fieldReservationReturn!.candidate!.script,first);assert.equal(game.reservedFieldScript,null);
  const committedFade=owner.snapshot();game.prepareBattleReturn()!.discard();
  assert.deepEqual(owner.snapshot(),committedFade);assert.deepEqual(game.state.snapshot(),owned);assert.equal(game.reservedFieldScript,null);
  assert(game.prepareBattleReturn()!.commit());assert.equal(game.field.fader,owner);assert.equal(game.field.eventState.read(ref(8)),1);
  assert.throws(()=>battle.advance(10),/Retired/);
  for(let i=0;i<200&&!game.checkpointReady;i++)game.advance(10);
  assert(game.checkpointReady);assert.equal(game.reservedFieldScript,null);assert.equal(game.field.eventState.read(ref(10)),1);
  assert.equal(owner.active,false);assert.equal(owner.projection!.rendererColor.a,1);assert.equal(game.state.snapshot().completedBattles.length,1);
  const bytes=new Map<string,string>(),storage=new CheckpointStorage({getItem:k=>bytes.get(k)??null,setItem:(k,v)=>{bytes.set(k,v);}});
  await storage.save(game.checkpoint(),1);const loaded=(await storage.load())!;assert(!JSON.stringify(loaded.checkpoint).includes('sourceFormatImport'));const restored=GameSession.restore(loaded.checkpoint,f.field,f.battle,undefined,runtime);
  assert.deepEqual(restored.checkpoint(),loaded.checkpoint);restored.advance(100);
  assert.equal(restored.field.eventState.read(ref(10)),1);assert.equal(restored.reservedFieldScript,null);
  assert.equal(restored.state.snapshot().completedBattles.length,1);
});
