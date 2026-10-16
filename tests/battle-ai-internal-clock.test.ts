import test from 'node:test';
import assert from 'node:assert/strict';
import { compileBattleAI } from '../src/compiler/battle-ai.js';
import { initialEnemyBehavior } from '../src/core/enemy-behavior.js';
import { startBattleAI, planBattleAITurn, planBattleAIReaction, resumeBattleAI, type BattleAIContext } from '../src/core/battle-ai.js';
import { aiSource, syntheticAI } from './fixtures/battle-ai.js';
import { ControlledBattleGame as BattleGame } from './fixtures/controlled-battle.js';
import { fixture } from './fixtures/battle-content.js';
import { participantFixture } from './fixtures/battle-participant-game.js';

const context: BattleAIContext = { clock: 0, self: { hp: 100, mp: 10, monsterId: 1, behavior: initialEnemyBehavior() },
  conditionIds: [], players: [{level:1}], enemies:[{level:1}] };
function normalAI(initialBlank=false) { return syntheticAI([
  ...(initialBlank ? [['VariableAssign',[0,7]],['Blank'],['Blank']] as Parameters<typeof syntheticAI>[0] : [['Nop']] as Parameters<typeof syntheticAI>[0]),
  ['SyncAI'],['VariableAssign',[1,9]],['StartTable',[0]],['Act',[13],[100]],['Blank'],['ValueCalc',[1,1],[],['＋']],['EndTable'],['JumpBattleAI',[initialBlank?2:0]],
]); }
function content(initialBlank=false) {
  const c=fixture(); c.initialAtb={player:[100,100],enemy:[0,0]};
  c.players.forEach(u=>u.hp=5000);c.enemies.forEach(u=>u.hp=5000);
  c.enemies[0]!.ai=normalAI(initialBlank);return c;
}
const snapshot=(b:BattleGame)=>structuredClone({units:b.combatants,action:b.action,pending:b.pendingActions,
  ai:b.enemies.map(u=>b.enemyAIState(u.id)),events:b.events,time:b.time,phase:b.phase,
  random:Reflect.get(b,'randomState'),final:b.finalAttackExecution});

test('exact Internal names ignore all old operand banks only in evidenced AI domain',()=>{
  for(const mnemonic of ['Nop','Blank'])for(const operands of [undefined,{iValues:[84,696],rValues:[50,50],sValues:['≦']},{unrelated:true}]){
    const raw=aiSource([[mnemonic],['SyncAI']]);Reflect.set(raw.Mnemonics[0]!,'operands',operands);
    assert.deepEqual(compileBattleAI(raw,null).instructions[0]!.op,{kind:mnemonic==='Nop'?'nop':'blank'});
    Reflect.set(raw.Mnemonics[0]!,'type',2);assert.equal(compileBattleAI(raw,null).instructions[0]!.op.kind,'blocked');
  }
});
test('Blank yields on first clock, same clock cannot cross it, consecutive Blank each consume a later clock',()=>{
  const p=syntheticAI([['VariableAssign',[0,7]],['Blank'],['Blank'],['SyncAI']]);
  const first=startBattleAI(p,context), before=structuredClone(first);
  assert.equal(first.state.pc,1);assert.equal(first.state.status,'running');assert.equal(context.self.behavior.variables[0],0);
  assert.deepEqual(resumeBattleAI(p,first.state,context),first);
  const second=resumeBattleAI(p,first.state,{...context,clock:10});assert.equal(second.state.pc,2);
  assert.deepEqual(resumeBattleAI(p,second.state,{...context,clock:10}),second);
  const done=resumeBattleAI(p,second.state,{...context,clock:20});assert.equal(done.state.pc,3);assert.equal(done.state.status,'waiting');
  assert.equal(done.state.continuation,undefined);assert.equal(done.behavior.variables[0],7);assert.deepEqual(first,before);
  assert.throws(()=>resumeBattleAI(p,first.state,{...context,clock:-1}),/monotonic/);
  assert.throws(()=>startBattleAI(p,{...context,clock:undefined} as unknown as BattleAIContext),/host clock/);
});
test('normal continuation keeps whole table candidate and original wake until Sync',()=>{
  const p=normalAI(),start=startBattleAI(p,context),pending=planBattleAITurn(p,start.state,context);
  assert.equal(pending.acts.length,1);assert.equal(pending.state.turnCounter,1);assert.equal(pending.behavior.variables[1],9);
  assert.throws(()=>planBattleAITurn(p,pending.state,context),/unfinished AI wake/);
  const done=resumeBattleAI(p,pending.state,{...context,clock:10});
  assert.equal(done.trigger,'normal');assert.equal(done.state.status,'waiting');assert.equal(done.behavior.variables[1],10);
  assert.deepEqual(done.acts,pending.acts);assert.equal(start.state.turnCounter,0);
});
test('pure reaction continuation retains the actual received identity and readiness without a fresh wake',()=>{
  const p=syntheticAI([['Nop'],['SyncAI'],['CounterAct',[13]],['Blank'],['IsRecevieAbility',[10,6]],
    ['UnknownUnlessWrongReceiver'],['Nop'],['JumpBattleAI',[0]]]);
  const start=startBattleAI(p,context),pending=planBattleAIReaction(p,start.state,context,
    {counterReady:true,receivedAbilityId:10,receivedSystemId:3,receivedAbilityTypeId:8});
  assert.equal(pending.acts.length,1);assert.deepEqual(pending.state.receivedAbility,{id:10,systemId:3,typeId:8});
  const done=resumeBattleAI(p,pending.state,{...context,clock:10});assert.equal(done.state.status,'waiting');
  assert.equal(done.state.receivedAbility,null);assert.deepEqual(done.acts,pending.acts);assert.equal(done.trigger,'reaction');
});
test('Blank polling retains bounded unique PC evidence and never turns into a runaway same-clock loop',()=>{
  const p=syntheticAI([['Nop'],['Blank'],['JumpBattleAI',[0]]]);let t=startBattleAI(p,context);
  for(let clock=10;clock<=10000;clock+=10)t=resumeBattleAI(p,t.state,{...context,clock});
  assert.equal(t.state.pc,1);assert.deepEqual(t.state.continuation!.visited,[0,1,2]);
});
test('actual Battle initial and normal prefixes remain unpublished until same-owner Sync',()=>{
  const b=new BattleGame(content(true),73),enemy=b.enemies[0]!;
  assert.equal(b.enemyAIState(enemy.id)!.pc,1);assert.equal(enemy.behavior!.variables[0],0);
  const random=Reflect.get(b,'randomState');b.advance(10);assert.equal(b.enemyAIState(enemy.id)!.pc,2);
  assert.equal(enemy.behavior!.variables[0],0);assert.equal(Reflect.get(b,'randomState'),random);
  b.advance(10);assert.equal(enemy.behavior!.variables[0],7);assert.equal(b.enemyAIState(enemy.id)!.status,'waiting');
  enemy.atb=100;b.advance(10);assert.equal(b.enemyAIState(enemy.id)!.status,'running');
  assert.equal(enemy.behavior!.variables[1],0);assert.equal(enemy.queued,false);assert.equal(b.action,null);assert.equal(b.pendingActions.length,0);
  assert.equal(Reflect.get(b,'randomState'),random);
  b.advance(10);assert.equal(enemy.behavior!.variables[1],10);assert.equal(enemy.queued,true);assert.equal(b.action!.actor,enemy.id);
  assert.equal(b.enemyAIState(enemy.id)!.turnCounter,1);assert.equal(b.enemyAIState(enemy.id)!.continuation,undefined);
});
test('actual Battle resumes only after simulation pause fence and preserves frame partitioning',()=>{
  const c=content(),a=new BattleGame(structuredClone(c),79),b=new BattleGame(c,79);
  for(const game of [a,b])game.enemies[0]!.atb=100;
  a.advance(10);const before=snapshot(a);a.setClockInput({...a.timingState.input,paused:true});a.advance(100);assert.deepEqual(snapshot(a),before);
  a.setClockInput({...a.timingState.input,paused:false});a.advance(990);for(let i=0;i<100;i++)b.advance(10);assert.deepEqual(snapshot(a),snapshot(b));
});
test('late normal failure rolls back the whole current frame and retry continues the same unpublished wake',()=>{
  const c=content(),clean=new BattleGame(structuredClone(c),83),broken=new BattleGame(c,83);
  for(const b of [clean,broken]){b.enemies[0]!.atb=100;b.advance(10);}
  const program=broken.enemies[0]!.ai!,instruction=program.instructions[6]!,op=instruction.op;
  instruction.op={kind:'blocked',reason:'controlled late failure'};
  const before=snapshot(broken),owners=[...broken.combatants];assert.throws(()=>broken.advance(10),/controlled late failure/);
  assert.deepEqual(snapshot(broken),before);assert(broken.combatants.every((u,i)=>u===owners[i]));
  instruction.op=op;broken.advance(0);clean.advance(10);assert.deepEqual(snapshot(broken),snapshot(clean));
});
test('unfinished normal cancellation discards candidate behavior and creates no queued half action',()=>{
  const b=new BattleGame(content(),89),enemy=b.enemies[0]!;enemy.atb=100;b.advance(10);
  enemy.hp=0;b.advance(10);assert.equal(enemy.behavior!.variables[1],0);assert.equal(enemy.queued,false);
  assert.equal(b.enemyAIState(enemy.id)!.continuation,undefined);assert.equal(b.pendingActions.length,0);
});
test('reaction and Final Blank remain explicit prepared-parent gates and roll back damage, fees, tickets and RNG',()=>{
  for(const final of [false,true]){
    const c=content();c.enemies[0]!.hp=final?1:5000;c.abilities[10]!.cost=2;
    c.enemies[0]!.ai=syntheticAI([['Nop'],['SyncAI'],['StartTable',[0]],['Act',[13]],['EndTable'],
      [final?'FinalAttackAct':'CounterAct',[13]],['Blank'],['JumpBattleAI',[0]]]);
    const b=new BattleGame(c,97);assert(b.command('a',10,'e1'));b.advance(400);
    const before=snapshot(b);assert.throws(()=>b.advance(10),/Blank reaction\/Final requires a prepared parent-action/);
    assert.deepEqual(snapshot(b),before);assert.equal(b.enemies[0]!.hp,final?1:5000);assert.equal(b.players[0]!.mp,8);
  }
});
test('late enemy entry gets its own initial candidate and retirement cannot resume an old instance',()=>{
  const c=participantFixture([{kind:'add-enemy',monsterId:341,uniqueId:2}]);
  c.participants!.enemyDefinitions[341]!.ai=normalAI(true);
  const b=new BattleGame(c,101),old=b.enemies[0]!;b.advance(20);
  const actor=b.enemies.find(u=>u.sourceId===341)!;assert(actor);assert.notEqual(actor,old);
  assert.equal(b.enemyAIState(old.id),null);assert.equal(actor.behavior!.variables[0],0);
  b.advance(20);assert.equal(actor.behavior!.variables[0],7);assert.equal(b.enemyAIState(actor.id)!.status,'waiting');
  assert.equal(old.behavior!.variables[0],0);
});
test('retirement and stale program identity cannot publish a pending candidate to another owner',()=>{
  const b=new BattleGame(content(),103),enemy=b.enemies[0]!;enemy.atb=100;b.advance(10);
  const before=snapshot(b),program=enemy.ai;enemy.ai=structuredClone(program);
  assert.throws(()=>b.advance(10),/Stale AI clock instance or program/);enemy.ai=program;
  assert.deepEqual(snapshot(b),before);
  const retirement=b.prepareEventRetirement();retirement.validate();retirement.commit();
  assert.equal(b.enemyAIState(enemy.id)!.continuation,undefined);assert.equal(b.enemyAIState(enemy.id)!.status,'exited');
  assert.equal(enemy.behavior!.variables[1],0);
});

test('incoming actions cannot silently lose reaction or pre-type5 Final while another wake is pending',()=>{
  for(const final of [false,true]){
    const c=content();c.enemies[0]!.hp=final?1:5000;c.abilities[10]!.cost=2;
    c.enemies[0]!.ai=syntheticAI([['Nop'],['SyncAI'],['StartTable',[0]],['Act',[13]],
      ['Blank'],['JumpBattleAI',[3]],['FinalAttackAct',[13]],['EndTable'],['JumpBattleAI',[0]]]);
    const b=new BattleGame(c,107);b.enemies[0]!.atb=100;assert(b.command('a',10,'e1'));b.advance(400);
    assert.equal(b.enemyAIState('e1')!.status,'running');const before=snapshot(b);
    assert.throws(()=>b.advance(10),final?/pending wake received Final readiness/:/pending wake received an action/);
    assert.deepEqual(snapshot(b),before);assert.equal(b.enemies[0]!.hp,final?1:5000);assert.equal(b.players[0]!.mp,8);
  }
});
test('an actual hit requiring neither reaction nor Final may publish while the original wake remains pending',()=>{
  const c=content();c.reactions.excludedAbilityIds=[10];
  c.enemies[0]!.ai=syntheticAI([['Nop'],['SyncAI'],['StartTable',[0]],['Act',[13]],
    ['Blank'],['JumpBattleAI',[3]],['FinalAttackAct',[13]],['EndTable'],['JumpBattleAI',[0]]]);
  const b=new BattleGame(c,109);b.enemies[0]!.atb=100;assert(b.command('a',10,'e1'));b.advance(410);
  assert(b.action!.resolved);assert(b.enemies[0]!.hp<5000);assert.equal(b.enemyAIState('e1')!.status,'running');
  assert.equal(b.enemyAIState('e1')!.continuation!.acts.length,1);assert.equal(b.pendingActions.length,0);
  const candidate=structuredClone(b.enemyAIState('e1')!.continuation);b.advance(0);
  assert.deepEqual(b.enemyAIState('e1')!.continuation,candidate);assert.equal(b.enemies[0]!.queued,false);
});
