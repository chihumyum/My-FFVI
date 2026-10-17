import {setCondition,hasConditionType} from './ability-effects.js';
const unique=values=>[...new Set(values)];
export function initRole(battle,unit) {
  if(unit.side!=="player")return;
  unit.rageMonster=null;unit.danceAbility=null;unit.controlledEnemyIndex=null;
  unit.tranceGauge??=255;
  if(unit.id===8 && !unit.loreAbilities){unit.loreAbilities=[143,147,160];battle.warning('Strago initial Lore uses the matching SNES Aqua Breath/Revenge Blast/Stone set; PR initial knowledge flags are not exported.');}
  if(unit.id===12 && !unit.rages){unit.rages=[1];battle.warning('Initial Rage knowledge uses PR monster 1 until initial PR Rage flags are exported; Veldt learning records actual encountered PR monsters.');}
}
export function terrainDance(battle) {
  const bg=battle.context.backgroundId??battle.formation.backgroundId;
  return (battle.data.learning??[]).filter(r=>r.type_id===3 && r.job_id===11 && r.value1===bg)
    .map(r=>battle.data.contents?.[r.content_id]?.type_value).find(Boolean);
}
export function observeLore(battle,ability) {
  if(ability.typeId!==504)return;
  // LearnLore: Strago must actually witness the ability, without blind/sleep,
  // confusion, berserk, stop, freeze, petrification, zombie or hide.
  for(const unit of battle.players)if(unit.id===8 && battle.alive(unit) && !unit.hidden &&
    ![5,7,9,11,12,17,34,410,416,625].some(type=>hasConditionType(battle.data,unit,type)) && !unit.rageMonster){
    unit.loreAbilities??=[];
    if(!unit.loreAbilities.includes(ability.id)){unit.loreAbilities.push(ability.id);battle.addLog(`${unit.name}看到了${ability.name}，学会了青魔法！`);}
  }
}
export function beginRoleAction(battle,actor,ability) {
  if(typeof ability.id==='string'&&ability.id.startsWith('rage:')){
    const id=Number(ability.id.split(':')[1]),monster=battle.data.monsters[id];
    if(!monster?.rageGroup)return false;
    actor.rageMonster=id;actor.ragePrevious={affinities:actor.affinities,elementResistances:actor.elementResistances,conditionImmunities:actor.conditionImmunities};
    actor.affinities={...actor.affinities??actor.elementResistances??{}};
    for(const [id,value]of Object.entries(monster.elementResistances??{}))actor.affinities[id]=Math.max(actor.affinities[id]??0,value);
    actor.elementResistances=actor.affinities;
    actor.conditionImmunities=unique([...(actor.conditionImmunities??[]),...(monster.conditionImmunities??[])]);
    actor.rageBorrowed=(monster.initialConditions??[]).filter(id=>!(actor.conditions??[]).includes(id));
    for(const id of monster.initialConditions??[])setCondition(battle,actor,id,true,{force:true});
    battle.addLog(`${actor.name}开始模仿${monster.name}狂怒，不再接受指令。`);return true;
  }
  if(ability.typeId===603){
    const current=terrainDance(battle);
    if(current!==ability.id && battle.random()<.5){battle.addLog(`${actor.name}跳舞失败！`);return true;}
    actor.danceAbility=ability.id;battle.addLog(`${actor.name}开始${ability.name}，持续自动跳舞。`);
    const condition=ability.functions?.find(f=>f.id===9)?.values?.[0];
    if(condition)setCondition(battle,actor,condition,true,{force:true});
    danceTurn(battle,actor,ability);return true;
  }
  if(ability.id===6){
    actor.trance=true;actor.tranceSeconds=0;actor.tranceStartGauge=actor.tranceGauge??255;
    battle.warning('Trance duration uses the SNES decrement rate at 30 ticks/sec, gauge 0–255; PR animation timing and post-Phunbaba extension are approximated.');
  }
  if(ability.id===7){saveTranceGauge(actor);actor.trance=false;actor.tranceSeconds=0;}
  if(ability.id===16 && battle.isVeldt){
    const monsters=battle.enemies.filter(e=>!e.removed).map(e=>e.monsterId);
    actor.pendingRages=unique([...(actor.pendingRages??[]),...monsters]);
  }
  return false;
}
function performForced(battle,actor,ability) {
  if(!ability)return;
  let source=ability;
  if(!battle.supported(source)){battle.warning(`Unimplemented forced skill ${source.id}; falling back to Attack.`);source=battle.data.abilities?.[1];}
  if(!source)return;
  const pool=(source.range===5?[actor]:source.target==='ally'?battle.players:battle.enemies).filter(u=>battle.eligibleTarget(u,source));
  if(!pool.length)return;
  const targets=source.all?pool:[pool[Math.floor(battle.random()*pool.length)]],sequence={};
  for(const target of targets)battle.perform(actor,target,{...source,mp:0},targets.length,{sequence});
}
export function forcedRoleTurn(battle,actor) {
  if(actor.side!=="player")return false;
  if(actor.id!==14&&!actor.rageMonster&&!actor.danceAbility)return false;
  let ability;
  if(actor.danceAbility){danceTurn(battle,actor,battle.data.abilities[actor.danceAbility]);battle.consumeTurn(actor);battle.checkEnd();return true;}
  else if(actor.rageMonster){
    const group=battle.data.monsters[actor.rageMonster]?.rageGroup;
    const rows=(battle.data.randomAbilityGroups??[]).filter(r=>r.group_id===group);
    const total=rows.reduce((sum,r)=>sum+(r.invocation_rate||0),0);let roll=battle.random()*total;
    ability=battle.data.abilities[rows.find(r=>(roll-=r.invocation_rate||0)<0)?.ability_id??1];
  } else {
    const worn=actor.equipment??[],roll=battle.random();
    // PR owns the actual actions; relic action odds use SNES's meaning.
    ability=battle.data.abilities[worn.includes(296)&&roll<.5?199:worn.includes(297)&&roll<.5?201:1];
    if(worn.includes(297)||worn.includes(296))battle.warning('Umaro relic action selection uses SNES 50% checks with PR actions; exact PR native checks are approximated.');
  }
  battle.clearRunic(actor);performForced(battle,actor,ability);battle.consumeTurn(actor);battle.checkEnd();return true;
}
export function tickRole(battle,unit,seconds) {
  if(unit.side!=='player')return;
  if(unit.hp<=0){if(unit.controlledEnemyIndex!=null){const enemy=battle.enemies[unit.controlledEnemyIndex];if(enemy)setCondition(battle,enemy,85,false);setCondition(battle,unit,66,false);}
    if(unit.ragePrevious){Object.assign(unit,unit.ragePrevious);delete unit.ragePrevious;}unit.rageMonster=null;unit.danceAbility=null;unit.controlledEnemyIndex=null;}

  if(!unit.trance)return;
  if(!hasConditionType(battle.data,unit,621))return;
  unit.tranceSeconds=(unit.tranceSeconds??0)+seconds;
  const gauge=unit.tranceStartGauge??unit.tranceGauge??255,rate=Math.min(2047,Math.floor(65535/Math.max(1,gauge)/16))+1;
  const remaining=Math.max(0,65535-unit.tranceSeconds*30*rate);
  if(remaining>0)return;
  unit.tranceGauge=0;unit.trance=false;unit.tranceSeconds=0;
  for(const id of [...unit.conditions??[]])if(battle.data.conditions?.[id]?.condition_type===621)setCondition(battle,unit,id,false);
  battle.addLog(`${unit.name}幻化结束。`);
}
export function finishRoles(battle,outcome) {
  for(const unit of battle.players){
    if(outcome==='victory'){
      if(unit.id===11&&battle.alive(unit)){
        const id=terrainDance(battle);unit.danceAbilities??=[];
        if(id&&!unit.danceAbilities.includes(id)){unit.danceAbilities.push(id);battle.addLog(`${unit.name}学会了${battle.data.abilities[id]?.name}。`);}
      }
      if(unit.id===12&&battle.isVeldt&&unit.pendingRages?.length&&!unit.veldtLeapt&&!unit.removed){
        unit.rages=unique([...(unit.rages??[]),...unit.pendingRages,...(battle.events?.state.veldtDefeated??battle.enemies).map(e=>e.monsterId)]).filter(id=>battle.data.monsters[id]?.rageGroup);unit.pendingRages=[];
      }

    }
    if(unit.trance&&unit.tranceSeconds)saveTranceGauge(unit);
    if(outcome==='victory'&&unit.id===1&&(unit.commands??[]).includes(8))unit.tranceGauge=Math.min(255,(unit.tranceGauge??0)+(battle.formation.ap??0)*2);
    if(unit.ragePrevious){Object.assign(unit,unit.ragePrevious);delete unit.ragePrevious;}
    for(const id of unit.rageBorrowed??[])setCondition(battle,unit,id,false);unit.rageBorrowed=[];
    unit.rageMonster=null;unit.danceAbility=null;unit.controlledEnemyIndex=null;unit.tranceSeconds=0;
  }
}

function danceTurn(battle,actor,dance) {
  const condition=dance?.functions?.find(f=>f.id===9)?.values?.[0];
  const group=battle.data.conditions?.[condition]?.condition_type===619 ? dance.id-163 : 0;
  const rows=(battle.data.randomAbilityGroups??[]).filter(r=>r.group_id===group);
  const total=rows.reduce((n,r)=>n+r.invocation_rate,0);let roll=battle.random()*total;
  const row=rows.find(r=>(roll-=r.invocation_rate)<0);
  if(row)performForced(battle,actor,battle.data.abilities[row.ability_id]);
  else battle.warning(`Dance ${dance?.id} has no PR random action group; no action this turn.`);
}

function saveTranceGauge(unit) {
  const gauge=unit.tranceStartGauge??unit.tranceGauge??255,rate=Math.min(2047,Math.floor(65535/Math.max(1,gauge)/16))+1;
  unit.tranceGauge=Math.max(0,Math.floor(gauge*(65535-(unit.tranceSeconds??0)*30*rate)/65535));
}
