import test from 'node:test';import assert from 'node:assert/strict';
import {ordinaryConditionContent,ordinaryConditionSource} from './fixtures/ordinary-condition-action.js';
import {levitateFixture} from './fixtures/condition-levitate.js';
import {conditionBlindFixture} from './fixtures/condition-blind.js';
import {compileBattleAbilityContent} from '../src/compiler/battle-ability-content.js';
import {BattleGame} from '../src/core/battle.js';
import {projectActionTarget} from '../src/core/action-effects.js';
import {cyclingAI,syntheticAI} from './fixtures/battle-ai.js';
import {battleReaction} from '../src/core/battle-reactions.js';
import {sourceDeathApplication} from '../src/core/condition-application.js';
import {deathSource} from './fixtures/function9-application.js';
function content(type=2,id=1505){const {content:c}=ordinaryConditionContent(),f=deathSource(type,id);c.conditions=f.compile().catalog;
  c.abilities[901]=f.compileAbility().abilities[901]!;c.initialAtb.enemy=[0,0];
  for(const unit of [...c.players,...c.enemies])unit.conditionTraits={kind:'source-condition-traits-v1',baseUndead:false};
  return{c,f};}
const snapshot=(b:BattleGame)=>structuredClone({time:b.time,units:b.combatants,action:b.action,pending:b.pendingActions,events:b.events,random:Reflect.get(b,'randomState'),final:b.finalAttackExecution});
function until(b:BattleGame,p:()=>boolean){for(let i=0;i<1000&&!p();i++)b.advance(10);assert(p());}
const context=(a:{id:string},t:{id:string},conditionId=1505)=>({kind:'source-function9-death-override-v1' as const,actorId:a.id,abilityId:901,conditionId,targetIds:[t.id],normalBranch:'native-type3' as const});

test('Function9 uses source type5 lifecycle and original row identity, including a non-default death row',()=>{
  for(const id of [5,1505]){
    const f=deathSource(3,id);const a=f.compileAbility().abilities[901]!;
    assert(a.plan,a.blockers.join('; '));assert.equal(a.program.functions[0]!.functionId,809);assert.equal(a.plan.effects[0]!.kind,'add-condition');
    assert(a.ordinaryConditionPresentation);assert.equal(a.program.functions[0]!.values[0],id);
  }
  const {c}=content(3),b=new BattleGame(c,314),a=b.players[0]!,t=b.enemies[0]!;t.hp=200;assert(b.command(a.id,901,t.id));
  until(b,()=>b.action?.source.id===901&&b.action.resolved);assert.equal(t.hp,0);assert(t.conditionIds.includes(1505));assert(!t.conditionIds.includes(5));
  assert.equal(a.mp,6);b.conditions.validateStableLife(t.hp,t.conditionIds);until(b,()=>b.phase==='victory');
});
test('ordinary death needs the real non-Undead provider; Type3 normal branch is independent of its Undead boolean',()=>{
  for(const mode of ['missing','undead']as const){const {c}=content(2),b=new BattleGame(c,314),a=b.players[0]!,t=b.enemies[0]!;
    assert(b.command(a.id,901,t.id));until(b,()=>b.action?.elapsed===390);const old=t.conditionTraits;
    if(mode==='missing')delete t.conditionTraits;else t.conditionTraits!.baseUndead=true;
    const before=snapshot(b);assert.throws(()=>b.advance(10),/Undead|reversal/);assert.deepEqual(snapshot(b),before);t.conditionTraits={...old!,baseUndead:false};b.advance(0);assert.equal(t.hp,0);assert.equal(a.mp,6);
  }
  const {c}=content(3),b=new BattleGame(c,314),a=b.players[0]!,t=b.enemies[0]!;t.conditionTraits!.baseUndead=true;assert(b.command(a.id,901,t.id));until(b,()=>b.action?.resolved===true);assert.equal(t.hp,0);
});
test('pure source death projection refuses an absent current provider instead of treating it as false',()=>{
  const {c}=content(3),b=new BattleGame(c,12),a=b.players[0]!,t=b.enemies[0]!,plan=c.abilities[901]!.plan!;
  assert(sourceDeathApplication(plan,b.conditions,c.abilities[901]!.program));let draws=0;
  assert.throws(()=>projectActionTarget(plan,0,a,t,b.conditions,()=>{draws++;return 0;},1,0,undefined,901),/override provider/);assert.equal(draws,0);
});
test('the shared Undead provider distinguishes supported Blind type9 from unsupported Rampage type616',()=>{
  const {c}=content(2),blind=conditionBlindFixture().compile().catalog;
  c.conditions.rules.definitions.push(blind.rules.definitions.find(d=>d.id===109)!);
  c.conditions.behaviors.push(blind.behaviors.find(b=>b.id===109)!);
  c.enemies[0]!.conditionIds=[109];
  const b=new BattleGame(c,314);assert(b.command(b.players[0]!.id,901,b.enemies[0]!.id));
  until(b,()=>b.action?.source.id===901&&b.action.resolved);assert.equal(b.enemies[0]!.hp,0);
  const unknown=structuredClone(c);unknown.conditions.rules.definitions.push({id:1616,type:616,overlapped:false,eraseGroupId:1});
  unknown.enemies[0]!.conditionIds=[1616];assert.throws(()=>new BattleGame(unknown,314),/Unimplemented active|Unsupported battle condition/);
});
test('death keeps native resistance-key, fixed-hit, Miss and received-command semantics',()=>{
  const {c}=content(3),b=new BattleGame(c,12),a=b.players[0]!,t=b.enemies[0]!,plan=c.abilities[901]!.plan!,effect=plan.effects[0]!;
  assert.equal(effect.kind,'add-condition');if(effect.kind!=='add-condition')return;
  let draws=0;const run=()=>projectActionTarget(plan,0,a,t,b.conditions,()=>{draws++;return 0;},1,0,undefined,901,'settle',undefined,context(a,t));
  t.conditionResistances={1505:0};assert(run().effects[0]!.missed);assert.equal(draws,0);
  effect.fixedHit=true;t.conditionResistances={1505:1};assert(run().effects[0]!.missed);assert.equal(draws,0);
  t.conditionResistances={1505:0};const hit=run();assert.equal(hit.state.hp,0);assert.equal(draws,0);
  effect.fixedHit=false;t.conditionResistances={};t.magicEvasion=128;const miss=run();assert.equal(miss.state.hp,t.hp);assert(miss.effects[0]!.missed);assert.equal(draws,1);
  assert.equal(battleReaction(c.reactions,{actor:a.id,target:t.id,isCounter:false,abilityId:901,systemId:5,primarySlot:1,effects:miss.effects})?.counterReady,false);
});
test('a later target hit failure rolls back every death, payment, random value and AI ticket, then retries once',()=>{
  const {c,f}=content(3);f.ability.battle_renge_id='4';c.abilities[901]=f.compileAbility().abilities[901]!;c.enemies.push({...structuredClone(c.enemies[0]!),id:'e2'});
  const b=new BattleGame(c,314),a=b.players[0]!;assert(b.command(a.id,901,{kind:'side',side:'enemy'}));until(b,()=>b.action?.elapsed===390);
  const second=b.enemies[1]!,evasion=second.magicEvasion;second.magicEvasion=NaN;const before=snapshot(b);assert.throws(()=>b.advance(10));assert.deepEqual(snapshot(b),before);
  second.magicEvasion=evasion;b.advance(0);assert.deepEqual(b.enemies.map(t=>t.hp),[0,0]);assert.equal(a.mp,6);
  const replay=new BattleGame(c,314);assert(replay.command(replay.players[0]!.id,901,{kind:'side',side:'enemy'}));replay.advance(410);assert.deepEqual(snapshot(b),snapshot(replay));
});
test('explicit incoming type5 never manufactures the HP-zero Final phase',()=>{
  const {c}=content(3);c.enemies[0]!.abilities=[13];c.enemies[0]!.ai=syntheticAI([['Nop'],['SyncAI'],['StartTable',[0]],['FinalAttackAct',[13],[100]],['Act',[13]],['EndTable'],['JumpBattleAI',[0]]]);
  const b=new BattleGame(c,314);assert(b.command(b.players[0]!.id,901,b.enemies[0]!.id));until(b,()=>b.action?.source.id===901&&b.action.resolved);
  assert.equal(b.enemies[0]!.hp,0);assert.equal(b.finalAttackExecution.length,0);assert(!b.pendingActions.some(a=>a.kind==='final'));
});
test('explicit type5 respects the pending reaction gate and cancels a reaction-free wake without inventing Final readiness',()=>{
  for(const reactionRequired of [true,false]){
    const {c}=content(3);c.enemies[0]!.abilities=[13];
    if(!reactionRequired)c.reactions.excludedAbilityIds.push(901);
    c.enemies[0]!.ai=syntheticAI([['Nop'],['SyncAI'],['StartTable',[0]],['VariableAssign',[0,91]],
      ['Act',[13]],['Blank'],['JumpBattleAI',[4]],['FinalAttackAct',[13]],['EndTable'],['JumpBattleAI',[0]]]);
    const b=new BattleGame(c,314),enemy=b.enemies[0]!;enemy.atb=100;
    assert(b.command(b.players[0]!.id,901,enemy.id));until(b,()=>b.action?.source.id===901&&b.action.elapsed===390);
    assert(b.enemyAIState(enemy.id)!.continuation);assert.equal(enemy.behavior!.variables[0],0);
    if(reactionRequired){
      const before=snapshot(b),wake=structuredClone(b.enemyAIState(enemy.id));
      assert.throws(()=>b.advance(10),/pending wake received an action/);
      assert.deepEqual(snapshot(b),before);assert.deepEqual(b.enemyAIState(enemy.id),wake);
      continue;
    }
    b.advance(10);assert.equal(enemy.hp,0);assert(enemy.conditionIds.includes(1505));
    assert.equal(b.finalAttackExecution.length,0);assert(!b.pendingActions.some(a=>a.kind==='final'));
    b.advance(10);assert.equal(b.enemyAIState(enemy.id)!.continuation,undefined);
    assert.equal(enemy.behavior!.variables[0],0);assert.equal(enemy.queued,false);
  }
});
test('Leviteto application reuses its actual enemy-only lifecycle and never grants the unported player renderer',()=>{
  const f=levitateFixture(),a=ordinaryConditionSource();for(const table of ['ability.csv','function.csv','function_group.csv','content.csv','content_flag_group.csv','chanting.csv','battle_effect_asset.csv','se_asset.csv']){
    f.tables[table]=['battle_effect_asset.csv','se_asset.csv'].includes(table)?[...new Map([...(f.tables[table]??[]),...a.tables[table]!].map(row=>[row.id,row])).values()]:a.tables[table]!;
  }
  Object.assign(a.ability,{condition_group_id:'0',type_id:'1',system_id:'2'});a.group.function1_value1='196';
  const definition=compileBattleAbilityContent(f.reader(),f.tables,key=>key).abilities[901]!;assert(definition.plan,definition.blockers.join('; '));
  const {c}=content(3);c.conditions=f.compile().catalog;c.abilities[901]=definition;
  const b=new BattleGame(c,3),actor=b.players[0]!,enemy=b.enemies[0]!;const draws=()=>0;
  const enemyResult=projectActionTarget(definition.plan!,0,actor,enemy,b.conditions,draws,1);assert(enemyResult.state.conditionIds.includes(196));
  assert.throws(()=>projectActionTarget(definition.plan!,0,actor,b.players[1]!,b.conditions,draws,1),/Player.*Leviteto/);
});
