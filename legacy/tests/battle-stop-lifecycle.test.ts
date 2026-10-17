import test from 'node:test';import assert from 'node:assert/strict';
import {BattleGame} from '../src/core/battle.js';import {syntheticAI} from './fixtures/battle-ai.js';
import {stopConditionContent,stopConditionSource} from './fixtures/stop-condition.js';
const until=(b:BattleGame,p:()=>boolean)=>{for(let i=0;i<10000&&!p();i++)b.advance(10);assert(p());};
function cast(b:BattleGame,id:number,target='a',caster='b'){
 until(b,()=>!b.action);const actor=b.combatants.find(a=>a.id===caster)!;actor.atb=100;
 assert(b.command(caster,id,target));until(b,()=>b.action?.source.id===id&&b.action.resolved);
}
const snap=(b:BattleGame)=>structuredClone({units:b.combatants,action:b.action,pending:b.pendingActions,
 poison:b.combatants.map(a=>[a.id,b.conditionClockState(a.id)]),control:b.combatants.map(a=>[a.id,b.controlClockState(a.id)]),
 time:b.time,random:Reflect.get(b,'randomState'),events:b.events,tickets:b.actionExecutor});
test('Stop Start preserves a bare ATB gauge; Remove resets only its owner and releases readiness',()=>{
 const {content}=stopConditionContent(),b=new BattleGame(content,314),a=b.players[0]!;a.atb=46;
 cast(b,901);assert.equal(a.atb,46);assert(b.isStopped(a.id));assert(!b.ready.some(p=>p.id===a.id));assert(!b.canUse(a.id,10));assert(!b.command(a.id,10,'e1'));
 cast(b,902);assert(!b.isStopped(a.id));assert.equal(a.atb,0);assert.equal(b.controlClockState(a.id).length,0);
});
test('actual ready work cancels its matching pending ticket without cost; another owner survives',()=>{
 const {content}=stopConditionContent();content.abilities[10]!.wait=500;const b=new BattleGame(content,314),a=b.players[0]!;
 assert(b.command(a.id,10,'e1'));const pending=b.pendingActions.find(p=>p.actor===a.id)!;assert(pending);const mp=a.mp;
 cast(b,901);assert.equal(a.mp,mp);assert.equal(a.atb,0);assert(!a.queued);assert(!b.pendingActions.some(p=>p.actor===a.id));
 assert(b.action?.resolved);assert.equal(b.action!.actor,'b');assert(!b.actionExecutor.fixedPlayerActions.some(p=>p.ticket===pending.executionTicket));
});
test('lone interrupt is retained while Stop blocks execution; Remove releases it without replaying its old fee',()=>{
 const {content}=stopConditionContent(),b=new BattleGame(content,314),a=b.players[0]!;
 // A controlled interrupt is prepared through the same real action factory/
 // registration path. No source instruction, source PC or production owner is patched.
 const action=Reflect.get(b,'createAction').call(b,a,content.abilities[10],b.targetChoices(a.id,10)[0],100,'counter');
 Reflect.get(b,'registerActions').call(b,[action]);Reflect.get(b,'reactions').push(action);
 // Keep the pending interrupt behind an already staged ordinary Stop action.
 assert(b.command('b',901,'a'));const ordinary=Reflect.get(b,'queue').shift();Reflect.set(b,'action',ordinary);
 until(b,()=>b.action?.resolved===true);assert.equal(a.atb,100);assert(b.pendingActions.some(p=>p.executionTicket===action.executionTicket));
 b.advance(500);assert(b.pendingActions.some(p=>p.executionTicket===action.executionTicket));assert.equal(a.mp,200);
 cast(b,902);until(b,()=>b.action?.kind==='counter'&&b.action.resolved);assert.equal(a.mp,200-content.abilities[10]!.cost);
});
test('Stop writes existing Poison instances, freezes progress and Remove resumes without restarting interval',()=>{
 const {content}=stopConditionContent(),b=new BattleGame(content,314);cast(b,903);b.advance(700);cast(b,901);
 const clock=b.conditionClockState('a')[0]!;assert(clock.isTimeStop);b.advance(2500);assert.deepEqual(b.conditionClockState('a'),[clock]);
 cast(b,902);const resumed=b.conditionClockState('a')[0]!;assert(!resumed.isTimeStop);assert.equal(resumed.thresholdSeconds,clock.thresholdSeconds);assert(resumed.elapsedSeconds>=clock.elapsedSeconds);
 b.advance(100);assert(b.conditionClockState('a')[0]!.elapsedSeconds>resumed.elapsedSeconds);
});
test('Poison added/re-added after Stop is a new instance and never inherits the retired pause',()=>{
 const {content}=stopConditionContent(),b=new BattleGame(content,314);cast(b,901);cast(b,903);
 assert(!b.conditionClockState('a')[0]!.isTimeStop);const first=b.conditionClockState('a')[0]!.elapsedSeconds;b.advance(100);assert(b.conditionClockState('a')[0]!.elapsedSeconds>first);
 cast(b,904);assert.deepEqual(b.conditionClockState('a'),[]);cast(b,903);assert(!b.conditionClockState('a')[0]!.isTimeStop);
});
test('Sleep and Stop keep independent action contributions; curing Stop resumes Poison but cannot wake Sleep',()=>{
 const {content}=stopConditionContent(),b=new BattleGame(content,314);cast(b,903);cast(b,905);cast(b,901);assert(b.conditionClockState('a')[0]!.isTimeStop);
 cast(b,902);assert(!b.isStopped('a'));assert(!b.conditionClockState('a')[0]!.isTimeStop);assert(b.players[0]!.conditionIds.includes(2907));assert(!b.canUse('a',10));
 cast(b,906);assert(!b.players[0]!.conditionIds.includes(2907));b.players[0]!.atb=100;assert(b.canUse('a',10));
});
test('duplicate Stop is Miss and retains the existing timer, while natural removal resets ATB',()=>{
 const {content}=stopConditionContent(2),b=new BattleGame(content,314);cast(b,901);const first=b.controlClockState('a')[0]!.recovery.elapsedSeconds;
 cast(b,901);assert(b.action!.results[0]!.effects[0]!.missed);assert(b.controlClockState('a')[0]!.recovery.elapsedSeconds>first);
 b.players[0]!.atb=76;until(b,()=>!b.isStopped('a'));assert.equal(b.players[0]!.atb,0);
});
test('a later action failure restores Stop/Poison/tickets/RNG and the paid prior frame remains committed',()=>{
 const {content}=stopConditionContent(),b=new BattleGame(content,314);cast(b,903);until(b,()=>!b.action);b.players[1]!.atb=100;assert(b.command('b',901,'a'));until(b,()=>b.action?.elapsed===390);
 const initial=content.abilities[901]!.ordinaryConditionPresentation;delete content.abilities[901]!.ordinaryConditionPresentation;
 const before=snap(b);assert.throws(()=>b.advance(10),/Missing ordinary/);assert.deepEqual(snap(b),before);
 content.abilities[901]!.ordinaryConditionPresentation=initial!;b.advance(0);assert(b.isStopped('a'));assert(b.conditionClockState('a')[0]!.isTimeStop);
 const paid=b.players[1]!.mp,owner=snap(b),advance=Reflect.get(b,'advanceEvent');Reflect.set(b,'advanceEvent',()=>{throw Error('authored later failure');});
 assert.throws(()=>b.advance(10),/authored later failure/);assert.deepEqual(snap(b),owner);assert.equal(b.players[1]!.mp,paid);Reflect.set(b,'advanceEvent',advance);b.advance(0);assert.equal(b.players[1]!.mp,paid);
});
test('normal AI and derived child use the ordinary Stop owner, with zero duplicate child fees',()=>{
 for(const derived of[false,true]){const {content}=stopConditionContent(),stop=content.abilities[901]!;stop.cost=0;
  let id=901;if(derived){const parent=structuredClone(content.abilities[13]!);id=15;parent.id=id;parent.program.abilityId=id;parent.power=0;parent.wait=0;parent.program.range=7;
   parent.plan!.effects=[{kind:'random-ability',slot:1,rawValues:[46,0,1],groupId:46,fallbackAbilityId:0,retarget:true,rows:[{rowId:1171,abilityId:901,invocationRate:100,conditionGroupId:0,conditionIds:[]}],primaryResult:{hitType:0,value:0},child:{actType:5,useType:1,commandId:null,armType:0,actAbilityType:0,continuousCommandCount:1,isCounter:false}}];content.abilities[id]=parent;}
  content.enemies[0]!.abilities=[id,901];content.enemies[0]!.ai=syntheticAI([['Nop'],['SyncAI'],['StartTable',[0]],['Act',[id]],['EndTable'],['JumpBattleAI',[0]]]);content.initialAtb={player:[0,0],enemy:[100,100]};
  const b=new BattleGame(content,314);until(b,()=>b.action?.source.id===901&&b.action.resolved);assert.equal(b.action!.kind,derived?'derived':'normal');assert(b.players.some(p=>b.isStopped(p.id)));assert.equal(b.enemies[0]!.mp,200);
 }
});
test('a different actor eligible interrupt keeps priority ahead of the ordinary recovery action',()=>{
 const {content}=stopConditionContent(),b=new BattleGame(content,314);cast(b,901);until(b,()=>!b.action);
 const a=b.players[0]!,e=b.enemies[0]!,factory=Reflect.get(b,'createAction'),register=Reflect.get(b,'registerActions');
 const suspended=factory.call(b,a,content.abilities[10],{selection:{kind:'single',id:e.id},targetIds:[e.id]},100,'counter'),
  eligible=factory.call(b,e,content.abilities[13],{selection:{kind:'single',id:'b'},targetIds:['b']},null,'counter');
 register.call(b,[suspended,eligible]);Reflect.get(b,'reactions').push(suspended,eligible);b.players[1]!.atb=100;assert(b.command('b',902,'a'));
 b.advance(10);assert.equal(b.action!.executionTicket,eligible.executionTicket);assert(b.pendingActions.some(p=>p.executionTicket===suspended.executionTicket));assert(b.pendingActions.some(p=>p.source.id===902));
 until(b,()=>b.action?.source.id===902&&b.action.resolved);assert(!b.isStopped('a'));until(b,()=>Boolean(b.action&&b.action.executionTicket===suspended.executionTicket&&b.action.resolved));
});
test('Stop pauses Doom through its own source predicate while Slow and independent recovery time continue',()=>{
 const {content}=stopConditionContent();content.players[0]!.conditionIds=[125];
 content.conditions.rules.definitions.push({id:9904,type:404,overlapped:false,eraseGroupId:1});
 content.conditions.behaviors.push({id:9904,kind:'doom',name:'Doom',untilType:2,untilValue:1,pauseConditionTypes:[17,627,11]});
 const doom=structuredClone(content.abilities[903]!);doom.id=907;doom.program.abilityId=907;doom.plan!.effects=[{slot:1,kind:'add-condition',conditionId:9904,fixedHit:true,accuracy:255}];
 content.abilities[907]=doom;content.players[1]!.abilities.push(907);content.commands[100]!.abilityIds.push(907);
 const b=new BattleGame(content,314);cast(b,907);cast(b,901);const clock=b.controlClockState('a').find(c=>c.recovery.conditionId===9904)!.doom!,slow=b.slowClockState('a')[0]!.elapsedSeconds;
 b.advance(3000);assert.deepEqual(b.controlClockState('a').find(c=>c.recovery.conditionId===9904)!.doom,clock);assert(b.slowClockState('a')[0]!.elapsedSeconds>slow);assert(b.controlClockState('a').find(c=>c.recovery.conditionId===1907)!.recovery.elapsedSeconds<0);assert(b.players[0]!.hp>0);
});
test('whole Function12 recovery preserves ordered source references and retires both Stop and Poison clocks',()=>{
 const {content}=stopConditionContent(),group=stopConditionSource(12);group.ability.id='907';group.tables['content.csv']![0]!.type_value='907';content.abilities[907]=group.compileAbility().abilities[907]!;
 content.players[1]!.abilities.push(907);content.commands[100]!.abilityIds.push(907);const b=new BattleGame(content,314);cast(b,903);cast(b,901);assert(b.conditionClockState('a')[0]!.isTimeStop);
 cast(b,907);assert.deepEqual(b.action!.results[0]!.effects[0],{slot:1,resource:'condition',recovery:true,added:[],removed:[1907,110],missed:false});assert.deepEqual(b.controlClockState('a'),[]);assert.deepEqual(b.conditionClockState('a'),[]);assert.equal(b.players[0]!.atb,0);
});
