import test from 'node:test';import assert from 'node:assert/strict';
import {ordinaryConditionSource,ordinaryConditionContent} from './fixtures/ordinary-condition-action.js';
import {BattleGame} from '../src/core/battle.js';import {projectActionTargets} from '../src/core/action-user-conditions.js';
import {compileOrdinaryConditionAction} from '../src/compiler/ordinary-condition-action.js';
import {validateOrdinaryConditionAction} from '../src/core/ordinary-condition-action.js';
import {syntheticAI} from './fixtures/battle-ai.js';
const snap=(b:BattleGame)=>structuredClone({units:b.combatants,time:b.time,action:b.action,pending:b.pendingActions,event:b.eventExecution,random:Reflect.get(b,'randomState'),events:b.events});
function until(b:BattleGame,p:()=>boolean){for(let i=0;i<2000&&!p();i++)b.advance(10);assert(p());}
test('ordinary direct/group status carriers retain complete functions, flags, row order, Chanting and deferred asset bindings',()=>{
 for(const fn of [9,11,12]as const)for(const type of [1,9,13,637]){const f=ordinaryConditionSource(fn,'silence',type),out=f.compileAbility(),a=out.abilities[901]!;
  assert(a.plan,a.blockers.join(';'));validateOrdinaryConditionAction(a);assert.equal(a.ordinaryConditionPresentation!.functionType,fn);assert.equal(a.presentation,'source-effect-deferred');
  assert.deepEqual(a.program.contentFlags,fn===9?[3]:[1,3]);assert(out.entries[901]!.sources.some(s=>s.assetPath.endsWith('/se_asset.csv')));
  if(fn===12)assert.deepEqual(a.ordinaryConditionPresentation!.conditionIds,[6,6,1907,1999]);
 }
});
test('missing or changed source dependencies never acquire new carrier admission',()=>{
 for(const change of [(f:ReturnType<typeof ordinaryConditionSource>)=>{f.tables['se_asset.csv']=[];},
  (f:ReturnType<typeof ordinaryConditionSource>)=>{f.tables['chanting.csv']=[];},
  (f:ReturnType<typeof ordinaryConditionSource>)=>{f.group.function2_id='809';f.group.function2_value1='6';},
  (f:ReturnType<typeof ordinaryConditionSource>)=>{f.group.function1_value3='1';},
  (f:ReturnType<typeof ordinaryConditionSource>)=>{f.ability.data_a='1';},
  (f:ReturnType<typeof ordinaryConditionSource>)=>{f.ability.battle_renge_id='16';},
  (f:ReturnType<typeof ordinaryConditionSource>)=>{f.ability.type_id='999';},
  (f:ReturnType<typeof ordinaryConditionSource>)=>{f.group.function1_value1='1999';},
  (f:ReturnType<typeof ordinaryConditionSource>)=>{f.group.function1_value1='5';f.tables['condition.csv']!.find(row=>row.id==='5')!.game_over_target='0';},
  (f:ReturnType<typeof ordinaryConditionSource>)=>{f.tables['content_flag_group.csv']![0]!.content_flag_id='4';}]){
  const f=ordinaryConditionSource();change(f);const a=f.compileAbility().abilities[901]!;assert.equal(a.plan,null);assert(a.blockers.length);
 }
 const f=ordinaryConditionSource(),a=f.compileAbility().abilities[901]!;
 for(const change of [(p:typeof a.program)=>{p.rules.reaction_type=1;},(p:typeof a.program)=>{p.functions=[];},
  (p:typeof a.program)=>{p.contentFlags=[];},(p:typeof a.program)=>{p.process.values[0]=1;}]){
  const p=structuredClone(a.program);change(p);assert.throws(()=>compileOrdinaryConditionAction(f.reader(),p,a.plan!.effects[0]!),/Changed|Unresolved|changed/);
 }
});
test('new ordinary Sleep and Confusion inputs use the existing live control owner and cannot acquire its policy from absence',()=>{
 for(const kind of ['sleep','confusion']as const){
  const missing=ordinaryConditionContent(9,kind);delete missing.content.conditionControlPolicy;const rejected=new BattleGame(missing.content,314);
  assert(rejected.command(rejected.players[0]!.id,901,rejected.enemies[0]!.id));until(rejected,()=>rejected.action?.elapsed===390);const before=snap(rejected);assert.throws(()=>rejected.advance(10),/explicit Web condition-control/);assert.deepEqual(snap(rejected),before);
  const {content,source}=ordinaryConditionContent(9,kind),b=new BattleGame(content,314),a=b.players[0]!,t=b.enemies[0]!;assert(b.command(a.id,901,t.id));until(b,()=>Boolean(b.action?.resolved));assert(t.conditionIds.includes(source.conditionId));assert.equal(b.controlClockState(t.id).length,1);const mp=a.mp;b.advance(10);assert.equal(a.mp,mp);assert(t.conditionIds.includes(source.conditionId));
 }
});
test('ordinary Fn9 uses one evasion draw, respects resistance key presence and keeps fixed hit distinct from resistance bypass',()=>{
 const {content}=ordinaryConditionContent(),b=new BattleGame(content,314),a=b.players[0]!,t=b.enemies[0]!,p=b.content.abilities[901]!.plan!,draws:number[]=[];
 const run=()=>projectActionTargets(p,0,a,[t],b.conditions,(min)=>{draws.push(min);return min;},2);
 t.magicEvasion=255;const miss=run();assert.equal(miss.targets[0]!.effects[0]!.missed,true);assert.equal(draws.length,1);assert.deepEqual(t.conditionIds,[]);
 t.magicEvasion=0;draws.length=0;t.conditionResistances={6:0};assert.equal(run().targets[0]!.effects[0]!.missed,true);assert.equal(draws.length,0);
 const first=p.effects[0]!;assert.equal(first.kind,'add-condition');if(first.kind!=='add-condition')throw Error('shape');first.fixedHit=true;
 assert.deepEqual(run().targets[0]!.state.conditionIds,[6]);assert.equal(draws.length,0);t.conditionResistances={6:1};assert.equal(run().targets[0]!.effects[0]!.missed,true);
});
test('group removal preserves source order/repeats, removes only requested records and never activates unsupported references',()=>{
 const {content}=ordinaryConditionContent(12),b=new BattleGame(content,314),a=b.players[0]!,t=b.enemies[0]!;t.conditionIds=[6,1907];const before=structuredClone(t);
 const p=projectActionTargets(content.abilities[901]!.plan!,0,a,[t],b.conditions,()=>{throw Error('removal cannot draw');},2);
 assert.deepEqual(p.targets[0]!.effects[0],{slot:1,resource:'condition',recovery:true,added:[],removed:[6,1907],missed:false});assert.deepEqual(p.targets[0]!.state.conditionIds,[]);assert.deepEqual(t,before);
 t.conditionIds=[1999];assert.throws(()=>projectActionTargets(content.abilities[901]!.plan!,0,a,[t],b.conditions,()=>0),/Unimplemented active/);
});
test('absent single/group recovery is native Miss2, draws no RNG and cannot wake a hit-only received-command counter',()=>{
 for(const fn of [11,12]as const){const {content}=ordinaryConditionContent(fn),b=new BattleGame(content,314),a=b.players[0]!,t=b.enemies[0]!;
  const p=projectActionTargets(content.abilities[901]!.plan!,0,a,[t],b.conditions,()=>{throw Error('recovery must not draw');},2);assert.equal(p.targets[0]!.effects[0]!.missed,true);assert.deepEqual(p.targets[0]!.state.conditionIds,[]);
  const bad=structuredClone(content.abilities[901]!.plan!);Reflect.set(bad.effects[0]!,'recoveryHit','unknown');assert.throws(()=>projectActionTargets(bad,0,a,[t],b.conditions,()=>0),/recovery Hit policy/);
  const source=ordinaryConditionContent(fn);source.content.enemies[0]!.ai=syntheticAI([['Nop'],['SyncAI'],['StartTable',[0]],['Act',[13]],['CounterActReceiveCommand',[1,13],[0,100]],['EndTable'],['JumpBattleAI',[0]]]);
  const game=new BattleGame(source.content,314);source.content.abilities[13]!.plan=null;assert(game.command(game.players[0]!.id,901,game.enemies[0]!.id));until(game,()=>Boolean(game.action?.resolved));assert.equal(game.action!.results[0]!.effects[0]!.missed,true);assert.equal(game.players[0]!.mp,6);assert.equal(game.pendingActions.length,0);
 }
});
test('manual ordinary spell pays once, publishes a real status result and a later missing declaration rolls back before retry',()=>{
 const {content}=ordinaryConditionContent(),b=new BattleGame(content,314),a=b.players[0]!,t=b.enemies[0]!;assert(b.command(a.id,901,t.id));until(b,()=>b.action?.elapsed===390);
 const value=content.abilities[901]!.ordinaryConditionPresentation;delete content.abilities[901]!.ordinaryConditionPresentation;const before=snap(b);assert.throws(()=>b.advance(10),/Missing ordinary/);assert.deepEqual(snap(b),before);
 content.abilities[901]!.ordinaryConditionPresentation=value!;b.advance(10);assert.equal(a.mp,6);assert.deepEqual(t.conditionIds,[6]);assert.equal(b.action!.results[0]!.effects[0]!.resource,'condition');b.advance(10);assert.equal(a.mp,6);
});
test('late reaction failure rolls back condition, fee, random stream and action before one successful retry',()=>{
 const {content}=ordinaryConditionContent();content.enemies[0]!.ai=syntheticAI([['Nop'],['SyncAI'],['StartTable',[0]],['Act',[13]],['CounterActReceiveCommand',[1,13],[0,100]],['EndTable'],['JumpBattleAI',[0]]]);const b=new BattleGame(content,314),a=b.players[0]!,t=b.enemies[0]!;
 assert(b.command(a.id,901,t.id));until(b,()=>b.action?.elapsed===390);const plan=content.abilities[13]!.plan;content.abilities[13]!.plan=null;const before=snap(b);
 assert.throws(()=>b.advance(10),/unimplemented ability/);assert.deepEqual(snap(b),before);content.abilities[13]!.plan=plan;b.advance(10);assert.equal(a.mp,6);assert.deepEqual(t.conditionIds,[6]);
});
test('normal enemy AI reaches the same source status carrier without a manual grant',()=>{
 const {content}=ordinaryConditionContent();content.initialAtb={player:[0,0],enemy:[100,100]};content.enemies[0]!.abilities=[901];content.enemies[0]!.ai=syntheticAI([['Nop'],['SyncAI'],['StartTable',[0]],['Act',[901]],['EndTable'],['JumpBattleAI',[0]]]);
 const b=new BattleGame(content,314);until(b,()=>b.action?.actor===b.enemies[0]!.id&&b.action.resolved);assert.equal(b.action!.kind,'normal');assert.equal(b.enemies[0]!.mp,18);assert(b.players.some(p=>p.conditionIds.includes(6)));
});
test('derived AI status child uses the same condition owner with zero child cost and one result',()=>{
 const {content,source}=ordinaryConditionContent();source.ability.use_value='0';content.abilities[901]=source.compileAbility().abilities[901]!;
 const parent=structuredClone(content.abilities[13]!);parent.id=15;parent.program.abilityId=15;parent.power=0;parent.wait=0;parent.program.range=7;
 parent.plan!.effects=[{kind:'random-ability',slot:1,rawValues:[46,0,1],groupId:46,fallbackAbilityId:0,retarget:true,rows:[{rowId:1171,abilityId:901,invocationRate:100,conditionGroupId:0,conditionIds:[]}],primaryResult:{hitType:0,value:0},child:{actType:5,useType:1,commandId:null,armType:0,actAbilityType:0,continuousCommandCount:1,isCounter:false}}];
 content.abilities[15]=parent;content.enemies[0]!.abilities=[15,901];content.enemies[0]!.ai=syntheticAI([['Nop'],['SyncAI'],['StartTable',[0]],['Act',[15]],['EndTable'],['JumpBattleAI',[0]]]);content.initialAtb={player:[0,0],enemy:[100,100]};
 const b=new BattleGame(content,314);until(b,()=>b.action?.kind==='derived'&&b.action.resolved);assert.equal(b.action!.source.id,901);assert.equal(b.action!.results.length,1);assert.equal(b.enemies[0]!.mp,20);assert(b.players.some(p=>p.conditionIds.includes(6)));
});
