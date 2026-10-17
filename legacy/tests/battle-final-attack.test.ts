import test from 'node:test';
import assert from 'node:assert/strict';
import { BattleGame as SourceBattleGame } from '../src/core/battle.js';
import { SourceMessageState } from '../src/core/source-message.js';
import { WEB_BATTLE_EVENT_MESSAGE_POLICY } from '../src/core/battle-event-message.js';
import { WEB_BATTLE_EVENT_EFFECTS, createWebBattleEventEffectHost } from '../src/core/battle-event-effect.js';
import { WEB_BATTLE_EVENT_CONTROLS } from '../src/core/battle-controls.js';
import { createWebFieldMessageSequencePort } from '../src/core/source-message-sequence.js';
import { battleMessageContent, battleMessageProgram, messageRaw } from './fixtures/battle-event-message.js';
import { authoredBattleEffect } from './fixtures/battle-event-effect.js';
import { ControlledBattleGame as BattleGame } from './fixtures/controlled-battle.js';
import { fixture } from './fixtures/battle-content.js';
import { syntheticAI } from './fixtures/battle-ai.js';
import { compileTargetRule } from '../src/compiler/battle-targets.js';
import { BattleFinalAttackTickets, sourceFinalReady } from '../src/core/battle-final-attack.js';
import { planBattleAIReaction, startBattleAI } from '../src/core/battle-ai.js';
import { participantFixture } from './fixtures/battle-participant-game.js';
import { enemyBattleDefinition } from '../src/core/battle-participants.js';
import { evaluateBattleEventBranch } from '../src/core/battle-event-context.js';
import { initialEnemyBehavior } from '../src/core/enemy-behavior.js';

function finalAI(ids=[601],weights=[100],messages:string[]=[]){return syntheticAI([
  ['Nop'],['SyncAI'],['StartTable',[0]],['FinalAttackAct',ids,weights,messages],['Act',[13]],['EndTable'],['JumpBattleAI',[0]],
]);}
function content(self=false){
  const c=fixture(),ability=structuredClone(c.abilities[self?11:10]!);
  Object.assign(ability,{id:601,name:'Authored ordinary Final',power:self?2:1,cost:3});
  ability.program.abilityId=601;ability.program.range=self?5:3;
  ability.plan!.targeting=compileTargetRule(self?5:3,self?2:3)!;
  if(self){ability.plan!.effects=[{slot:1,kind:'recovery',resource:'hp',calculation:'fixed'}];ability.plan!.magic=null;}
  c.abilities[601]=ability;c.players.forEach(unit=>unit.hp=2000);
  c.enemies.forEach((unit,index)=>{unit.sourceId=41+index;unit.hp=10;unit.mp=10;unit.agility=0;unit.abilities=[13,601];unit.ai=finalAI();});
  c.drops={kind:'battle-drops-v1',weights:[100,0,0,0,0,0,0,0],monsters:[41,42].map(id=>({id,rate:100,
    slots:Array.from({length:8},()=>({contentId:0,count:0}))})),contents:[]};
  return c;
}
const snapshot=(b:BattleGame)=>structuredClone({units:b.combatants,action:b.action,pending:b.pendingActions,final:b.finalAttackExecution,
  ai:b.enemies.map(unit=>b.enemyAIState(unit.id)),drops:b.registeredDropMonsters,events:b.events,time:b.time,phase:b.phase,random:Reflect.get(b,'randomState')});

test('Final readiness is independent of ordinary counter exclusions and excludes miss, recursion and actual type5',()=>{
  const base={hp:0,conditionTypes:[],incomingInterrupt:false,primarySlot:1,effects:[{slot:1,resource:'hp' as const,recovery:false,amount:0,missed:false}]};
  assert(sourceFinalReady(base));assert.equal(sourceFinalReady({...base,hp:1}),false);
  for(const type of [5,659,660,502])assert.equal(sourceFinalReady({...base,conditionTypes:[type]}),false);
  assert.equal(sourceFinalReady({...base,effects:[{...base.effects[0]!,missed:true}]}),false);
  assert.equal(sourceFinalReady({...base,incomingInterrupt:true}),false);
  assert.equal(sourceFinalReady({...base,effects:[{slot:1,resource:'none',primaryResult:'empty-dictionary',calcResult:null}]}),false);
});

test('source Final nonready does not emit/draw and ready retains a specific nonempty-message phase gate',()=>{
  const context={self:{hp:0,mp:10,monsterId:41,behavior:initialEnemyBehavior()},conditionIds:[],players:[{level:1}],enemies:[{level:1}]};
  for(const strings of [[],['MESSAGE','SPEAKER']]){
    const p=finalAI([601,602],[20,80],strings),initial=startBattleAI(p,context);
    const no=planBattleAIReaction(p,initial.state,context,{counterReady:false,receivedAbilityId:10,receivedSystemId:3});assert.deepEqual(no.acts,[]);
    if(strings.length)assert.throws(()=>planBattleAIReaction(p,initial.state,context,{counterReady:false,finalReady:true,receivedAbilityId:10,receivedSystemId:3}),/FinalAttackAct message/);
    else assert.equal(planBattleAIReaction(p,initial.state,context,{counterReady:false,finalReady:true,receivedAbilityId:10,receivedSystemId:3}).acts[0]!.kind,'final-act');
  }
});

test('Battle-local Final tickets fence exact instance, parent action, cancellation and other battle epochs',()=>{
  const a={id:'same',sourceId:41,side:'enemy' as const},b={...a},owner=new BattleFinalAttackTickets<typeof a>(),other=new BattleFinalAttackTickets<typeof a>();
  const ticket=owner.prepare(a,7);assert.equal(owner.has(a),false);owner.publish(ticket,[8,9]);assert(owner.owns(a,8));assert.equal(owner.owns(b,8),false);assert.equal(other.owns(a,8),false);
  const before=owner.snapshot();owner.complete(8);assert(owner.has(a));owner.cancel(a);assert.equal(owner.has(a),false);owner.restore(before);assert(owner.owns(a,8));
  owner.retire();assert.equal(owner.has(a),false);assert.throws(()=>owner.prepare(a,10),/death-ticket/);
});

test('lethal action creates actual Final before type5/drop; executor pays once and settlement waits for drain',()=>{
  const b=new BattleGame(content(),191);assert(b.command('a',10,'e1'));b.advance(410);
  const unit=b.enemies[0]!,pending=b.pendingActions.find(action=>action.kind==='final')!;assert(pending);assert.equal(unit.hp,0);
  assert(!unit.conditionIds.includes(305));assert.equal(b.finalAttackExecution.length,1);assert.equal(b.registeredDropMonsters.length,0);assert.equal(b.phase,'active');
  assert.equal(pending.charge,0);assert.equal(b.finalAttackExecution[0]!.parentAction,b.action!.executionTicket);
  b.advance(510);assert.equal(b.action?.kind,'final');assert.equal(b.action?.resolved,false);assert.equal(unit.mp,10);
  b.advance(400);assert.equal(b.action?.resolved,true);assert.equal(unit.mp,7);assert(!unit.conditionIds.includes(305));assert.equal(b.registeredDropMonsters.length,0);
  b.advance(500);assert.equal(b.finalAttackExecution.length,0);assert(unit.conditionIds.includes(305));assert.deepEqual(b.registeredDropMonsters,[41]);assert.equal(unit.mp,7);
});

test('predeath self recovery never adds/removes type5 or registers drops; subsequent ordinary play stays active',()=>{
  const b=new BattleGame(content(true),193);assert(b.command('a',10,'e1'));b.advance(1840);
  assert.equal(b.enemies[0]!.hp,2);assert.equal(b.enemies[0]!.mp,7);assert(!b.enemies[0]!.conditionIds.includes(305));
  assert.deepEqual(b.registeredDropMonsters,[]);assert.equal(b.finalAttackExecution.length,0);assert.equal(b.phase,'active');
});

test('two concurrent deaths retain both actual tickets and Final priority until both interrupts drain',()=>{
  const c=content();c.abilities[10]!.program.range=4;c.abilities[10]!.plan!.targeting=compileTargetRule(4,3)!;
  const b=new BattleGame(c,197);assert(b.command('a',10,{kind:'side',side:'enemy'}));b.advance(410);
  assert.equal(b.finalAttackExecution.length,2);assert.equal(b.pendingActions.filter(action=>action.kind==='final').length,2);
  b.advance(1420);assert.equal(b.phase,'active');assert.equal(b.finalAttackExecution.length,1);assert.deepEqual(b.registeredDropMonsters,[41]);
  b.advance(1000);assert.equal(b.phase,'victory');assert.equal(b.finalAttackExecution.length,0);assert.deepEqual(b.registeredDropMonsters,[41,42]);
});

test('a later Final receiver failure rolls back whole parent damage, fee, tickets, AI, action and RNG; retry agrees',()=>{
  const c=content();c.abilities[10]!.program.range=4;c.abilities[10]!.plan!.targeting=compileTargetRule(4,3)!;c.abilities[10]!.cost=2;
  const clean=new BattleGame(structuredClone(c),211),broken=new BattleGame(c,211),op=broken.enemies[1]!.ai!.instructions[3]!.op;
  if(op.kind!=='final-act')throw Error('fixture');op.abilities=[12];
  for(const b of [clean,broken]){assert(b.command('a',10,{kind:'side',side:'enemy'}));b.advance(400);}
  const before=snapshot(broken),owners=[...broken.combatants];assert.throws(()=>broken.advance(10),/unimplemented ability 12/);
  assert.deepEqual(snapshot(broken),before);assert(broken.combatants.every((unit,index)=>unit===owners[index]));
  op.abilities=[601];broken.advance(0);clean.advance(10);assert.deepEqual(snapshot(broken),snapshot(clean));
  broken.advance(3000);clean.advance(3000);assert.deepEqual(snapshot(broken),snapshot(clean));
});

test('weighted Final and full queue/life outcome are frame-partition invariant',()=>{
  for(const seed of [1,191,65537,0xdeadbeef]){
    const c=content();c.enemies[0]!.ai=finalAI([601,13],[50,50]);
    const a=new BattleGame(structuredClone(c),seed),b=new BattleGame(c,seed);
    for(const game of [a,b])assert(game.command('a',10,'e1'));
    a.advance(2200);for(const ms of [7,103,200,100,17,83,511,1179])b.advance(ms);
    assert.deepEqual(snapshot(b),snapshot(a));
  }
});

test('Final MP-zero owner, fee/self-MP order, range16 and nonempty messages remain reached gates with parent rollback',()=>{
  for(const kind of ['mp-zero','mp-write','range16','messages'] as const){
    const c=content();if(kind==='mp-zero')c.enemies[0]!.mp=3;
    if(kind==='mp-write'){c.abilities[601]!.plan!.effects=[{slot:1,kind:'recovery',resource:'mp',calculation:'fixed'}];c.abilities[601]!.program.range=5;c.abilities[601]!.plan!.targeting=compileTargetRule(5,2)!;}
    if(kind==='range16'){c.abilities[601]!.program.range=16;c.abilities[601]!.plan!.targeting=compileTargetRule(16,3)!;}
    if(kind==='messages')c.enemies[0]!.ai=finalAI([601],[100],['AUTHORED','SPEAKER']);
    const b=new BattleGame(c,223);assert(b.command('a',10,'e1'));b.advance(400);const before=snapshot(b);
    assert.throws(()=>b.advance(10),kind==='mp-zero'?/IsUnableMP/:kind==='mp-write'?/MP\/user-write order/:kind==='range16'?/range 16/:/message execution/);
    assert.deepEqual(snapshot(b),before);
  }
});

test('Final impact failure retains exact ticket, instance and fee for deterministic retry',()=>{
  const c=content(),a=new BattleGame(structuredClone(c),229),b=new BattleGame(c,229);
  for(const game of [a,b]){assert(game.command('a',10,'e1'));game.advance(1310);assert.equal(game.action!.kind,'final');assert.equal(game.action!.resolved,false);}
  const target=b.combatants.find(unit=>unit.id===b.action!.targetIds[0])!,defense=target.magicDefense;target.magicDefense=256;
  const before=snapshot(b);assert.throws(()=>b.advance(10),/outside supported/);assert.deepEqual(snapshot(b),before);assert.equal(b.enemies[0]!.mp,10);
  target.magicDefense=defense;b.advance(0);a.advance(10);assert.deepEqual(snapshot(b),snapshot(a));
});

test('poison advances during pending and staged Final, keeps its actual clock, and death starts only after drain',()=>{
  const c=content();c.conditions.rules.definitions.push({id:310,type:10,overlapped:false,eraseGroupId:3});
  c.conditions.behaviors.push({id:310,kind:'poison',name:'Poison',untilType:3,hpDivisor:16});c.enemies[0]!.conditionIds=[310];
  const b=new BattleGame(c,233);assert(b.command('a',10,'e1'));b.advance(410);const before=b.conditionClockState('e1');
  assert.equal(before.length,1);b.advance(600);assert.equal(b.action?.kind,'final');assert(b.conditionClockState('e1')[0]!.elapsedSeconds>before[0]!.elapsedSeconds);
  assert(b.enemies[0]!.conditionIds.includes(310));assert(!b.enemies[0]!.conditionIds.includes(305));b.advance(1000);
  assert(b.enemies[0]!.conditionIds.includes(305));assert(!b.enemies[0]!.conditionIds.includes(310));assert.deepEqual(b.registeredDropMonsters,[41]);
});

test('RemoveAllAct cancellation drains the actual Final ticket without spending its fee or releasing ordinary ATB',()=>{
  const c=content(),b=new BattleGame(c,239);assert(b.command('a',10,'e1'));b.advance(410);assert.equal(b.finalAttackExecution.length,1);
  const mp=b.enemies[0]!.mp,atb=b.combatants.map(unit=>unit.atb);
  // Direct owner protocol probe; complete source wrapper/VM cancellation is
  // separately covered by battle-remove-all-actions and the joint regression.
  Reflect.get(b,'removeAllActions').call(b,17);assert.deepEqual(b.finalAttackExecution,[]);assert.deepEqual(b.pendingActions,[]);assert.equal(b.action,null);
  assert.deepEqual(b.combatants.map(unit=>unit.atb),atb);b.advance(10);assert(b.enemies[0]!.conditionIds.includes(305));assert.equal(b.enemies[0]!.mp,mp);
});

test('retiring actual Final actor before staging or during execution cancels its ticket and cannot rebind same source slot',()=>{
  for(const delay of [.5,1.0]){
    const c=participantFixture([{kind:'wait',seconds:delay},{kind:'add-enemy',monsterId:341,uniqueId:2}]),prototype=content();
    c.abilities[601]=prototype.abilities[601]!;c.players.forEach(unit=>unit.hp=2000);
    for(const unit of c.enemies){unit.hp=10;unit.mp=10;unit.agility=0;unit.abilities=[13,601];unit.ai=finalAI();}
    c.participants!.enemyDefinitions[2000]=enemyBattleDefinition(c.enemies[0]!);c.participants!.enemyDefinitions[2001]=enemyBattleDefinition(c.enemies[1]!);
    const b=new BattleGame(c,241);assert(b.command('a',10,'e1'));b.advance(410);const old=b.enemies.find(unit=>unit.id==='e1')!;
    assert.equal(b.finalAttackExecution.length,1);if(delay===1){b.advance(510);assert.equal(b.action?.kind,'final');}
    b.advance(delay===1?110:110);assert(!b.combatants.includes(old));assert.deepEqual(b.finalAttackExecution,[]);
    const replacement=b.enemies.find(unit=>unit.sourceId===341)!;assert(replacement);assert.notEqual(old,replacement);assert.equal(replacement.mp,replacement.maxMp);
    assert(!b.pendingActions.some(action=>action.kind==='final'&&action.actor===old.id));assert.notEqual(b.action?.kind,'final');
    b.advance(200);assert.equal(replacement.mp,replacement.maxMp);
  }
});

test('IsNotTargeting Final exception is supplied only by actual staged first enemy, never by a pending death ticket',()=>{
  const c=content(true);c.battleEvents={conditions:c.conditions.rules.definitions.map(({id,type})=>({id,type,attackTarget:type===5?1:0,gameOverTarget:type===5?1:0}))};
  const b=new BattleGame(c,251);b.enemies[1]!.hp=0;b.enemies[1]!.conditionIds=[305];assert(b.command('a',10,'e1'));b.advance(410);
  const context=()=>Reflect.get(b,'aiContext').call(b,b.enemies[0]!);
  assert.equal(context().events.finalAttackFirstTargetSide,null);assert.equal(evaluateBattleEventBranch({kind:'only-alive',target:0},context().events),true);
  b.advance(510);assert.equal(b.action?.kind,'final');assert.equal(context().events.finalAttackFirstTargetSide,'enemy');
  assert.equal(evaluateBattleEventBranch({kind:'only-alive',target:0},context().events),false);
  b.advance(1000);assert.equal(context().events.finalAttackFirstTargetSide,null);
});

test('Final action cannot recursively create another death ticket from its own allied lethal results',()=>{
  const c=content();c.abilities[601]!.program.range=2;c.abilities[601]!.plan!.targeting=compileTargetRule(2,3)!;c.abilities[601]!.power=30;
  const b=new BattleGame(c,257);assert(b.command('a',10,'e1'));b.advance(1320);
  assert.equal(b.action?.kind,'final');assert.equal(b.action?.resolved,true);assert.equal(b.enemies[1]!.hp,0);
  assert.equal(b.finalAttackExecution.length,1);assert(!b.pendingActions.some(action=>action.kind==='final'));
  b.advance(600);assert.equal(b.phase,'victory');assert.deepEqual(b.finalAttackExecution,[]);
});

test('enemy real UnableFight removal keeps AI re-entry gate; predeath HP recovery is a different lifecycle',()=>{
  const c=content();
  c.abilities[601]!.program.range=2;c.abilities[601]!.plan!.targeting=compileTargetRule(2,2)!;
  c.abilities[601]!.plan!.effects=[{slot:1,kind:'recover-condition',conditionIds:[305]},
    {slot:2,kind:'recover-max-hp',mode:'percent',value:10}];
  const b=new BattleGame(c,263);b.enemies[1]!.hp=0;b.enemies[1]!.conditionIds=[305];assert(b.command('a',10,'e1'));b.advance(1310);const before=snapshot(b);
  assert.throws(()=>b.advance(10),/UnableFight removal requires AI re-entry/);assert.deepEqual(snapshot(b),before);assert.equal(b.enemies[0]!.mp,10);
});

test('Final wake does not manufacture received-ability context or ordinary counter readiness',()=>{
  const p=syntheticAI([['Nop'],['SyncAI'],['IsRecevieAbility',[0,5]],['UnknownIfFinalInjectedReceived'],['JumpBattleAI',[0]],['Nop'],
    ['FinalAttackAct',[601],[100]],['CounterAct',[602]],['JumpBattleAI',[0]]]),
    context={self:{hp:0,mp:10,monsterId:41,behavior:initialEnemyBehavior()},conditionIds:[],players:[{level:1}],enemies:[{level:1}]},initial=startBattleAI(p,context),
    turn=planBattleAIReaction(p,initial.state,context,{counterReady:false,finalReady:true,receivedAbilityId:10,receivedSystemId:3});
  assert.deepEqual(turn.acts.map(act=>act.kind),['final-act']);assert.equal(turn.state.receivedAbility,null);
});

test('external message/effect publication failure rolls back newly prepared Final ticket with parent damage/AI/RNG',()=>{
  const p=battleMessageProgram([messageRaw('ExecBattleAI'),messageRaw('Wait',.41),messageRaw('Nop'),messageRaw('Msg',-1,'ASYNC'),messageRaw('Wait',.1),messageRaw('Exit')]);
  p.instructions[2]!.op=authoredBattleEffect(1);const c=content(),baseContent=battleMessageContent(p);c.lifecycle=baseContent.lifecycle!;c.battleEvents=baseContent.battleEvents!;
  const owner=new SourceMessageState(),base=createWebBattleEventEffectHost();let fail=true,discards=0;
  const b=new SourceBattleGame(c,269,undefined,undefined,undefined,undefined,undefined,undefined,{
    messages:{policy:WEB_BATTLE_EVENT_MESSAGE_POLICY,owner,sequence:createWebFieldMessageSequencePort(),prepareEffects:()=>({validate(){},commit(){}})},
    effects:{policy:WEB_BATTLE_EVENT_EFFECTS,prepare(request){const resource=base.prepare(request);return {...resource,
      commit(){if(fail)throw Error('Final controlled effect commit failure');resource.commit();},discard(){discards++;resource.discard();}};}}});
  b.advance(10);assert(b.command('a',10,'e1'));b.advance(400);const before={battle:structuredClone({units:b.combatants,pending:b.pendingActions,action:b.action,time:b.time,
    final:b.finalAttackExecution,ai:b.enemyAIState('e1'),random:Reflect.get(b,'randomState'),shared:b.eventSharedReturn}),message:owner.snapshot(),revision:owner.mutationRevision};
  assert.throws(()=>b.advance(10),/Final controlled effect commit failure/);
  assert.deepEqual({battle:structuredClone({units:b.combatants,pending:b.pendingActions,action:b.action,time:b.time,final:b.finalAttackExecution,ai:b.enemyAIState('e1'),
    random:Reflect.get(b,'randomState'),shared:b.eventSharedReturn}),message:owner.snapshot(),revision:owner.mutationRevision},before);
  assert.equal(discards,1);fail=false;b.advance(0);assert.equal(b.finalAttackExecution.length,1);assert.equal(owner.active,true);assert.equal(b.effectPresentation.length,1);
});

test('real force-return VM cancels pending Final authority and does not spend its fee or award victory',()=>{
  const p=battleMessageProgram([messageRaw('ExecBattleAI'),messageRaw('Wait',.5),messageRaw('BattleForceExit'),messageRaw('Wait',.1),messageRaw('Exit')]),c=content();
  const base=battleMessageContent(p);c.lifecycle=base.lifecycle!;c.battleEvents=base.battleEvents!;
  const b=new SourceBattleGame(c,271,undefined,undefined,undefined,undefined,undefined,undefined,{controls:WEB_BATTLE_EVENT_CONTROLS});
  assert(b.command('a',10,'e1'));b.advance(410);assert.equal(b.finalAttackExecution.length,1);b.advance(120);
  assert.equal(b.phase,'forced');assert.deepEqual(b.finalAttackExecution,[]);assert(!b.pendingActions.some(action=>action.kind==='final'));
  assert.equal(b.enemies[0]!.mp,10);assert.equal(b.reward,null);b.advance(2000);assert.equal(b.enemies[0]!.mp,10);
});

test('multiple ordinary Final rows share one death owner and defer life until the last real type6 drains',()=>{
  const c=content();c.enemies[0]!.ai=syntheticAI([['Nop'],['SyncAI'],['StartTable',[0]],['FinalAttackAct',[601],[100]],
    ['FinalAttackAct',[601],[100]],['Act',[13]],['EndTable'],['JumpBattleAI',[0]]]);
  const b=new BattleGame(c,277);assert(b.command('a',10,'e1'));b.advance(410);
  assert.equal(b.finalAttackExecution.length,1);assert.equal(b.finalAttackExecution[0]!.actions.length,2);
  b.advance(1420);assert.equal(b.action?.kind,'final');assert.equal(b.finalAttackExecution[0]!.actions.length,1);
  assert.equal(b.enemies[0]!.mp,7);assert(!b.enemies[0]!.conditionIds.includes(305));assert.deepEqual(b.registeredDropMonsters,[]);
  b.advance(1000);assert.deepEqual(b.finalAttackExecution,[]);assert.equal(b.enemies[0]!.mp,4);assert(b.enemies[0]!.conditionIds.includes(305));assert.deepEqual(b.registeredDropMonsters,[41]);
});

test('prepared ticket cannot cross battle epoch or survive cancelAll; target retirement cancels only referring actual actions',()=>{
  const unit={id:'enemy',sourceId:41,side:'enemy' as const},a={id:'a',sourceId:1,side:'player' as const},b={...a,id:'b',sourceId:2},
    owner=new BattleFinalAttackTickets<typeof unit|typeof a>(),other=new BattleFinalAttackTickets<typeof unit|typeof a>();
  const ticket=owner.prepare(unit,1);assert.throws(()=>other.publish(ticket,[2]),/queue publication/);owner.cancelAll();assert.throws(()=>owner.publish(ticket,[2]),/queue publication/);
  const next=owner.prepare(unit,3);owner.publish(next,[4,5],[{action:4,units:[a]},{action:5,units:[b]}]);owner.cancelReferences(a);
  assert(owner.owns(unit,5));assert.equal(owner.owns(unit,4),false);assert(owner.targetsCurrent(5,[unit,b]));owner.complete(5);assert.equal(owner.has(unit),false);
});
