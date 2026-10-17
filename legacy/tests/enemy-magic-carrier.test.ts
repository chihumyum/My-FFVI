import test from 'node:test';import assert from 'node:assert/strict';
import {enemyMagicSource,enemyMagicContent} from './fixtures/enemy-magic-carrier.js';
import {enemyMagicActorBlocker} from '../src/core/enemy-magic-carrier.js';
import {syntheticAI} from './fixtures/battle-ai.js';
import {compileScriptedBattleAction} from '../src/compiler/battle-scripted-action.js';
import {WEB_SCRIPTED_BATTLE_ACTIONS} from '../src/core/scripted-battle-action.js';
import type {BattleEventOp} from '../src/core/battle-event.js';
import {BattleGame} from '../src/core/battle.js';import {calculateDevelopmentEffects} from '../src/core/ability.js';

function definition(f=enemyMagicSource()){return f.compileAbility().abilities[901]!;}
const state=(b:BattleGame)=>structuredClone({time:b.time,units:b.combatants,action:b.action,pending:b.pendingActions,events:b.events,random:Reflect.get(b,'randomState'),ai:b.enemies.map(e=>b.enemyAIState(e.id))});
test('exact source Function3 Type13 retains native type, reaction and real hit classification without a player command grant',()=>{
 const f=enemyMagicSource(),a=definition(f);assert(a.plan,JSON.stringify(a.blockers));assert.equal(a.program.rules.type_id,13);assert.equal(a.program.functions[0]!.functionId,809);assert.deepEqual(a.conditionRecoveryHit,{kind:'source-condition-recovery-hit-v1',forAiType:2,isMagic:true});
 assert.equal(enemyMagicActorBlocker(a,'enemy'),null);assert.match(enemyMagicActorBlocker(a,'player')!,/player\/special/);
 f.ability.reaction_type='1';const d=definition(f);assert.equal(d.plan,null);assert.equal(d.program.rules.reaction_type,1);assert(d.blockers.includes('unresolved source EnemyMagic reaction_type=1 provider'));
});
test('mixed functions, other operands, source series, level consumption and missing actual Chanting are never covered by the carrier',()=>{
 for(const change of [(f:ReturnType<typeof enemyMagicSource>)=>{f.group.function1_value1='0';},(f:ReturnType<typeof enemyMagicSource>)=>{f.group.function1_value2='1';},(f:ReturnType<typeof enemyMagicSource>)=>{f.tables['function.csv']![0]!.series_id='1';},(f:ReturnType<typeof enemyMagicSource>)=>{f.group.function2_id='809';f.group.function2_value1='1';},(f:ReturnType<typeof enemyMagicSource>)=>{f.ability.ability_lv='1';},(f:ReturnType<typeof enemyMagicSource>)=>{f.tables['chanting.csv']=[];},(f:ReturnType<typeof enemyMagicSource>)=>{f.tables['chanting.csv']![0]!.for_ai_type_id='1';},(f:ReturnType<typeof enemyMagicSource>)=>{f.tables['chanting.csv']!.push({...f.tables['chanting.csv']![0]!,id:'803'});}]){
  const f=enemyMagicSource();change(f);const a=definition(f);assert.equal(a.plan,null);assert(a.blockers.some(b=>b.includes('type 13')));
 }
});
test('unknown full flags, ranges and element enumeration remain their original specific gates',()=>{
 for(const change of [(f:ReturnType<typeof enemyMagicSource>)=>{f.ability.content_flag_group_id='91';f.tables['content_flag_group.csv']=[{id:'82',group_id:'91',content_flag_id:'3'}];},(f:ReturnType<typeof enemyMagicSource>)=>{f.ability.battle_renge_id='16';}]){
  const f=enemyMagicSource();change(f);const a=definition(f);assert.equal(a.plan,null);assert(!a.blockers.includes('unresolved ability type 13'));assert(a.blockers.some(b=>b.includes('flags')||b.includes('range')));
 }
});
test('the same Magic plan retains source hit and damage draws rather than choosing a Type13 formula',()=>{
 const a=definition(),ordinary=structuredClone(a);ordinary.program.rules.type_id=2;
 const actor={side:'enemy'as const,level:2,magic:20,attack:0,attackElements:[],conditionTypes:[]},target={side:'player'as const,magicDefense:10,magicEvasion:0,defense:0,evasion:0,elementResistances:{},conditionTypes:[]};
 const run=(d:typeof a)=>{let draws=0;const effects=calculateDevelopmentEffects(d.plan!,d.power,actor,target,()=>{draws++;return 0;},1,undefined,d.id);return{effects,draws};};
 assert.deepEqual(run(a),run(ordinary));assert(run(a).draws>0);
});
test('actual enemy AI charges real MP once, while forbidden current states and player acquisition stay independent',()=>{
 const {content:c}=enemyMagicContent(),b=new BattleGame(c,123),enemy=b.enemies[0]!;b.advance(430);assert.equal(b.action?.source.id,901);assert(b.action?.resolved);assert.equal(enemy.mp,17);const paid=enemy.mp;b.advance(10);assert.equal(enemy.mp,paid);assert.equal(b.action!.charge,0);
 const denied=enemyMagicContent();denied.content.enemies[0]!.conditionIds=[6];const blocked=new BattleGame(denied.content,123);blocked.advance(1000);assert.equal(blocked.enemies[0]!.mp,20);assert.equal(blocked.players[0]!.hp,denied.content.players[0]!.hp);
 const p=enemyMagicContent();p.content.players[0]!.abilities.push(901);p.content.commands[100]!.abilityIds.push(901);const player=new BattleGame(p.content,1);assert.equal(player.canUse(player.players[0]!.id,901),false);assert.deepEqual(player.targetChoices(player.players[0]!.id,901),[]);
});
test('lost actual classification is a hard AI admission error before target RNG or any queued/cost mutation',()=>{
 const {content:c}=enemyMagicContent();delete c.abilities[901]!.conditionRecoveryHit;const supplied=structuredClone(c);assert.throws(()=>new BattleGame(c,123),/Chanting\/hit classification/);assert.deepEqual(c,supplied);
 const {content:valid}=enemyMagicContent(),b=new BattleGame(valid,123);delete b.content.abilities[901]!.conditionRecoveryHit;const before=state(b);assert.throws(()=>b.advance(10),/Chanting\/hit classification/);assert.deepEqual(state(b),before);
});
test('a later target validation failure rolls back the whole actual action and retries the same random stream and MP payment once',()=>{
 const {content:c,source}=enemyMagicContent();source.ability.battle_renge_id='4';c.abilities[901]=definition(source);const b=new BattleGame(c,314),enemy=b.enemies[0]!;b.advance(400);assert.equal(b.action?.elapsed,390);
 const target=b.players[1]!,defense=target.magicDefense;target.magicDefense=NaN;const before=state(b);assert.throws(()=>b.advance(10));assert.deepEqual(state(b),before);assert.equal(enemy.mp,20);target.magicDefense=defense;b.advance(0);assert(b.action?.resolved);assert.equal(enemy.mp,17);assert(b.action!.results.every(r=>r.effects[0]!.resource==='hp'));
 const clone=new BattleGame(c,314);clone.advance(410);assert.deepEqual(b.action,clone.action);assert.equal(Reflect.get(b,'randomState'),Reflect.get(clone,'randomState'));assert.deepEqual(b.combatants,clone.combatants);
});

test('the actual ordinary counter owner receives source Type13 without treating it as a player command or ReactionType',()=>{
 for(const selector of [13,2]){
  const {content:c}=enemyMagicContent(),first=c.enemies[0]!;c.enemies.push({...structuredClone(first),id:'e2',abilities:[13],ai:syntheticAI([
   ['Nop'],['SyncAI'],['StartTable',[0]],['CounterActReceiveCommand',[selector,13],[0,100]],['Act',[13],[100]],['EndTable'],['JumpBattleAI',[0]],
  ])});c.initialAtb.enemy=[0,0];c.battleEvents={conditions:c.conditions.rules.definitions.map(({id,type})=>({id,type,attackTarget:type===5?1:0,gameOverTarget:type===5?1:0}))};
  const action=compileScriptedBattleAction({mnemonic:'BattleAction',type:1,operands:{iValues:[2,1,901,2,2,0,0,0],rValues:Array(8).fill(0),sValues:Array(8).fill('')}});
  const ops:BattleEventOp[]=[{kind:'exec-ai'},{kind:'pause',enabled:true},action,{kind:'wait',seconds:1},{kind:'exit'}];
  c.lifecycle={kind:'battle-lifecycle-v1',mode:'script',scriptId:1,program:{kind:'battle-event-v1',source:null,entry:0,end:ops.length,localNames:[],initialLocals:[],instructions:ops.map(op=>({mnemonic:op.kind,op})),blockers:[]}};
  const b=new BattleGame(c,314,undefined,undefined,undefined,undefined,undefined,undefined,{scriptedActions:WEB_SCRIPTED_BATTLE_ACTIONS});b.advance(420);assert.equal(b.action?.source.id,901);assert(b.action?.resolved);assert.equal(b.action!.results[0]!.target,'e2');assert.equal(b.pendingActions.some(a=>a.actor==='e2'&&a.kind==='counter'),selector===13,JSON.stringify({action:b.action,pending:b.pendingActions,ai:b.enemyAIState('e2')}));assert.equal(b.content.abilities[901]!.program.rules.type_id,13);
 }
});
