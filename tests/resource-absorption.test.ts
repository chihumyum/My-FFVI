import test from 'node:test';import assert from 'node:assert/strict';
import {absorptionSource,absorptionContent} from './fixtures/resource-absorption.js';
import {BattleGame} from '../src/core/battle.js';
import {projectActionTargets} from '../src/core/action-user-conditions.js';
import {resourceAbsorptionEffect} from '../src/core/resource-absorption.js';
import {syntheticAI} from './fixtures/battle-ai.js';
import {battleReaction} from '../src/core/battle-reactions.js';
function game(resource:'hp'|'mp'='hp',calculation:'magic'|'physical'='magic'){return new BattleGame(absorptionContent(resource,calculation),314);}
function projection(resource:'hp'|'mp'='hp',calculation:'magic'|'physical'='magic'){
 const b=game(resource,calculation),a=b.players[0]!,t=b.enemies[0]!,p=b.content.abilities[901]!.plan!,draws:[number,number][]=[];
 a.hp=10;a.mp=3;t.hp=15;t.mp=7;
 const random=(min:number,max:number)=>{draws.push([min,max]);return min;};
 const run=(cost=0)=>projectActionTargets(p,30,a,[t],b.conditions,random,cost,
  calculation==='physical'?()=>({actor:'front',target:'front',ignoreActorPenalty:false,ignoreTargetPenalty:false}):undefined,
  901,{kind:'source-non-reversing-absorption-v1',actorId:a.id,targetId:t.id});
 return {b,a,t,p,draws,run};
}
const snap=(b:BattleGame)=>structuredClone({units:b.combatants,action:b.action,queue:b.pendingActions,random:Reflect.get(b,'randomState'),events:b.events,event:b.eventExecution,clock:b.time});
function until(b:BattleGame,p:()=>boolean){for(let i=0;i<2000&&!p();i++)b.advance(10);assert(p());}
test('two native slots retain complete source dispatch, ForAiType, effect and sound dependencies',()=>{
 for(const resource of ['hp','mp']as const)for(const calculation of ['magic','physical']as const){
  const f=absorptionSource(resource,calculation),out=f.compile(),a=out.abilities[901]!;assert(a.plan,a.blockers.join('; '));
  assert.equal(a.program.functions.length,2);assert.equal(a.program.functions[1]!.type,13);assert.equal(a.presentation,'source-effect-deferred');
  const e=resourceAbsorptionEffect(a.plan)!;assert.equal(e.resource,resource);assert.equal(e.calculation,calculation);
  assert.equal(out.report.boundedHostPlans,1);assert(out.entries[901]!.sources.some(s=>s.assetPath.endsWith('/se_asset.csv')));
 }
 for(const mutate of [(f:ReturnType<typeof absorptionSource>)=>{f.group.function2_value1='2';},
  (f:ReturnType<typeof absorptionSource>)=>{f.group.function2_value2='50';},
  (f:ReturnType<typeof absorptionSource>)=>{f.group.function2_value3='1';},
  (f:ReturnType<typeof absorptionSource>)=>{f.tables['chanting.csv']=[];},
  (f:ReturnType<typeof absorptionSource>)=>{f.tables['se_asset.csv']=[];},
  (f:ReturnType<typeof absorptionSource>)=>{f.group.function3_id='813';},
  (f:ReturnType<typeof absorptionSource>)=>{f.ability.process_prog='unknown';}]){
  const f=absorptionSource();mutate(f);const a=f.compile().abilities[901]!;assert.equal(a.plan,null);assert(a.blockers.length);
 }
});
test('HP return clips to both actual target resource and caster deficit without a second calculator or RNG stream',()=>{
 const h=projection(),before=structuredClone([h.a,h.t]),r=h.run();assert.equal(r.targets[0]!.state.hp,0);assert.equal(r.userResourceState!.hp,25);
 assert.equal(r.targets[0]!.effects[0]!.resource,'hp');assert.equal(r.userResourceResults![0]!.amount,15);assert.equal(h.draws.length,2);assert.deepEqual([h.a,h.t],before);
 h.draws.length=0;h.a.hp=h.a.maxHp-2;const limited=h.run();assert.equal(limited.targets[0]!.state.hp,13);assert.equal(limited.userResourceState!.hp,h.a.maxHp);assert.equal(h.draws.length,2);
});
test('MP calculation sees the one paid resource draft; full and zero-resource results still follow the source RNG calls',()=>{
 const h=projection('mp');h.a.mp=h.a.maxMp;const paid=h.run(2);assert.equal(paid.userResourceState!.mp,h.a.maxMp);assert.equal(paid.targets[0]!.state.mp,5);assert.equal(paid.userResourceResults![0]!.amount,2);assert.equal(h.draws.length,2);
 h.draws.length=0;const full=h.run();assert.equal(full.targets[0]!.state.mp,7);assert.equal(full.userResourceResults![0]!.amount,0);assert.equal(Reflect.get(full.targets[0]!.effects[0]!,'nullified'),true);assert.equal(h.draws.length,2);
 h.a.mp=0;h.t.mp=0;h.draws.length=0;const empty=h.run();assert.equal(empty.userResourceState!.mp,0);assert.equal(empty.userResourceResults![0]!.amount,0);assert.equal(h.draws.length,2);
});
test('misses and elemental immunity transfer no resource; element-reversed and unbound scopes fail before random use',()=>{
 const h=projection();h.p.magic!.accuracy=0;h.t.magicEvasion=255;const miss=h.run();assert(miss.targets[0]!.effects[0]!.missed);assert.equal(miss.userResourceResults![0]!.amount,0);assert.equal(h.draws.length,1);
 const immune=projection();immune.p.magic!.elements=[1];immune.t.elementResistances={1:3};const zero=immune.run();assert.equal(zero.userResourceResults![0]!.amount,0);assert(Reflect.get(zero.targets[0]!.effects[0]!,'nullified'));
 const reverse=projection();reverse.p.magic!.elements=[1];reverse.t.elementResistances={1:4};assert.throws(()=>reverse.run(),/element-reversed/);assert.equal(reverse.draws.length,0);
 assert.throws(()=>projectActionTargets(reverse.p,30,reverse.a,[reverse.t],reverse.b.conditions,()=>{throw Error('random');}),/non-reversing/);
});
test('physical MP absorption reuses the physical row/accuracy inputs and the same compound resource owner',()=>{
 const h=projection('mp','physical'),r=h.run();assert.equal(r.targets[0]!.state.hp,h.t.hp);assert(r.targets[0]!.state.mp<h.t.mp);assert(r.userResourceState!.mp>h.a.mp);assert.equal(r.targets[0]!.effects[0]!.resource,'mp');
 const original=structuredClone(h.p);h.p.effects[1]!.kind='unknown'as never;assert.throws(()=>projectActionTargets(h.p,30,h.a,[h.t],h.b.conditions,()=>0),/Unimplemented/);assert.notDeepEqual(h.p,original);
});
test('self targeting shares the paid instance and returns exactly the same HP/MP owner',()=>{
 const h=projection('mp');const r=projectActionTargets(h.p,30,h.a,[h.a],h.b.conditions,()=>0,2,undefined,901,
  {kind:'source-non-reversing-absorption-v1',actorId:h.a.id,targetId:h.a.id});
 assert.equal(r.targets[0]!.state.mp,h.a.mp-2);assert.equal(r.userResourceState!.mp,h.a.mp-2);assert.equal(r.targets[0]!.state.hp,h.a.hp);
 const hp=projection();const self=projectActionTargets(hp.p,30,hp.a,[hp.a],hp.b.conditions,()=>0,0,undefined,901,
  {kind:'source-non-reversing-absorption-v1',actorId:hp.a.id,targetId:hp.a.id});
 assert.equal(self.userResourceState!.hp,hp.a.hp);assert.equal(self.targets[0]!.state.hp,hp.a.hp);
 assert.equal(hp.b.conditions.isUnableFight(self.userResourceState!.conditionIds),false);
});
test('ordinary queued actions publish target and caster once; caster recovery is not another receiver reaction',()=>{
 const b=game(),a=b.players[0]!,t=b.enemies[0]!;a.hp=10;t.hp=15;assert(b.canUse(a.id,901));assert(b.command(a.id,901,t.id));
 until(b,()=>b.action?.source.id===901&&b.action.resolved);assert.equal(a.hp,25);assert.equal(a.mp,6);assert.equal(t.hp,0);
 assert.equal(b.action!.results.length,1);assert.equal(b.action!.userResourceResults![0]!.ownerId,a.id);assert.equal(battleReaction(b.content.reactions,{actor:a.id,target:a.id,isCounter:false,abilityId:901,systemId:3,primarySlot:1,effects:b.action!.results[0]!.effects}),null);
 const resources=[a.hp,a.mp,t.hp];b.advance(100);assert.deepEqual([a.hp,a.mp,t.hp],resources);
});
test('missing/reversing source traits and a late policy change roll back the whole frame, including payment and RNG',()=>{
 for(const mode of ['missing','reverse','policy']as const){const b=game(),a=b.players[0]!,t=b.enemies[0]!;a.hp=10;t.hp=15;assert(b.command(a.id,901,t.id));until(b,()=>b.action?.source.id===901&&b.action.elapsed===390);
  let restore:()=>void;if(mode==='missing'){const old=t.conditionTraits;delete t.conditionTraits;restore=()=>{t.conditionTraits=old!;};}
  else if(mode==='reverse'){t.conditionTraits!.baseUndead=true;restore=()=>{t.conditionTraits!.baseUndead=false;};}
  else{const e=resourceAbsorptionEffect(b.content.abilities[901]!.plan!)!;e.presentation.kind='unknown'as never;restore=()=>{e.presentation.kind='web-source-resource-absorption-deferred-v1';};}
  const before=snap(b);assert.throws(()=>b.advance(10),/Undead|reverse-recovery|presentation policy/);assert.deepEqual(snap(b),before);restore();b.advance(10);assert.equal(a.hp,25);assert.equal(a.mp,6);b.advance(10);assert.equal(a.hp,25);
 }
});
test('reaction admission failure after both resource drafts preserves the old frame and retries each transfer once',()=>{
 const c=absorptionContent();c.enemies[0]!.ai=syntheticAI([['Nop'],['SyncAI'],['StartTable',[0]],['Act',[13]],['CounterAct',[13]],['EndTable'],['JumpBattleAI',[0]]]);c.enemies[0]!.abilities=[13];
 const b=new BattleGame(c,314),a=b.players[0]!,t=b.enemies[0]!;a.hp=10;t.hp=100;t.mp=8;assert(b.command(a.id,901,t.id));until(b,()=>b.action?.source.id===901&&b.action.elapsed===390);
 const old=b.content.abilities[13]!.plan;b.content.abilities[13]!.plan=null;const before=snap(b);assert.throws(()=>b.advance(10),/unimplemented ability/);assert.deepEqual(snap(b),before);b.content.abilities[13]!.plan=old;b.advance(10);assert(a.hp>10);assert.equal(a.mp,6);const transferred=a.hp;b.advance(10);assert.equal(a.hp,transferred);
});

test('enemy AI derived dispatch reaches the same MP transfer transaction without paying or executing the child twice',()=>{
 const c=absorptionContent('mp'),source=absorptionSource('mp');source.ability.use_value='0';c.abilities[901]=source.compile().abilities[901]!;
 const parent=structuredClone(c.abilities[13]!);parent.id=15;parent.program.abilityId=15;parent.power=0;parent.wait=0;parent.program.range=7;
 parent.plan!.effects=[{kind:'random-ability',slot:1,rawValues:[46,0,1],groupId:46,fallbackAbilityId:0,retarget:true,
  rows:[{rowId:1171,abilityId:901,invocationRate:100,conditionGroupId:0,conditionIds:[]}],primaryResult:{hitType:0,value:0},
  child:{actType:5,useType:1,commandId:null,armType:0,actAbilityType:0,continuousCommandCount:1,isCounter:false}}];
 c.abilities[15]=parent;c.enemies[0]!.abilities=[15,901];c.enemies[0]!.ai=syntheticAI([['Nop'],['SyncAI'],['StartTable',[0]],['Act',[15]],['EndTable'],['JumpBattleAI',[0]]]);
 c.initialAtb={player:[0,0],enemy:[100,100]};const b=new BattleGame(c,951);b.enemies[0]!.mp=0;until(b,()=>b.action?.kind==='derived'&&b.action.resolved);
 assert.equal(b.action!.source.id,901);assert.equal(b.action!.userResourceResults![0]!.resource,'mp');assert(b.enemies[0]!.mp>0);const amount=b.enemies[0]!.mp;b.advance(10);assert.equal(b.enemies[0]!.mp,amount);
});

test('ordinary enemy AI uses the physical MP calculator and its existing target/row path',()=>{
 const c=absorptionContent('mp','physical');c.initialAtb={player:[0,0],enemy:[100,100]};c.enemies[0]!.abilities=[901];
 c.enemies[0]!.ai=syntheticAI([['Nop'],['SyncAI'],['StartTable',[0]],['Act',[901]],['EndTable'],['JumpBattleAI',[0]]]);
 const b=new BattleGame(c,44);b.enemies[0]!.mp=3;until(b,()=>b.action?.actor===b.enemies[0]!.id&&b.action.resolved);
 assert.equal(b.action!.source.id,901);assert.equal(b.action!.kind,'normal');assert.equal(b.action!.results[0]!.effects[0]!.resource,'mp');assert(b.enemies[0]!.mp>1);
});
