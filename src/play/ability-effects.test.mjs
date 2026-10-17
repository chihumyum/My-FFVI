import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { executeAbilityEffects, setCondition, functionsFor, applyRecovery, abilityFromItem, tickConditions, conditionSpeed, periodicStatusInterval, periodicStatusAmount, forcedConditionAction, throwableCommands, applyWeaponEffects } from './ability-effects.js';
import { Battle, calculateDamage } from './battle.js';
import { auditAbilities } from '../../scripts/audit-play-abilities.mjs';
const data=JSON.parse(fs.readFileSync(new URL('../../build/play/battle.json',import.meta.url),'utf8'));
const unit=(props={})=>({hp:500,maxHp:1000,mp:40,maxMp:100,level:20,conditions:[],...props});
function fixture(){const actor=unit(),target=unit(),warnings=[];const host={data,elapsed:0,random:()=>0.25,players:[actor],enemies:[target],inventory:{},context:{},banks:{},
  warning:message=>warnings.push(message),addLog:()=>{},event:()=>{},alive:u=>u.hp>0,
  targetable:u=>u.hp>0&&!u.hidden&&!u.removed&&!u.escaped, selectAITargets:()=>[target],addEnemy:(id,slot)=>host.spawn={id,slot},
  perform:()=>{throw Error('unexpected child');},events:{beforeDamage:(_a,_t,_s,n)=>n}};
  const cast=id=>executeAbilityEffects(host,actor,target,data.abilities[id],1,{updateVariables:true},()=>({amount:80,missed:false,critical:false}));
  return {actor,target,host,warnings,cast};}

test('PR Runic ability11 adds condition57/type612 and removal or source death clears the armed state',()=>{
  const f=fixture();f.cast(11);assert.equal(f.target.runic,true);assert(f.target.conditions.includes(57));
  setCondition(f.host,f.target,57,false);assert.equal(f.target.runic,false);
  f.cast(11);assert.equal(f.target.runic,true);setCondition(f.host,f.target,5,true);assert.equal(f.target.runic,false);
});

test('Runic absorbs a PR flagged spell once, restores its cost and clears the source condition',()=>{
  const party=[{id:7,name:'Celes',hp:400,maxHp:500,mp:10,maxMp:100,abilities:[11]}];
  const battle=new Battle({data:{...data,eventPrograms:{},parties:{99999:{members:[{monsterId:1,slot:0}]}},
    monsters:{1:{id:1,name:'fixture',hp:1000,maxHp:1000}}},party,encounterId:99999,random:()=>0.25});
  party[0].ready=true;assert.equal(battle.choose(0,11,{side:'player',index:0}),true);
  assert.equal(party[0].runic,true);const before=party[0].hp;
  battle.perform(battle.enemies[0],party[0],data.abilities[40]);
  assert.equal(party[0].hp,before);assert.equal(party[0].mp,10+data.abilities[40].mp);
  assert.equal(party[0].runic,false);assert(!party[0].conditions.includes(57));
  battle.perform(battle.enemies[0],party[0],data.abilities[40]);assert(party[0].hp<before);
});

test('PR Throw ability10 cannot arm Runic or fabricate a weapon selection',()=>{
  const f=fixture(),requests=[];f.host.event=(kind,payload)=>requests.push({kind,payload});
  f.host.inventory={2:1};const before={hp:f.target.hp,mp:f.target.mp};f.cast(10);
  assert.equal(Boolean(f.actor.runic),false);assert.equal(Boolean(f.target.runic),false);
  assert.equal(f.target.hp,before.hp);assert.equal(f.target.mp,before.mp);assert.deepEqual(f.host.inventory,{2:1});
  assert.equal(requests[0].payload.kind,'throw');assert(f.warnings.some(s=>s.includes('owned weapon')));
});

test('PR current-HP gravity, missing-HP damage, White Wind and Heartless Angel have distinct effects',()=>{
  const f=fixture();f.target.hp=800;f.cast(56);assert.equal(f.target.hp,400);
  f.actor.hp=300;f.cast(148);assert.equal(f.target.hp,700); // White Wind restores caster current HP.
  f.cast(329);assert.equal(f.target.hp,1);assert.equal(f.target.mp,40);
  f.target.hp=900;f.cast(147);assert.equal(f.target.hp,200); // Revenge: maxHP-currentHP, no defense.
});

test('PR Phoenix Down group restores one eighth max HP; remove-group is not itself revival',()=>{
  const f=fixture();f.target.hp=0;f.target.conditions=[5];
  const item=abilityFromItem(data,data.items[9],10);
  assert.equal(item.revive,true);
  executeAbilityEffects(f.host,f.actor,f.target,item,1,{},()=>({amount:1}));
  assert.equal(f.target.hp,125);assert(!f.target.conditions.includes(5));
  const field=unit({hp:0,conditions:[5]});
  const result=applyRecovery(data,field,functionsFor(data,data.items[9].menu_function_group_id),{power:0});
  assert.equal(field.hp,125);assert.equal(result.revived,true);
});

test('petrification condition group grants resistance instead of applying every listed ailment',()=>{
  const f=fixture();f.target.conditions=[13,22];
  setCondition(f.host,f.target,11,true);
  assert.deepEqual(f.target.conditions,[13,11]); // type5 erase entries are preserved, not erased.
  assert.equal(setCondition(f.host,f.target,10,true),false);
  assert(!f.target.conditions.includes(10));assert.equal(f.target.hp,500);
});

test('source sleep erasure type6 rejects incoming silence; haste removes slow',()=>{
  const f=fixture();setCondition(f.host,f.target,7,true);
  assert.equal(setCondition(f.host,f.target,6,true),false);
  setCondition(f.host,f.target,25,true);assert.equal(conditionSpeed(data,f.target),0.5);
  setCondition(f.host,f.target,21,true);assert.equal(conditionSpeed(data,f.target),1.5);
  assert(!f.target.conditions.includes(25));assert(f.target.conditions.includes(21));
});

test('Function38 uses third operand for add/remove and always affects the caster',()=>{
  const f=fixture();const execute=values=>executeAbilityEffects(f.host,f.actor,f.target,{id:999,functions:[{id:38,values}]},1,{},()=>({amount:0}));
  execute([28,0,0]);assert(f.actor.conditions.includes(28));assert.deepEqual(f.target.conditions,[]);
  execute([28,0,1]);assert(!f.actor.conditions.includes(28));
  execute([28,1,0]);assert(f.actor.conditions.includes(28));
});

test('PR Rasp/function3 operand2 damages MP without dealing HP damage',()=>{
  const f=fixture();const before=f.target.hp;const result=f.cast(66);
  assert.equal(f.target.hp,before);assert.equal(f.target.mp,0);assert.equal(result.amount,0);assert.equal(result.mp,40);
});

test('PR MP drain affects MP and returns only the amount taken',()=>{
  const f=fixture();f.actor.mp=10;f.target.mp=25;f.cast(81);
  assert.equal(f.target.hp,500);assert.equal(f.target.mp,0);assert.equal(f.actor.mp,35);
});

test('Function20 uses PR monster ID and unique slot to summon; Humbaba Breath escapes its recipient',()=>{
  const f=fixture();f.cast(712);assert.deepEqual(f.host.spawn,{id:265,slot:6});
  f.cast(371);assert.equal(f.target.escaped,true);assert.equal(f.target.hidden,true);assert.equal(f.target.hp,500);
});

test('PR Reflect-question effects only afflict recipients with Reflect',()=>{
  const f=fixture();f.cast(152);assert.deepEqual(f.target.conditions,[]);
  setCondition(f.host,f.target,24,true);f.cast(152);
  for(const id of [9,6,25])assert(f.target.conditions.includes(id));
});

test('sleep expires and poison uses the retained PR divisor without changing MP',()=>{
  const f=fixture();setCondition(f.host,f.target,7,true);f.host.elapsed=31;tickConditions(f.host,f.target,0.1);
  assert(!f.target.conditions.includes(7));setCondition(f.host,f.target,10,true);
  tickConditions(f.host,f.target,8.6);assert.equal(f.target.hp,438);assert.equal(f.target.mp,40);
});

test('PR Image/type14 never creates a death clock; Doom/type404 uses its own countdown',()=>{
  const image=fixture();setCondition(image.host,image.target,19,true);
  assert.equal(data.conditions[19].condition_type,14);assert.equal(image.target.conditionUntil?.[19],undefined);
  image.host.elapsed=60;tickConditions(image.host,image.target,60);
  assert.equal(image.target.hp,500);assert(image.target.conditions.includes(19));assert(!image.target.conditions.includes(5));
  for(const id of [14,54]){
    const f=fixture(),duration=data.conditions[id].until_value;setCondition(f.host,f.target,id,true);
    assert.equal(data.conditions[id].condition_type,404);assert.equal(f.target.conditionUntil[id],duration);
    f.host.elapsed=duration-0.01;tickConditions(f.host,f.target,0.01);assert.equal(f.target.hp,500);
    f.host.elapsed=duration;tickConditions(f.host,f.target,0.01);assert.equal(f.target.hp,0);assert(f.target.conditions.includes(5));
  }
});

test('PR Fenrir Image dodges physical hits, can dissipate after that miss and never becomes Doom',()=>{
  const f=fixture();f.cast(105);assert(f.target.conditions.includes(19));
  f.host.random=()=>0.5;
  let calculations=0;const damage=()=>{calculations++;return {amount:80,missed:false,critical:false};};
  const strike=()=>executeAbilityEffects(f.host,f.actor,f.target,data.abilities[1],1,{},damage);
  let result=strike();assert.equal(result.hit,false);assert.equal(result.amount,0);assert.equal(calculations,0);
  assert(f.target.conditions.includes(19));f.host.elapsed=60;tickConditions(f.host,f.target,60);assert.equal(f.target.hp,500);
  f.host.random=()=>0;result=strike();assert.equal(result.hit,false);assert.equal(result.amount,0);
  assert(!f.target.conditions.includes(19));assert(!f.target.conditions.includes(5));
  result=strike();assert.equal(result.hit,true);assert.equal(result.amount,80);assert.equal(calculations,1);
});

test('guaranteed physical hits and magic bypass Image without consuming its removal roll',()=>{
  const f=fixture();setCondition(f.host,f.target,19,true);f.host.random=()=>{throw Error('Image should not roll');};
  const damage=()=>({amount:80,missed:false,critical:false});
  for(const ability of [{...data.abilities[1],flags:[1]},{...data.abilities[1],accuracy:255},data.abilities[40]]){
    const result=executeAbilityEffects(f.host,f.actor,f.target,ability,1,{},damage);
    assert.equal(result.hit,true);assert.equal(result.amount,80);assert(f.target.conditions.includes(19));
  }
});

test('PR Imp self-negation makes two casts toggle, while an ordinary overlapping condition stays applied',()=>{
  const f=fixture();f.cast(75);assert(f.target.conditions.includes(13));
  f.cast(75);assert(!f.target.conditions.includes(13));
  f.cast(75);assert(f.target.conditions.includes(13));
  setCondition(f.host,f.target,21,true);setCondition(f.host,f.target,21,true);assert(f.target.conditions.includes(21));
});

const weaponProcRows=JSON.parse(fs.readFileSync(new URL('../../build/corpus/bundles/battleextradata_assets_all_1295049eaf8a1a34aca99fdc338e0a02.json',import.meta.url),'utf8'))[0].data.add_ability_weapon;
const equipWeapon=(f,weaponId)=>{
  const content=Object.values(data.contents).find(row=>row.type_id===2&&row.type_value===weaponId),weapon=data.weapons[weaponId];
  f.actor.weaponEffects=[{contentId:content.id,process:weapon.process_prog,triggerAbilityId:weapon.trigger_ability_id,additionalConditionGroup:weapon.additional_condition_group_id}];
  f.host.data={...data,weaponAdditionalAbilities:weaponProcRows};
  return content;
};

test('PR weapon additional abilities roll their own 25 percent chance and rods never substitute the break ability',()=>{
  const f=fixture();equipWeapon(f,55);const seen=[];f.host.random=()=>0.249;f.host.inventory={7:2};
  f.host.perform=(actor,target,ability,count,options)=>{
    seen.push({ability,options});
    executeAbilityEffects(f.host,actor,target,ability,count,options,()=>({amount:80,missed:false,critical:false}));
    assert.deepEqual(applyWeaponEffects(f.host,actor,target,data.abilities[1],{hit:true},options),[]);
  };
  const primary=f.cast(1);assert.equal(f.target.hp,420);
  applyWeaponEffects(f.host,f.actor,f.target,data.abilities[1],primary);
  assert.equal(f.target.hp,340);assert.equal(seen[0].ability.id,272);assert.notEqual(seen[0].ability.id,data.weapons[55].trigger_ability_id);
  assert.equal(seen[0].ability.mp,0);assert.equal(f.actor.mp,40);assert.deepEqual(f.host.inventory,{7:2});
  f.host.random=()=>0.25;applyWeaponEffects(f.host,f.actor,f.target,data.abilities[1],{hit:true});assert.equal(seen.length,1);
});

test('weapon spell follow-ups retain the selected recipient even when the ordinary hit missed',()=>{
  const f=fixture();equipWeapon(f,15);f.host.random=()=>0;let recipient,abilityId;
  f.host.perform=(_actor,target,ability)=>{recipient=target;abilityId=ability.id;};
  applyWeaponEffects(f.host,f.actor,f.target,data.abilities[1],{hit:false,amount:0});
  assert.equal(recipient,f.target);assert.equal(abilityId,263);
});

test('PR Assassin condition group respects rate, immunity and undead healing without consuming inventory',()=>{
  const f=fixture();equipWeapon(f,7);f.host.random=()=>0.25;
  applyWeaponEffects(f.host,f.actor,f.target,data.abilities[1],{hit:true});assert.equal(f.target.hp,500);
  f.host.random=()=>0;f.target.conditionImmunities=[5];
  applyWeaponEffects(f.host,f.actor,f.target,data.abilities[1],{hit:true});assert.equal(f.target.hp,500);
  f.target.conditionImmunities=[];f.target.boss=true;
  applyWeaponEffects(f.host,f.actor,f.target,data.abilities[1],{hit:true});assert.equal(f.target.hp,500);
  f.target.boss=false;f.target.undead=true;
  applyWeaponEffects(f.host,f.actor,f.target,data.abilities[1],{hit:true});assert.equal(f.target.hp,1000);assert(!f.target.conditions.includes(5));
  f.target.undead=false;applyWeaponEffects(f.host,f.actor,f.target,data.abilities[1],{hit:true});assert.equal(f.target.hp,0);assert(f.target.conditions.includes(5));
});

test('Thief Knife performs a source Steal attempt at 50 percent and only for an ordinary landed Fight',()=>{
  const f=fixture();equipWeapon(f,6);const seen=[];f.host.perform=(_actor,_target,ability)=>seen.push(ability.id);
  f.host.random=()=>0.499;applyWeaponEffects(f.host,f.actor,f.target,data.abilities[1],{hit:true});assert.deepEqual(seen,[8]);
  f.host.random=()=>0.5;applyWeaponEffects(f.host,f.actor,f.target,data.abilities[1],{hit:true});
  f.host.random=()=>0;applyWeaponEffects(f.host,f.actor,f.target,data.abilities[1],{hit:false});
  applyWeaponEffects(f.host,f.actor,f.target,data.abilities[40],{hit:true});assert.deepEqual(seen,[8]);
});

test('PR Shell/type412 reduces magic and Protect/type19 reduces physical damage, including provider variants',()=>{
  const f=fixture();Object.assign(f.actor,{side:'player',strength:35,attack:40,magic:30});Object.assign(f.target,{defense:100,magicDefense:100});
  const physical={kind:'physical',power:40,accuracy:255},magic={kind:'magic',power:40,accuracy:255};
  const damage=a=>calculateDamage(f.actor,f.target,a,()=>0.5).amount;
  const p=damage(physical),m=damage(magic);
  setCondition(f.host,f.target,22,true);assert.equal(f.target.shell,true);assert.equal(f.target.protect,false);
  assert.equal(damage(physical),p);assert(damage(magic)<m);
  setCondition(f.host,f.target,22,false);setCondition(f.host,f.target,23,true);
  assert.equal(f.target.protect,true);assert.equal(f.target.shell,false);assert(damage(physical)<p);assert.equal(damage(magic),m);
  const protectedDamage=damage(physical);setCondition(f.host,f.target,93,true);assert.equal(damage(physical),protectedDamage);
  setCondition(f.host,f.target,94,true);assert.equal(f.target.shell,true);assert(damage(magic)<m);
});

test('periodic PR rates keep Regen at five percent and poison element immunity/absorption in PR order',()=>{
  const u=unit();assert.equal(periodicStatusAmount(u,data.conditions[20]),-50);
  assert.equal(periodicStatusAmount(u,data.conditions[10]),62);
  u.affinities={6:3};assert.equal(periodicStatusAmount(u,data.conditions[10]),0);
  u.affinities={6:2};assert.equal(periodicStatusAmount(u,data.conditions[10]),31);
  u.affinities={6:4};assert.equal(periodicStatusAmount(u,data.conditions[10]),-62);
});

test('periodic timers freeze under Stop, react to source Haste/Slow and do not inherit another status clock',()=>{
  const f=fixture();setCondition(f.host,f.target,10,true);
  assert.equal(periodicStatusInterval(data,f.target,10),512/30);
  tickConditions(f.host,f.target,4);assert.equal(f.target.hp,500);
  setCondition(f.host,f.target,26,true);tickConditions(f.host,f.target,20);assert.equal(f.target.periodicClocks[10].elapsed,4);
  setCondition(f.host,f.target,26,false);tickConditions(f.host,f.target,4.6);assert.equal(f.target.hp,438);
  setCondition(f.host,f.target,21,true);assert(periodicStatusInterval(data,f.target,10)<512/30);
  setCondition(f.host,f.target,25,true);assert.equal(periodicStatusInterval(data,f.target,10),1024/30);
  setCondition(f.host,f.target,10,false);assert.equal(f.target.periodicClocks[10],undefined);
  setCondition(f.host,f.target,20,true);tickConditions(f.host,f.target,1);assert.equal(f.target.hp,438);
});

test('ordinary and provider speed aliases do not stack twice',()=>{
  assert.equal(conditionSpeed(data,unit({conditions:[21,95]})),1.5);
  assert.equal(conditionSpeed(data,unit({conditions:[25,25]})),.5);
});

test('a special scene helper cannot arbitrarily increment an AI-owned variable',()=>{
  const f=fixture();f.actor.aiState={vars:[1,0,0,0,0,0,0,0,1]};
  f.cast(630);assert.equal(f.actor.aiState.vars[0],1);assert.equal(f.actor.aiState.vars[8],1);
  assert(f.warnings.some(message=>message.includes('source AI/event retains variable ownership')));
});

test('PR two-dimensional variable companion adds both caster cells once and never changes another enemy bank',()=>{
  const f=fixture(),other=unit({aiState:{vars:Array(15).fill(7)}});f.actor.aiState={vars:Array(15).fill(0)};f.actor.aiState.vars[0]=11;
  f.host.enemies.push(other);f.cast(1262);assert.equal(f.actor.aiState.vars[1],1);assert.equal(f.actor.aiState.vars[2],1);
  assert.equal(f.actor.aiState.vars[0],11);assert.deepEqual(other.aiState.vars,Array(15).fill(7));
  executeAbilityEffects(f.host,f.actor,f.target,data.abilities[1263],2,{updateVariables:false},()=>({amount:80,missed:false,critical:false}));
  assert.equal(f.actor.aiState.vars[1],1);assert.equal(f.actor.aiState.vars[2],1);
});

test('Berserk provider aliases retain their derived state and confused input can target either side',()=>{
  const f=fixture();Object.assign(f.actor,{side:'player',conditions:[18,91]});Object.assign(f.target,{side:'enemy'});
  setCondition(f.host,f.actor,18,false);assert.equal(f.actor.berserk,true);
  assert.deepEqual(forcedConditionAction(f.host,f.actor).target,{side:'enemy',index:0});
  setCondition(f.host,f.actor,91,false);assert.equal(f.actor.berserk,false);
  setCondition(f.host,f.actor,12,true);f.host.random=()=>0;
  assert.deepEqual(forcedConditionAction(f.host,f.actor).target,{side:'player',index:0});
  f.host.random=()=>0.99;assert.deepEqual(forcedConditionAction(f.host,f.actor).target,{side:'enemy',index:0});
});

test('Throw consumes one actual owned weapon and uses its power instead of equipped attack',()=>{
  const f=fixture(),content=Object.values(data.contents).find(c=>c.type_id===2&&c.type_value===2);
  f.host.inventory={[content.id]:1};const commands=throwableCommands(data,f.host.inventory,f.actor),command=commands[0];
  assert.equal(command.contentId,content.id);assert.equal(command.kind,'throw');
  let parameters;const result=executeAbilityEffects(f.host,f.actor,f.target,data.abilities[10],1,
    {throwContentId:content.id,sequence:{}},(actor,target,ability)=>{parameters={actor,ability};return {amount:80,missed:false,critical:false};});
  assert.equal(f.host.inventory[content.id],0);assert.equal(result.amount,80);
  assert.equal(parameters.actor.attack,0);assert.equal(parameters.ability.power,data.weapons[2].attack);
  assert(parameters.ability.flags.includes(5));assert.equal(parameters.ability.backRow,true);
  assert.equal(throwableCommands(data,f.host.inventory,f.actor).length,0);
});

test('one thrown PR scroll reaches multiple enemies and consumes only one inventory unit',()=>{
  const f=fixture(),content=Object.values(data.contents).find(c=>c.type_id===1&&c.type_value===25),other=unit();
  f.host.inventory={[content.id]:1};const sequence={},options={throwContentId:content.id,sequence};
  const damage=()=>({amount:80,missed:false,critical:false});
  executeAbilityEffects(f.host,f.actor,f.target,data.abilities[10],2,options,damage);
  executeAbilityEffects(f.host,f.actor,other,data.abilities[10],2,{...options,updateVariables:false},damage);
  assert.equal(f.target.hp,420);assert.equal(other.hp,420);assert.equal(f.host.inventory[content.id],0);
});

test('Golem shares caster current HP once across the party rather than giving every member maxHP',()=>{
  const f=fixture();f.actor.side='player';f.actor.hp=300;f.target.side='player';const other=unit({side:'player'});
  executeAbilityEffects(f.host,f.actor,f.target,data.abilities[100],2,{updateVariables:true},()=>({amount:80}));
  executeAbilityEffects(f.host,f.actor,other,data.abilities[100],2,{updateVariables:false},()=>({amount:80}));
  assert.equal(f.host.golemShield.hp,300);
  const foe=unit({side:'enemy'}),damage=()=>({amount:80,missed:false,critical:false});
  for(let n=0;n<3;n++)executeAbilityEffects(f.host,foe,f.target,data.abilities[1],1,{},damage);
  assert.equal(f.target.hp,500);assert.equal(f.host.golemShield.hp,60);
  executeAbilityEffects(f.host,foe,other,data.abilities[1],1,{},damage);
  assert.equal(other.hp,480);assert.equal(f.host.golemShield.hp,0);
});

test('Gil Toss pays once for source twice-spent damage and level-question Holy uses gil last digit',()=>{
  const f=fixture(),other=unit({hp:2000,maxHp:2000});f.target.hp=f.target.maxHp=2000;f.actor.side='player';
  f.host.context.gil=1000;const payments=[];f.host.event=(kind,payload)=>{if(kind==='gil-spend')payments.push(payload.amount);};const sequence={};
  executeAbilityEffects(f.host,f.actor,f.target,data.abilities[15],2,{sequence},()=>({amount:80}));
  executeAbilityEffects(f.host,f.actor,other,data.abilities[15],2,{sequence,updateVariables:false},()=>({amount:80}));
  assert.equal(f.target.hp,1400);assert.equal(other.hp,1400);assert.equal(f.host.context.gil,400);assert.deepEqual(payments,[600]);
  f.host.context.gil=1234;assert.equal(f.cast(153).hit,true);
  f.host.context.gil=1233;assert.equal(f.cast(153).hit,false);
  f.host.context.gil=1230;assert.equal(f.cast(153).hit,false);
});

test('PR four-hit physical operands and nested child chains retain all hits',()=>{
  const f=fixture();f.target.hp=f.target.maxHp=5000;const result=f.cast(127);assert.equal(result.amount,320);
  let fights=0;f.host.perform=(actor,target,ability,count,options)=>{
    if(ability.id===1)fights++;
    executeAbilityEffects(f.host,actor,target,ability,count,options,()=>({amount:80,missed:false,critical:false}));
  };
  f.cast(1345);assert.equal(fights,4);
});

test('Tentacle uses its PR physical power and the source player-slot mask instead of substituting Fight',()=>{
  const f=fixture(),players=Array.from({length:4},()=>unit());f.host.players=players;
  const seen=[];const calculate=(actor,target,ability,_random,count)=>{seen.push([ability.power,count]);return {amount:80,missed:false,critical:false};};
  executeAbilityEffects(f.host,f.actor,players[0],data.abilities[1301],4,{},calculate);
  executeAbilityEffects(f.host,f.actor,players[3],data.abilities[1301],4,{},calculate);
  assert.equal(players[0].hp,420);assert.equal(players[3].hp,500);assert.deepEqual(seen,[[146,1]]);
});

test('Jump and all-party Quetzalli charge each actual condition holder and hide it until landing',()=>{
  const f=fixture();f.cast(21);assert.equal(f.actor.hidden,true);assert.equal(f.actor.chargedAbility,22);assert.equal(f.actor.chargedTarget,f.target);
  f.cast(22);assert.equal(f.actor.hidden,false);assert(!f.actor.conditions.includes(28));
  const other=unit();executeAbilityEffects(f.host,f.actor,other,data.abilities[103],2,{},()=>({amount:80}));
  assert.equal(other.hidden,true);assert.equal(other.chargedAbility,104);assert.equal(other.chargedTarget,null);
  assert.equal(other.atb,0);assert.equal(other.ready,false);
});

test('Spiraler and Transfusion pay their source condition628 caster HP and MP cost',()=>{
  const f=fixture();f.target.hp=100;f.cast(138);assert.equal(f.target.hp,1000);assert.equal(f.actor.hp,0);assert.equal(f.actor.mp,0);
  const g=fixture();g.target.hp=100;g.target.mp=0;g.cast(158);assert.equal(g.target.hp,1000);assert.equal(g.target.mp,100);assert.equal(g.actor.hp,0);assert.equal(g.actor.mp,0);
});

test('every PR used function/process family is enumerated, with approximations separately visible',()=>{
  const result=auditAbilities(data);
  assert.deepEqual(result.missing.functions,[]);assert.deepEqual(result.missing.processes,[]);
  assert(result.functionFamilies.length>30);assert(result.processFamilies.length>=40);
  assert(result.approximateAbilityIds.length>0);assert(result.remaining.length>0);
});
