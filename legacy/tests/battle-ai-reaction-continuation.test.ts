import test from 'node:test';
import assert from 'node:assert/strict';
import { initialEnemyBehavior } from '../src/core/enemy-behavior.js';
import { startBattleAI, planBattleAITurn, receiveBattleAIAtClock, resumeBattleAI, type BattleAIContext } from '../src/core/battle-ai.js';
import { syntheticAI } from './fixtures/battle-ai.js';
import { ControlledBattleGame as BattleGame } from './fixtures/controlled-battle.js';
import { compileTargetRule } from '../src/compiler/battle-targets.js';
import { FieldFadeState, DEVELOPMENT_TRANSPARENT_FADE } from '../src/core/field-fade.js';
import { WEB_BATTLE_GLOBAL_FADE } from '../src/core/battle-global-fade.js';
import { fixture } from './fixtures/battle-content.js';
const context: BattleAIContext={clock:0,self:{hp:100,mp:10,monsterId:1,behavior:initialEnemyBehavior()},conditionIds:[],players:[{level:1}],enemies:[{level:1}]};
function reactionAI(two=true){return syntheticAI([['Nop'],['SyncAI'],['VariableAssign',[0,7]],['StartTable',[0]],['Act',[13]],['EndTable'],
 ['CounterAct',[13]],['FinalAttackAct',[13]],['Blank'],...(two?[['Blank']] as Parameters<typeof syntheticAI>[0]:[]),['ValueCalc',[0,1],[],['＋']],['JumpBattleAI',[0]]]);}
function content(two=true){const c=fixture();c.initialAtb={player:[100,100],enemy:[0,0]};c.players.forEach(u=>u.hp=5000);c.enemies.forEach(u=>u.hp=5000);c.enemies[0]!.ai=reactionAI(two);c.abilities[10]!.cost=2;return c;}
const snapshot=(b:BattleGame)=>structuredClone({units:b.combatants,action:b.action,pending:b.pendingActions,received:b.pendingReactionExecution,
 ai:b.enemies.map(u=>b.enemyAIState(u.id)),events:b.events,time:b.time,phase:b.phase,random:Reflect.get(b,'randomState'),final:b.finalAttackExecution});
function pending(c=content(),seed=211){const b=new BattleGame(c,seed);assert(b.command('a',10,'e1'));b.advance(410);assert(b.pendingReactionExecution);return b;}
test('received flags augment the original Blank without replaying preceding instructions or choosing a second normal row',()=>{
 const p=syntheticAI([['Nop'],['SyncAI'],['StartTable',[0]],['Act',[13]],['Blank'],['CounterAct',[13]],['EndTable'],['JumpBattleAI',[0]]]);
 const initial=startBattleAI(p,context),normal=planBattleAITurn(p,initial.state,context),before=structuredClone(normal);
 const same=receiveBattleAIAtClock(p,normal.state,context,{receivedAbilityId:10,receivedSystemId:3,counterReady:true});
 assert.equal(same.state.pc,normal.state.pc);assert.equal(same.normalWake,true);assert.deepEqual(same.state.receivedAbility,{id:10,systemId:3});
 const done=resumeBattleAI(p,same.state,{...context,clock:10});assert.deepEqual(done.acts.map(a=>a.kind),['act','counter-act']);assert.equal(done.state.receivedAbility,null);
 assert.deepEqual(normal,before);assert.throws(()=>receiveBattleAIAtClock(p,same.state,context,{receivedAbilityId:11,receivedSystemId:3,counterReady:true}),/another received/);
});
test('actual pause and frame splitting retain a parent action without advancing candidates, fees or damage',()=>{
 const c=content(),a=pending(structuredClone(c),223),b=pending(c,223),before=snapshot(a);
 a.setClockInput({...a.timingState.input,paused:true});a.advance(500);assert.deepEqual(snapshot(a),before);
 a.setClockInput({...a.timingState.input,paused:false});a.advance(30);for(let i=0;i<3;i++)b.advance(10);assert.deepEqual(snapshot(a),snapshot(b));
 assert.equal(a.enemies[0]!.behavior!.variables[0],8);assert.equal(a.players[0]!.mp,6);assert.equal(a.pendingReactionExecution,null);
});
test('late source failure restores the previous continuation, original instances and random stream; retry publishes once',()=>{
 const c=content(),clean=pending(structuredClone(c),227),b=pending(c,227);b.advance(10);clean.advance(10);
 const instruction=b.enemies[0]!.ai!.instructions[10]!,op=instruction.op;instruction.op={kind:'blocked',reason:'controlled reaction tail failure'};
 const before=snapshot(b),owners=[...b.combatants];assert.throws(()=>b.advance(10),/controlled reaction tail failure/);assert.deepEqual(snapshot(b),before);assert(b.combatants.every((u,i)=>u===owners[i]));
 instruction.op=op;b.advance(0);clean.advance(10);assert.deepEqual(snapshot(b),snapshot(clean));assert.equal(b.players[0]!.mp,6);assert.equal(b.pendingActions.length,1);
});
test('stale actual receiver/program and changed resources cannot publish a held parent to another owner',()=>{
 const b=pending(),enemy=b.enemies[0]!,old=enemy.ai;enemy.ai=structuredClone(old);
 const before=snapshot(b);assert.throws(()=>b.advance(10),/Stale prepared parent/);assert.deepEqual(snapshot(b),before);enemy.ai=old;
 const allowed=b.content.commands[100]!.abilityIds;b.content.commands[100]!.abilityIds=[];const held=snapshot(b);assert.throws(()=>b.advance(0),/qualification changed/);assert.deepEqual(snapshot(b),held);b.content.commands[100]!.abilityIds=allowed;
 const power=b.content.abilities[10]!.power;b.content.abilities[10]!.power++;assert.throws(()=>b.advance(0),/Stale prepared parent/);b.content.abilities[10]!.power=power;
 b.players[0]!.mp--;assert.throws(()=>b.advance(0),/Stale prepared parent/);b.players[0]!.mp++;b.advance(0);assert(b.pendingReactionExecution);
});
test('prepared battle retirement discards every unpublished received candidate and stale executor completions',()=>{
 const b=pending(),action=b.action!,hp=b.enemies[0]!.hp,mp=b.players[0]!.mp,owned=snapshot(b);
 const retire=b.prepareEventRetirement();retire.validate();retire.commit();assert.equal(b.pendingReactionExecution,null);
 Reflect.get(b,'resolve').call(b,action);assert.equal(b.enemies[0]!.hp,hp);assert.equal(b.players[0]!.mp,mp);assert.equal(b.action!.resolved,false);
 assert.deepEqual(b.pendingActions,owned.pending);assert.equal(b.enemies[0]!.behavior!.variables[0],0);
});
test('the action lock rejects new player commands until all target routes admit',()=>{
 const b=pending();assert.deepEqual(b.ready,[]);assert.equal(b.command('b',10,'e1'),false);assert.equal(b.pendingActions.length,0);
 b.advance(20);assert.equal(b.pendingReactionExecution,null);assert.equal(b.players[1]!.queued,false);assert.equal(b.pendingActions.length,1);
});

test('all target receivers finish before any group damage or RNG publishes; a complete earlier receiver is not rerun',()=>{
 const c=content(),attack=c.abilities[10]!;attack.program.range=4;attack.plan!.targeting=compileTargetRule(4,3)!;
 c.enemies[1]!.ai=reactionAI(false);const b=new BattleGame(c,229);assert(b.command('a',10,{kind:'side',side:'enemy'}));b.advance(410);
 assert.equal(b.pendingReactionExecution!.receivers.length,2);assert(b.enemies.every(e=>e.hp===5000&&e.behavior!.variables[0]===0));const random=Reflect.get(b,'randomState');
 b.advance(10);assert.equal(b.pendingReactionExecution!.receivers.filter(r=>r.pending).length,1);assert(b.enemies.every(e=>e.hp===5000));assert.equal(Reflect.get(b,'randomState'),random);
 b.advance(10);assert.equal(b.pendingReactionExecution,null);assert(b.enemies.every(e=>e.hp<5000&&e.behavior!.variables[0]===8));assert.equal(b.players[0]!.mp,6);assert.equal(b.pendingActions.length,2);
});
test('a receiver failure after another target completed cannot publish a partial group and retry does not duplicate that earlier route',()=>{
 const c=content(),attack=c.abilities[10]!;attack.program.range=4;attack.plan!.targeting=compileTargetRule(4,3)!;c.enemies[1]!.ai=reactionAI(false);
 const b=new BattleGame(c,233);assert(b.command('a',10,{kind:'side',side:'enemy'}));b.advance(420);const instruction=b.enemies[0]!.ai!.instructions[10]!,op=instruction.op;
 instruction.op={kind:'blocked',reason:'controlled last receiver failure'};const before=snapshot(b);assert.throws(()=>b.advance(10),/controlled last receiver failure/);assert.deepEqual(snapshot(b),before);
 instruction.op=op;b.advance(0);assert.equal(b.pendingActions.length,2);assert(b.enemies.every(e=>e.behavior!.variables[0]===8));
});
test('a late actual host failure after parent commit restores the private candidate, complete AI clocks, tickets, fees and RNG',()=>{
 for(const final of [false,true]) {
 const c=content();if(final)c.enemies[0]!.hp=1;const owner=new FieldFadeState(DEVELOPMENT_TRANSPARENT_FADE);let fail=false,reenter=false,b!:BattleGame;
 const prepare=owner.prepareFrame.bind(owner);owner.prepareFrame=()=>{const frame=prepare();return {...frame,prepareCommit(){const write=frame.prepareCommit();return {...write,validate(){write.validate();if(reenter)b.advance(0);if(fail)throw Error('controlled late shared host failure');}};}};};
 b=new BattleGame(c,239,undefined,undefined,undefined,undefined,undefined,undefined,{fade:{policy:WEB_BATTLE_GLOBAL_FADE,owner}});
 assert(b.command('a',10,'e1'));b.advance(420);const before=snapshot(b),fade=owner.snapshot(),revision=owner.mutationRevision;
 fail=true;assert.throws(()=>b.advance(10),/controlled late shared host failure/);assert.deepEqual(snapshot(b),before);assert.deepEqual(owner.snapshot(),fade);assert.equal(owner.mutationRevision,revision);
 fail=false;reenter=true;assert.throws(()=>b.advance(0),/Reentrant/);assert.deepEqual(snapshot(b),before);assert.deepEqual(owner.snapshot(),fade);
 reenter=false;b.advance(0);assert.equal(b.pendingReactionExecution,null);assert.equal(b.players[0]!.mp,6);assert.equal(b.pendingActions.length,1);assert.equal(b.enemies[0]!.behavior!.variables[0],8);assert.equal(b.finalAttackExecution.length,final?1:0);
 }
});

test('lethal received projection can branch past the unselected normal row while preserving a real Final from the original PC',()=>{
 const c=content();c.enemies[0]!.hp=1;c.enemies[0]!.ai=syntheticAI([['Nop'],['SyncAI'],['StartTable',[0]],['Blank'],
  ['IsCheckHp',[0,6],[],['＝']],['Act',[13]],['Nop'],['FinalAttackAct',[13]],['EndTable'],['JumpBattleAI',[0]]]);
 const b=new BattleGame(c,241);assert(b.command('a',10,'e1'));b.advance(390);b.enemies[0]!.atb=100;b.advance(10);
 assert.equal(b.enemyAIState('e1')!.continuation!.acts.length,0);b.advance(10);
 assert.equal(b.enemies[0]!.hp,0);assert.equal(b.finalAttackExecution.length,1);assert.equal(b.pendingActions.filter(a=>a.kind==='normal').length,0);assert.equal(b.pendingActions.filter(a=>a.kind==='final').length,1);
});
