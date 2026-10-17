/** Joint Session regression for AI continuation, current enemy descriptors and
 * source handoff ownership. All game records below are authored fixtures;
 * this is shared-owner acceptance, not original-story/root qualification. */
import {WEB_BATTLE_PARTY_CONTEXT,parseBattlePartyContext} from '../src/core/battle-party-context.js';
import {WEB_BATTLE_CHILD_ADMISSION} from '../src/core/battle-child-admission.js';
import {enemyBattleDefinition,type BattleParticipantSlot} from '../src/core/battle-participants.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import type {BattleGame} from '../src/core/battle.js';
import type {BattleEventOp} from '../src/core/battle-event.js';
import {WEB_BATTLE_EVENT_EFFECTS,createWebBattleEventEffectHost} from '../src/core/battle-event-effect.js';
import {CheckpointStorage} from '../src/core/saved-game.js';
import {emptyPartyState} from '../src/core/party.js';
import {GameFlow} from '../src/core/game-flow.js';
import {GameCommands} from '../src/core/game-commands.js';
import {syntheticAI} from './fixtures/battle-ai.js';
import {authoredBattleEffect} from './fixtures/battle-event-effect.js';
import {sealBatchContent} from './fixtures/content-batch.js';
import {sourcePartySelectionSessionFixture,selectionHost} from './fixtures/source-party-selection-session.js';

function receivedAI() {
  return syntheticAI([
    ['Nop'],['SyncAI'],['VariableAssign',[0,7]],
    ['StartTable',[0]],['Act',[13]],['EndTable'],
    ['CounterAct',[13]],['FinalAttackAct',[13]],['Blank'],['Blank'],
    ['ValueCalc',[0,1],[],['＋']],['JumpBattleAI',[0]],
  ]);
}

function setup(final:boolean, ops:BattleEventOp[]|((sourceIds:number[])=>BattleEventOp[]),
  effects?:NonNullable<Parameters<typeof sourcePartySelectionSessionFixture>[0]>['battleEventEffects']) {
  const f=sourcePartySelectionSessionFixture({handoffs:true,handoffOps:ops,...(effects?{battleEventEffects:effects}:{})});
  f.battle.common.initialAtb={player:[100,100],enemy:[0,0]};
  f.battle.common.abilities[10]!.cost=2;
  f.battle.common.battleEvents={conditions:f.battle.common.conditions.rules.definitions.map(({id,type})=>
    ({id,type,attackTarget:type===5?1:0,gameOverTarget:type===5?1:0}))};
  for (const encounter of Object.values(f.battle.encounters)) {
    const enemy=encounter.enemies[0]!;
    Object.assign(enemy,{hp:final?1:5000,mp:10,agility:0,weight:21,abilities:[13],ai:receivedAI()});
  }
  // All records here are authored fixture data, not source-row certification.
  // Attach one explicit child descriptor to each existing encounter. The held
  // parent and source0055 assertions below keep using the same real Session.
  Object.assign(f.runtime,{battleChildPartyAdmission:WEB_BATTLE_CHILD_ADMISSION});
  for(const [key,encounter]of Object.entries(f.battle.encounters)){
    const rootPartyId=Number(key),childId=9901;
    const slots:Record<string,BattleParticipantSlot>=Object.fromEntries(Array.from({length:9},(_,i)=>[i+1,{x:i*15,y:0,group:1 as const}]));
    for(const [i,enemy]of encounter.enemies.entries()){
      if(enemy.placement){const {x,y,group}=enemy.placement;slots[i+1]={x,y,group};}
      enemy.placement={...slots[i+1]!};
    }
    const members=encounter.enemies.map((enemy,i)=>({sourceId:enemy.sourceId,uniqueId:i+1}));
    encounter.participants={kind:'battle-participant-content-v1',profile:'web-unique-id-slots-v1',rewardScope:'all-entered',
      enemyDefinitions:Object.fromEntries(encounter.enemies.map(enemy=>[enemy.sourceId,enemyBattleDefinition(enemy)])),slots,
      initial:encounter.enemies.map((enemy,i)=>({id:enemy.id,sourceId:enemy.sourceId,uniqueId:i+1})),
      enemyParties:{[childId]:{members:structuredClone(members),slots:structuredClone(slots)}}};
    const origin=(id:number)=>({file:'authored-context.bundle',assetPath:'Assets/Master/monster_party.csv',
      serializedFile:'authored-context',objectId:'90071992547409937',rowId:String(id)});
    encounter.childPartyAdmission={kind:'source-child-party-admission-v1',policy:WEB_BATTLE_CHILD_ADMISSION,
      rootPartyId,context:'retain-parent-entry',entries:{[childId]:{partyId:childId,source:origin(childId),flagGroupId:0,
        flagRows:[],notEscape:0,members:structuredClone(members),slots:structuredClone(slots),gates:[]}}};
    const descriptor=(id:number,value:number)=>({partyId:id,source:origin(id),battleFlagGroupId:0,flagRows:[],notEscape:0,
      backgroundId:0,bgmId:0,appearanceProduction:0,getAp:0,getValue:value,scriptId:0,patterns:[1,0,0,0,0,0]});
    const rootValue=encounter.rewardPolicy?.magicPoints??0;
    encounter.partyContext=parseBattlePartyContext({kind:'source-battle-party-context-v1',policy:WEB_BATTLE_PARTY_CONTEXT,
      rootPartyId,entries:{[rootPartyId]:descriptor(rootPartyId,rootValue),[childId]:descriptor(childId,5)}});
  }
  // Preserve the fixture's captured content objects; make()/restore() use this
  // same native initializer/factory, Session, party actors and typed ports.
  Object.assign(f.battle,sealBatchContent(f.battle));
  f.content.battleCatalogHash=f.battle.contentHash;Object.assign(f.content,sealBatchContent(f.content));
  return f;
}

type Fixture=ReturnType<typeof setup>;
type Running=ReturnType<Fixture['make']>;
function currentActionKind(b:BattleGame){return b.action?.kind;}
function currentSourceHandoffs(b:BattleGame){return b.sourceBattleHandoffReturn;}
function drain(h:Running) {
  for(let i=0;i<100&&!h.game.checkpointReady;i++)h.flow.advance(10,selectionHost);
  assert(h.game.checkpointReady,h.game.field.stop?.message);
}
function start(h:Running) {
  assert(h.game.field.startEvent('stone-battle'));h.flow.advance(10,selectionHost);
  assert(h.game.battle,h.game.encounterPreparationError??h.game.field.stop?.message);
  // Effects and condition lists defer their root until the first actual
  // connected Battle clock; do not obtain command authority before that root.
  if(!h.game.battle.ready.length)h.flow.advance(10,selectionHost);
  return h.game.battle;
}
function frame(b:BattleGame) {
  return structuredClone({units:b.combatants,action:b.action,pending:b.pendingActions,
    received:b.pendingReactionExecution,ai:b.enemies.map(enemy=>b.enemyAIState(enemy.id)),
    final:b.finalAttackExecution,players:b.playerExecution,event:b.eventExecution,
    handoffs:currentSourceHandoffs(b),context:b.partyContextExecution,effects:b.effectExecution,
    time:b.time,phase:b.phase,events:b.events,random:Reflect.get(b,'randomState')});
}
function untilParent(h:Running,b:BattleGame) {
  const actor=b.ready[0]!,enemy=b.enemies[0]!;
  assert(actor);assert(h.commands.command(b,actor.id,10,enemy.id,100));
  for(let i=0;i<60&&!b.pendingReactionExecution;i++)h.flow.advance(10,selectionHost);
  assert(b.pendingReactionExecution,'The actual Session command must reach a received Blank parent');
  assert.equal(b.action!.resolved,false);assert.equal(currentSourceHandoffs(b),undefined);
  return {actor,enemy,parent:b.action!,beforeMp:actor.mp,beforeHp:enemy.hp};
}
async function store(f:Fixture,h:Running) {
  drain(h);const checkpoint=h.game.checkpoint(),values=new Map<string,string>(),
    storage=new CheckpointStorage({getItem:key=>values.get(key)??null,setItem:(key,value)=>{values.set(key,value);}});
  (await storage.prepareSave(checkpoint,1234)).commit();
  const restored=f.restore((await storage.load())!.checkpoint);
  assert.deepEqual(restored.checkpoint(),checkpoint);return restored;
}

test('actual Session commits one received parent and0055 before child entry; later failure preserves them through retry/Storage',async()=>{
  for (const final of [false,true]) {
    const base=createWebBattleEventEffectHost();let fail=true,commits=0;
    const f=setup(final,ids=>[
      {kind:'exec-ai'},{kind:'wait',seconds:.41},{kind:'capture-source-0055'},{kind:'change-enemy-party',partyId:9901,hidden:false},authoredBattleEffect(1,ids[0]!),
      {kind:'force-return'},
    ],{policy:WEB_BATTLE_EVENT_EFFECTS,prepare(request){const resource=base.prepare(request);return {...resource,
      commit(){commits++;if(fail)throw Error('Controlled joint capture resource failure');resource.commit();}};}}),
      h=f.make(),owned=h.game.state.snapshot(),b=start(h),held=untilParent(h,b);
    assert.equal(b.pendingReactionExecution!.actor,held.actor.id);
    assert.equal(b.pendingReactionExecution!.receivers[0]!.finalReady,final);
    assert.equal(held.enemy.hp,held.beforeHp);assert.equal(held.actor.mp,held.beforeMp);
    assert.throws(()=>h.game.checkpoint(),/checkpoint|battle|stable|save/i);
    // The existing event clock is fenced while the actual received parent is
    // private. A due capture cannot read that tentative calculation early.
    h.flow.advance(10,selectionHost);assert(b.pendingReactionExecution);
    assert.equal(currentSourceHandoffs(b),undefined);
    // ChangeEnemyParty is a real waiting instruction. Its request follows the
    // completed parent/capture; the effect is reached by the next event frame.
    h.flow.advance(10,selectionHost);
    assert.equal(b.pendingReactionExecution,null);
    assert.equal(held.actor.mp,held.beforeMp-2);
    assert(currentSourceHandoffs(b)?.takeOver0055);
    const before=frame(b),owners=[...b.combatants],committedCapture=structuredClone(currentSourceHandoffs(b));
    assert.throws(()=>h.flow.advance(10,selectionHost),/Controlled joint capture resource failure/);
    assert.deepEqual(frame(b),before);assert.deepEqual(h.game.state.snapshot(),owned);
    assert.deepEqual(currentSourceHandoffs(b),committedCapture);
    assert(b.combatants.every((unit,index)=>unit===owners[index]));assert.equal(commits,1);
    fail=false;
    // Session already forwarded this 10ms. Retry the same actual Battle clock,
    // without feeding a second elapsed interval or constructing another game.
    b.advance(0);assert.equal(b.pendingReactionExecution,null);assert.equal(b.phase,'forced');
    assert.equal(held.actor.mp,held.beforeMp-2);assert.equal(held.enemy.behavior!.variables[0],8);
    const captured=currentSourceHandoffs(b)!.takeOver0055!;
    assert.equal(captured.capture.pc,2);assert.equal(captured.characters.length,2);
    assert.equal(captured.characters.find(record=>record.id===held.actor.id)!.mp,held.beforeMp-2,
      'capture observes the successful command clock, not the initial or unpublished parent resources');
    assert.equal(b.partyContextExecution!.partyId,9901);assert.equal(b.partyContextExecution!.generation,1);
    assert(!b.enemies.some(enemy=>enemy===held.enemy),'the old parent target cannot become the next generation');
    assert.equal(commits,2);assert.deepEqual(h.game.state.snapshot(),owned);
    const cancelled=h.game.prepareBattleReturn()!;cancelled.discard();
    assert.equal(cancelled.commit(),false);assert.equal(h.game.battle,b);assert.deepEqual(h.game.state.snapshot(),owned);
    const prepare=h.game.field.prepareEncounterReturn.bind(h.game.field);
    h.game.field.prepareEncounterReturn=()=>{throw Error('Controlled joint Field return failure');};
    assert.throws(()=>h.game.continueForcedReturn(),/Controlled joint Field return failure/);
    assert.deepEqual(h.game.state.snapshot(),owned);assert.deepEqual(currentSourceHandoffs(b)!.takeOver0055,captured);
    h.game.field.prepareEncounterReturn=prepare;
    assert(h.game.continueForcedReturn());assert.equal(h.game.continueForcedReturn(),false);
    assert.equal(b.pendingReactionExecution,null);assert.throws(()=>b.advance(0),/Retired battle/);
    const restored=await store(f,h);assert.equal(restored.state.snapshot().completedBattles.length,1);
    assert.deepEqual(restored.state.snapshot().sourceBattleHandoffs!.takeOver0055,captured);
    const restore=restored.state.fieldSourceBattleHandoffs.prepare('restore-0055');restore.commit();
    assert.throws(restore.commit,/Stale/);assert.equal(restored.state.snapshot().roster[0]!.mp,held.beforeMp-2);
    assert.deepEqual(restored.state.snapshot().sourceBattleHandoffs!.takeOver0055,captured);
  }
});

test('actual final-menu partial entry preserves completed received damage and rolls back only this capture/retirement/cursor frame on missing borrowed media',async()=>{
  const f=setup(false,[
    {kind:'exec-ai'},{kind:'end-enabled',enabled:false},{kind:'wait',seconds:.41},
    {kind:'sync-action'},{kind:'capture-source-0055'},{kind:'source-final-player-switch'},
    {kind:'end-enabled',enabled:true},{kind:'force-return'},
  ]);
  // Kill the original player through the real received counter's ordinary HP
  // calculation/life owner. Appending Type5, patching live HP, or granting an
  // unported self-resource carrier would evade the boundary being tested.
  f.battle.common.abilities[13]!.power=9999;
  Object.assign(f.battle,sealBatchContent(f.battle));f.content.battleCatalogHash=f.battle.contentHash;
  Object.assign(f.content,sealBatchContent(f.content));const h=f.make();
  assert(h.game.field.startEvent('selection-final'));h.flow.advance(10,selectionHost);
  const initial=h.game.state.snapshot(),slots=emptyPartyState().slots;
  slots[0][0].id=initial.roster[0]!.id;slots[1][2].id=initial.roster[1]!.id;
  const selection=h.commands.sourcePartySelection()!;
  assert(h.commands.completeSourcePartySelection(selection.token,{kind:'confirm',slots}));drain(h);
  const organized=h.game.state.snapshot(),waiting=organized.sourceBattleHandoffs!.finalWaiting!;
  assert.deepEqual(waiting.ownedIds,[initial.roster[1]!.ownedId]);
  const b=start(h),held=untilParent(h,b),old=held.actor,owners=[...b.combatants],
    generation=b.playerExecution!.nextGeneration,key=old.sprites.idle,media=b.content.sprites[key]!;
  h.flow.advance(10,selectionHost);assert(b.pendingReactionExecution);
  h.flow.advance(10,selectionHost);assert.equal(b.pendingReactionExecution,null);
  assert.equal(old.mp,held.beforeMp-2);assert(old.hp>0);
  for(let i=0;i<200&&old.hp>0;i++)h.flow.advance(10,selectionHost);
  assert.equal(old.hp,0);assert(old.conditionIds.includes(305));
  assert.equal(currentActionKind(b),'counter');assert.deepEqual(b.action!.targetIds,[old.id]);
  assert.equal(currentSourceHandoffs(b),undefined);
  delete b.content.sprites[key];let before=frame(b),failure:unknown;
  for(let i=0;i<200&&!failure;i++){
    before=frame(b);try{h.flow.advance(10,selectionHost);}catch(error){failure=error;}
  }
  assert.match(String(failure),/Missing borrowed player media/);
  assert.deepEqual(frame(b),before);assert(b.combatants.every((unit,index)=>unit===owners[index]));
  assert.equal(currentSourceHandoffs(b),undefined);assert.deepEqual(h.game.state.snapshot(),organized);
  assert.equal(b.playerExecution!.nextGeneration,generation);
  assert.equal(old.hp,0);assert.equal(old.mp,held.beforeMp-2,
    'a later entry failure cannot undo costs or HP outcomes from already committed action frames');
  b.content.sprites[key]=media;b.advance(0);
  assert.equal(b.pendingReactionExecution,null);assert.equal(b.action,null);
  assert.equal(b.players.length,1);const joined=b.players[0]!;
  assert.notEqual(joined,old);assert.notEqual(joined.id,old.id);
  assert.equal(b.playerOwnedId(joined.id),initial.roster[1]!.id);
  assert.equal(b.playerExecution!.nextGeneration,generation+1);
  assert.equal(b.playerExecution!.slots[0]!.instanceId,joined.id);
  assert.equal(joined.mp,initial.roster[1]!.mp,'the retired parent fee cannot debit the replacement owner');
  assert.deepEqual(currentSourceHandoffs(b)!.finalWaiting!.remaining.ownedIds,[]);
  const capture=currentSourceHandoffs(b)!.takeOver0055!;
  assert.equal(capture.capture.pc,4);assert.deepEqual(capture.characters.map(record=>record.id),[old.id]);
  assert.equal(capture.characters[0]!.hp,0);
  assert.equal(capture.characters[0]!.mp,held.beforeMp-2);
  assert.equal(b.command(old.id,10,b.enemies[0]!.id,100),false);
  // The next ordinary event clock completes this same pending entry. The
  // drained counter's actual old target cannot bind its successor.
  for(let i=0;i<10&&b.phase==='active';i++)h.flow.advance(10,selectionHost);
  assert.equal(b.phase,'forced');assert.equal(b.pendingReactionExecution,null);
  assert.deepEqual(b.finalAttackExecution,[]);
  assert.notEqual(currentActionKind(b),'final','a Final referring to the retired target must not stage on its replacement');
  assert(!b.pendingActions.some(action=>action.kind==='final'));
  assert(!b.pendingActions.some(action=>action.actor===old.id));
  assert(!b.pendingActions.some(action=>action.targetIds.includes(old.id)));
  assert.equal(joined.mp,initial.roster[1]!.mp);assert.equal(joined.hp,initial.roster[1]!.hp);
  assert.deepEqual(h.game.state.snapshot(),organized);
  assert(h.game.continueForcedReturn());assert.equal(h.game.continueForcedReturn(),false);
  const restored=await store(f,h),saved=restored.state.snapshot();
  assert.equal(saved.completedBattles.length,1);assert.deepEqual(saved.sourceBattleHandoffs!.finalWaiting!.ownedIds,[]);
  assert.deepEqual(saved.sourceBattleHandoffs!.takeOver0055,capture);assert.deepEqual(saved.party,organized.party);
  // A new real lease uses the persisted consumed queue, never the retired
  // Battle's tentative cursor, received target or numeric generation.
  const flow=new GameFlow(restored);flow.start();flow.observeHost(selectionHost);const commands=new GameCommands(flow,restored);
  assert(restored.field.startEvent('stone-battle'));flow.advance(10,selectionHost);
  assert(restored.battle,restored.encounterPreparationError??undefined);
  assert.notEqual(restored.battle,b);assert.equal(restored.battle.pendingReactionExecution,null);
  assert.deepEqual(restored.battle.finalAttackExecution,[]);assert.equal(restored.battle.playerExecution!.nextGeneration,1);
  assert.equal(commands.command(b,old.id,10,held.enemy.id,100),false,'old Battle cannot obtain a new Session command authority');
});

test('AI continuation support cannot grant a final waiting owner absent the actual final-menu producer',()=>{
  const f=setup(false,[{kind:'source-final-player-switch'},{kind:'force-return'}]),h=f.make(),before=h.game.state.snapshot();
  assert.equal(Object.hasOwn(before,'sourceBattleHandoffs'),false);
  assert(h.game.field.startEvent('stone-battle'));h.flow.advance(10,selectionHost);
  assert.equal(h.game.battle,null);assert.match(h.game.encounterPreparationError??'',/final|waiting|borrow|participant/i);
  assert.equal(h.game.field.stop?.kind,'encounter');assert.deepEqual(h.game.state.snapshot(),before);
});
