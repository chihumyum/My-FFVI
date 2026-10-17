// Automatic play submits the same commands as the battle menu. Predictions
// never consume the game's random sequence, grant abilities, or alter stats.
import { setCondition, conditionSpeed, actionBlocked, periodicStatusAmount } from './ability-effects.js';
const functionsOf = ability => ability.functions || [];
const hasFunction = (ability, ...ids) => functionsOf(ability).some(fn => ids.includes(fn.id));
const hurtsHp = ability => functionsOf(ability).some(fn => [2,78].includes(fn.id) ||
  [3,69,77].includes(fn.id) && fn.values?.[0] !== 2);
const conditionIds = (battle, ability) => functionsOf(ability).flatMap(fn =>
  [11, 38].includes(fn.id) ? [Number(fn.values?.[0])] : fn.id === 12
    ? (battle.data.conditionGroups || []).filter(row => row.group_id === fn.values?.[0]).map(row => row.condition_id) : []);
const living = (battle, units) => units.filter(unit => battle.targetable(unit));
const sameSideTarget = (units, unit) => ({ side: unit.side || 'player', index: units.indexOf(unit) });
const conditionType = (battle,id) => battle.data.conditions?.[id]?.condition_type ?? id;
const hasType = (battle,unit,type) => (unit.conditions || []).some(id => conditionType(battle,id) === type);
const mpAttack = ability => functionsOf(ability).some(fn => [3,69,77].includes(fn.id) && fn.values?.[0] === 2);
const canHurt = (ability,enemy) => hurtsHp(ability) || enemy.diesAtZeroMp && mpAttack(ability);

function attackValue(battle,calculate,actor,target,ability,count) {
  if(hasType(battle,target,413)&&ability.kind==='magic'&&!ability.invalidReflection)return 0;
  const result=calculate(actor,target,ability,()=>0.25,count);
  const resource=result.resource || (mpAttack(ability)?'mp':'hp'),amount=result.missed?0:result.amount||0;
  if(resource==='mp')return target.diesAtZeroMp?Math.min(Math.max(0,target.mp),Math.max(0,amount))*target.hp/Math.max(1,target.mp):0;
  return amount<0?-Math.min(target.maxHp-target.hp,-amount):Math.min(target.hp,amount);
}

function attackOptions(command,enemies) {
  const modes=command.selectableAll?[false,true]:[Boolean(command.all)];
  return modes.flatMap(all=>{
    const effective={...command,all};
    if(all)return enemies.length?[{command:effective,target:enemies[0],targets:enemies,all}]:[];
    return enemies.filter(enemy=>enemy.role!=='ymir-shell'||enemies.length===1)
      .map(target=>({command:effective,target,targets:[target],all}));
  });
}

function optionDamage(battle,actor,option,calculate) {
  return option.targets.reduce((sum,enemy)=>sum+attackValue(battle,calculate,actor,enemy,option.command,option.targets.length),0);
}

function optionCounterCost(battle,actor,option,calculate) {
  return option.targets.reduce((sum,enemy)=>sum+predictedCounterCost(battle,actor,enemy,option.command,
    predictedDamage(calculate,actor,enemy,option.command,option.targets.length),calculate),0);
}

function sourceAttackAbilities(battle,enemy) {
  const ids=[];
  for(const [op,ints=[],weights=[]] of enemy.aiState?.program?.ops || []) {
    const offset=op==='TimerAttackAct'?1:op==='ActForTarget'?2:0;
    if(!['Act','LoopAct','FirstAttackAct','FirstLoopAttackAct','TimerAttackAct','ActForTarget'].includes(op))continue;
    for(let n=offset;n<ints.length;n++)if(weights[n]!==0 || op==='ActForTarget')ids.push(ints[n]);
  }
  if(!ids.length)ids.push(1);
  return [...new Set(ids)].map(id=>battle.data.abilities?.[id]).filter(ability=>ability && hurtsHp(ability) &&
    ability.mp <= (enemy.mp??Infinity) && !ability.forbiddenConditions?.some(id=>(enemy.conditions||[]).includes(id)));
}

function conditionPreview(battle,unit,ids,add) {
  const copy={...unit,conditions:[...(unit.conditions||[])],conditionUntil:{...unit.conditionUntil},periodicClocks:{...unit.periodicClocks}};
  const host={data:battle.data,elapsed:battle.elapsed||0,warning:()=>{}};
  for(const id of ids)setCondition(host,copy,id,add);
  return copy;
}

// One short look at currently available attacks is enough to value a lasting
// condition. This does not search action sequences or execute a preview battle.
function sourceStateInput(battle,unit,commands,allies,enemies,calculate,{offensive=true,defensive=true}={}) {
  const attackCommands=new Map(allies.map(ally=>[ally,battle.commandsFor(battle.players.indexOf(ally))
    .filter(command=>!command.disabled && command.target!=='ally' && command.kind!=='item' &&
      (hurtsHp(command)||mpAttack(command)||command.id===1))]));
  const bestHit=(ally,enemy)=>Math.max(0,...attackCommands.get(ally).filter(command=>canHurt(command,enemy)||command.id===1)
    .map(command=>{
      if(hasType(battle,enemy,14)&&command.kind==='physical'&&!command.flags?.includes(1))return 0;
      if(hasType(battle,enemy,413)&&command.kind==='magic'&&!command.invalidReflection)return 0;
      return attackValue(battle,calculate,ally,enemy,command,command.all?enemies.length:1);
    }));
  const sourceThreat=(enemy,targets)=>{
    if(actionBlocked(battle.data,enemy))return 0;
    return Math.max(0,...sourceAttackAbilities(battle,enemy).map(ability=>{
      const damage=targets.map(target=>predictedDamage(calculate,enemy,target,ability,ability.all?targets.length:1));
      return ability.all?damage.reduce((sum,n)=>sum+n,0):Math.max(0,...damage);
    }))*conditionSpeed(battle.data,enemy);
  };
  const partyOutput=enemy=>allies.reduce((sum,ally)=>sum+bestHit(ally,enemy),0);
  const ownOutput=Math.max(0,...enemies.map(enemy=>bestHit(unit,enemy)));
  let best=null;
  const offer=(command,target,score)=>{
    score-=(command.mp||0)*1.5;
    if(score>Math.max(35,ownOutput*.3) && (!best||score>best.score))best={command,target,score};
  };
  for(const command of commands.filter(command=>offensive && functionsOf(command).length &&
    functionsOf(command).every(fn=>[11,12].includes(fn.id)) && ![1,2,5,12].includes(command.range))) {
    const ids=conditionIds(battle,command);
    for(const enemy of enemies){
      if(hasType(battle,enemy,413)&&command.kind==='magic'&&!command.invalidReflection)continue;
      const preview=conditionPreview(battle,enemy,ids,false);
      const removed=(enemy.conditions||[]).filter(id=>!preview.conditions.includes(id));
      if(!removed.some(id=>[19,412,15,413,25,14,604,409].includes(conditionType(battle,id))))continue;
      if(enemy.hp<=bestHit(unit,enemy))continue; // The available hit already ends this enemy.
      const horizon=Math.min(3,Math.max(1,enemy.hp/Math.max(1,partyOutput(enemy))));
      let gain=(partyOutput(preview)-partyOutput(enemy))*horizon;
      gain+=(sourceThreat(enemy,allies)-sourceThreat(preview,allies))*horizon;
      if(removed.some(id=>conditionType(battle,id)===25)){
        const row=battle.data.conditions?.[removed.find(id=>conditionType(battle,id)===25)];
        gain+=Math.min(enemy.maxHp-enemy.hp,-periodicStatusAmount(enemy,row)*horizon);
      }
      offer(command,{side:'enemy',index:battle.enemies.indexOf(enemy)},gain);
    }
  }
  // Defensive statuses use their real PR application and damage rules. A
  // Shell gains no value against ignore-defense attacks, for example.
  for(const command of commands.filter(command=>defensive && functionsOf(command).length &&
    functionsOf(command).every(fn=>[9,10].includes(fn.id)) && [1,2,5,6,7,8,9,12,20,21].includes(command.range))) {
    const ids=functionsOf(command).flatMap(fn=>fn.id===9?[fn.values[0]]:
      (battle.data.conditionGroups||[]).filter(row=>row.group_id===fn.values[0]).map(row=>row.condition_id));
    if(!ids.some(id=>[19,412,409,25].includes(conditionType(battle,id))))continue;
    for(const target of command.range===5?[unit]:allies){
      const targets=command.all?allies:[target],previews=new Map(targets.map(ally=>[ally,conditionPreview(battle,ally,ids,true)]));
      if(!targets.some(ally=>previews.get(ally).conditions.some(id=>!(ally.conditions||[]).includes(id))))continue;
      const next=allies.map(ally=>previews.get(ally)||ally);
      const horizon=Math.min(3,Math.max(1,enemies.reduce((sum,enemy)=>sum+enemy.hp,0)/
        Math.max(1,enemies.reduce((sum,enemy)=>sum+partyOutput(enemy),0))));
      let gain=enemies.reduce((sum,enemy)=>sum+sourceThreat(enemy,allies)-sourceThreat(enemy,next),0)*horizon;
      for(const ally of targets){
        const added=previews.get(ally).conditions.filter(id=>!(ally.conditions||[]).includes(id));
        const regen=added.find(id=>conditionType(battle,id)===25);
        if(regen!==undefined)gain+=Math.min(ally.maxHp-ally.hp,-periodicStatusAmount(ally,battle.data.conditions[regen])*horizon);
      }
      offer(command,sameSideTarget(battle.players,target),gain);
      if(command.all)break;
    }
  }
  return best?battle.choose(battle.players.indexOf(unit),best.command.id,best.target):false;
}

function predictedDamage(calculate, actor, target, ability, count) {
  const result = calculate(actor, target, ability, () => 0.25, count);
  return result.missed ? 0 : Math.max(0, result.amount || 0);
}

function fatalFinalAttack(battle, enemy, allies, calculate) {
  if ((enemy.conditions || []).some(id => battle.data.conditions?.[id]?.condition_type === 12)) return null;
  for (const [op, ids = [], weights = []] of enemy.aiState?.program?.ops || []) {
    if (op !== 'FinalAttackAct') continue;
    for (const [index,id] of ids.entries()) {
      const ability = battle.data.abilities?.[id];
      if (!ability || weights[index] === 0 || !hurtsHp(ability) ||
          ability.mp > enemy.mp || ability.forbiddenConditions?.some(id => (enemy.conditions || []).includes(id))) continue;
      const targets = ability.all ? allies : [allies.reduce((a,b) => a.hp < b.hp ? a : b)];
      const killed = targets.filter(target => predictedDamage(calculate,enemy,target,ability,targets.length) >= target.hp).length;
      if (killed === allies.length) return ability;
    }
  }
  return null;
}

function counterControl(battle, unit, enemy, threat) {
  const useful = new Set([12, ...(threat.forbiddenConditions || []).map(id => battle.data.conditions?.[id]?.condition_type ?? id)]);
  return battle.commandsFor(battle.players.indexOf(unit)).find(command => !command.disabled && command.target !== 'ally' &&
    functionsOf(command).some(fn => {
      const ids = fn.id === 9 ? [fn.values[0]] : fn.id === 10 ?
        (battle.data.conditionGroups || []).filter(row => row.group_id === fn.values[0]).map(row => row.condition_id) : [];
      return ids.some(id => useful.has(battle.data.conditions?.[id]?.condition_type ?? id) &&
        !(enemy.conditionImmunities || []).includes(id));
    }));
}

function predictedCounterCost(battle, actor, target, command, damage, calculate) {
  const live = target.aiState;
  if (!live || live.running || typeof live.wake !== 'function' ||
      !live.program.ops.some(([op]) => /Counter|Recevie|Receive|Damaged/.test(op))) return 0;
  let total = 0;
  // Reuse the actual PR interpreter on private state. Predictions never
  // execute effects or consume the live random sequence and AI variables.
  for (const roll of [0.1, 0.5, 0.9]) {
    const copies = new Map([...battle.players,...battle.enemies].map(unit=>[unit,{...unit,conditions:[...(unit.conditions||[])]}]));
    const defender = copies.get(target), source = copies.get(actor), actions = [];
    const resource=mpAttack(command)?'mp':'hp';
    defender[resource] = Math.max(0, (defender[resource]||0) - damage);
    if(resource==='mp' && defender.diesAtZeroMp && defender.mp<=0)defender.hp=0;
    const preview = { data:battle.data,elapsed:battle.elapsed,encounterId:battle.encounterId,
      players:battle.players.map(unit=>copies.get(unit)),enemies:battle.enemies.map(unit=>copies.get(unit)),
      aiQueue:[],random:()=>roll,warning:()=>{},addLog:()=>{},event:()=>{},queueAIAction:action=>actions.push(action) };
    const ai = Object.assign(Object.create(Object.getPrototypeOf(live)),live,{
      battle:preview,unit:defender,vars:[...live.vars],pending:[],output:[],visits:new Set(live.visits),running:false,
    });
    defender.aiState=ai;
    ai.wake(defender.hp>0?'reaction':'final',{actor:source,target:defender,ability:command,
      amount:resource==='hp'?damage:0,mp:resource==='mp'?damage:0,hit:true});
    for (const action of actions) {
      const response=battle.data.abilities?.[action.abilityId];
      if (!response || !hurtsHp(response) || response.mp>defender.mp ||
          response.forbiddenConditions?.some(id=>defender.conditions.includes(id))) continue;
      const allies=preview.players.filter(unit=>unit.hp>0&&!unit.removed&&!unit.escaped&&!unit.hidden);
      const targets=response.all||action.all?allies:action.target?.side==='player'?[action.target]:[source];
      for (const victim of targets) {
        const amount=predictedDamage(calculate,defender,victim,response,targets.length);
        total+=Math.min(victim.hp,amount)+(amount>=victim.hp?victim.maxHp:0);
      }
    }
  }
  return total/3;
}

export function autoBattleInput(battle, unit, calculate) {
  const index = battle.players.indexOf(unit);
  if (index < 0) return false;
  const scripted = battle.events?.autoCommand(unit);
  if (scripted && battle.choose(index, scripted.abilityId, scripted.targetIndex)) return true;
  if (battle.ymirHead?.hidden) return battle.choose(index, 2);
  const commands = battle.commandsFor(index).filter(command => !command.disabled &&
    (command.kind === 'item' || battle.supported(command)));
  const allies = living(battle, battle.players), enemies = living(battle, battle.enemies);
  const flee=()=>{
    const instant=commands.filter(command=>hasFunction(command,16)&&command.all&&command.target==='ally')
      .sort((a,b)=>(a.mp||0)-(b.mp||0))[0];
    if(instant&&battle.choose(index,instant.id,sameSideTarget(battle.players,unit)))return true;
    return battle.requestEscape();
  };
  if (battle.escapeState?.active) return battle.canEscape&&commands.some(command=>hasFunction(command,16)&&command.all&&command.target==='ally')
    ? flee() : battle.choose(index,2);
  if (battle.context.randomEncounter && !battle.isVeldt && battle.canEscape) {
    for (const enemy of enemies) {
      const threat = fatalFinalAttack(battle,enemy,allies,calculate);
      if (!threat) continue;
      const control = counterControl(battle,unit,enemy,threat);
      battle.warning('Automatic input detected a potentially lethal PR final attack; attempting condition control or an ordinary escape. Confusion is treated as suppressing the final-action branch.');
      if (control && battle.choose(index,control.id,{side:'enemy',index:battle.enemies.indexOf(enemy)})) return true;
      if (allies.some(ally => counterControl(battle,ally,enemy,threat))) return battle.choose(index,2);
      return flee();
    }
    const incoming = enemies.reduce((sum, enemy) => {
      const ids=[1,...(enemy.aiState?.program?.ops||[]).filter(([op])=>
        ['Act','LoopAct','FirstAttackAct'].includes(op)).flatMap(([,ids=[],weights=[]])=>ids.filter((_,n)=>weights[n]!==0))];
      return sum+Math.max(0,...ids.map(id=>battle.data.abilities?.[id]).filter(ability=>ability&&hurtsHp(ability)&&
        ability.mp<=enemy.mp&&!ability.forbiddenConditions?.some(id=>(enemy.conditions||[]).includes(id)))
        .map(ability=>ability.all?allies.reduce((n,target)=>n+predictedDamage(calculate,enemy,target,ability,allies.length),0):
          Math.max(...allies.map(target=>predictedDamage(calculate,enemy,target,ability,1)))));
    }, 0);
    const outgoing = allies.reduce((sum, ally) => sum + Math.max(1, ...battle.commandsFor(battle.players.indexOf(ally))
      .filter(command => !command.disabled && hurtsHp(command) && command.target !== 'ally')
      .flatMap(command=>attackOptions(command,enemies)).map(option=>optionDamage(battle,ally,option,calculate))), 0);
    const retaliation=allies.reduce((sum,ally)=>{
      const options=battle.commandsFor(battle.players.indexOf(ally)).filter(command=>!command.disabled&&hurtsHp(command)&&command.target!=='ally')
        .flatMap(command=>attackOptions(command,enemies)).map(option=>({damage:optionDamage(battle,ally,option,calculate),
          cost:optionCounterCost(battle,ally,option,calculate)})).sort((a,b)=>(b.damage-b.cost)-(a.damage-a.cost));
      return sum+(options[0]?.cost||0);
    },0);
    const roundsToWin = enemies.reduce((sum, enemy) => sum + enemy.hp, 0) / Math.max(1, outgoing),
      roundsToFall = allies.reduce((sum, ally) => sum + ally.hp, 0) / Math.max(1, incoming+retaliation);
    if ((roundsToWin > 1.5 && roundsToFall < roundsToWin * 0.8 ||
        roundsToWin > .5 && roundsToFall < .9 ||
        roundsToWin > 1 && retaliation > allies.reduce((sum,ally)=>sum+ally.hp,0)*.6) && flee()) return true;
  }
  const weak = [...allies].sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
  const fallen = battle.players.filter(target => !target.removed && !target.escaped && !target.hidden && target.hp <= 0);
  const revivals = commands.filter(command => command.revive ||
    hasFunction(command, 34) && conditionIds(battle, command).includes(5));
  const heal = () => {
    if (!weak) return false;
    const heals = commands.filter(command => command.kind === 'heal' && command.power > 0 && !command.revive ||
      command.kind === 'item' && !command.revive &&
      [1, 4].includes(battle.data.items?.[command.itemId]?.battle_function_group_id));
    const missing = weak.maxHp - weak.hp,wounded=allies.filter(ally=>ally.hp<ally.maxHp);
    const totalMissing=allies.reduce((sum,ally)=>sum+ally.maxHp-ally.hp,0),options=[];
    for(const command of heals){
      const single=healingAmount(command,weak,1),singleGain=Math.min(missing,single);
      if(!command.all&&singleGain>0)options.push({command,target:sameSideTarget(battle.players,weak),
        cost:(totalMissing-singleGain)*2+(command.mp||0)+Math.max(0,single-singleGain)/20});
      if(command.all || wounded.length>=2&&command.selectableAll){
        const amounts=allies.map(ally=>healingAmount(command,ally,allies.length));
        const gain=amounts.reduce((sum,amount,n)=>sum+Math.min(allies[n].maxHp-allies[n].hp,amount),0);
        if(gain>0&&(command.all||gain>singleGain))options.push({command,target:{...sameSideTarget(battle.players,weak),all:true},
          cost:(totalMissing-gain)*2+(command.mp||0)+Math.max(0,amounts.reduce((sum,n)=>sum+n,0)-gain)/20});
      }
    }
    options.sort((a,b)=>a.cost-b.cost);
    for(const option of options)
      if(battle.choose(index,option.command.id,option.target))return true;
    return false;
    function healingAmount(command,ally,count) {
      const amount=command.kind==='item'?Number(command.amount||ally.maxHp-ally.hp):
        predictedDamage(calculate,unit,ally,{...command,kind:'heal'},count);
      return ally.undead||hasType(battle,ally,34)?-amount:amount;
    }
  };
  // A Phoenix Down restores little HP. Stabilise the remaining party before
  // spending every turn raising a member who cannot survive the next attack.
  if (fallen.length && weak && weak.hp < weak.maxHp * (allies.length === 1 ? 0.75 : 0.3) && heal()) return true;
  // Remove meaningful enemy Haste/protection before repeating a resurrection
  // that the same strengthened enemy can immediately undo.
  if(sourceStateInput(battle,unit,commands,allies,enemies,calculate,{defensive:false}))return true;
  if (fallen.length) {
    // Preserve a healer when possible. A Phoenix Down remains a normal item
    // use and costs the acting character's turn.
    fallen.sort((a, b) => Number(hasHealing(b)) - Number(hasHealing(a)) || b.maxHp - a.maxHp);
    for (const command of revivals.sort((a, b) => (a.mp || 0) - (b.mp || 0)))
      if (battle.choose(index, command.id, sameSideTarget(battle.players, fallen[0]))) return true;
  }
  if (weak && weak.hp / weak.maxHp < 0.55 && heal()) return true;
  const healingCosts=commands.filter(command=>command.kind==='heal'&&!command.revive&&!command.magiciteSummon&&command.mp>0)
    .map(command=>command.mp),healingReserve=healingCosts.length?Math.min(...healingCosts)*2:0;
  if (unit.mp < Math.max(unit.maxMp * 0.25,healingReserve) && (commands.some(command => command.mp > 0) ||
      (unit.abilities || []).some(id => battle.data.abilities?.[id]?.mp > unit.mp))) {
    let siphon=null;
    for(const command of commands.filter(command=>mpAttack(command)&&functionsOf(command).some(fn=>fn.id===13&&fn.values?.[0]===2&&fn.values?.[1]>0))){
      const percent=functionsOf(command).find(fn=>fn.id===13&&fn.values?.[0]===2).values[1]/100;
      for(const enemy of enemies){
        if(enemy.undead||hasType(battle,enemy,34)||!(enemy.mp>0))continue;
        const amount=predictedDamage(calculate,unit,enemy,command,1);
        const gain=Math.min(unit.maxMp-unit.mp+(command.mp||0),Math.min(enemy.mp,amount)*percent)-(command.mp||0);
        const score=gain*9-predictedCounterCost(battle,unit,enemy,command,Math.min(enemy.mp,amount),calculate);
        if(gain>=Math.max(5,(command.mp||0)*3)&&score>0&&(!siphon||score>siphon.score))siphon={command,enemy,score};
      }
    }
    if(siphon&&battle.choose(index,siphon.command.id,{side:'enemy',index:battle.enemies.indexOf(siphon.enemy)}))return true;
    const ether = commands.find(command => command.kind === 'item' &&
      [3, 4].includes(battle.data.items?.[command.itemId]?.battle_function_group_id));
    if (ether && battle.choose(index, ether.id, sameSideTarget(battle.players, unit))) return true;
  }
  const runic = commands.find(command => functionsOf(command).some(fn => fn.id === 9 &&
    battle.data.conditions?.[fn.values?.[0]]?.condition_type === 612));
  if (runic && enemies.some(enemy => (enemy.aiState?.program?.ops || []).some(([op, ids = []]) =>
    /Act/.test(op) && ids.some(id => {
      const ability = battle.data.abilities?.[id];
      return ability?.flags?.includes(3) && ability.mp > 0 && hasFunction(ability, 3, 69) &&
        allies.some(ally => predictedDamage(calculate, enemy, ally, ability, 1) > ally.maxHp * 0.65);
    })))) {
    if (unit.runic) return false;
    if (battle.choose(index, runic.id, sameSideTarget(battle.players, unit))) return true;
  }
  // Remove immobilising or damaging conditions with ordinary antidotes and
  // restorative spells. Hidden battle-script markers are never dispelled.
  for (const ally of allies) {
    const harmful = (ally.conditions || []).filter(id => [6, 7, 9, 10, 11, 12, 13, 15, 16, 26, 88, 89, 90].includes(id));
    if (!harmful.length) continue;
    for (const command of commands.filter(command => conditionIds(battle, command).some(id => harmful.includes(id))))
      if (battle.choose(index, command.id, sameSideTarget(battle.players, ally))) return true;
  }
  if(sourceStateInput(battle,unit,commands,allies,enemies,calculate,{offensive:false}))return true;
  const target = enemies.find(enemy => enemy.role !== 'ymir-shell') || enemies[0];
  if (!target) return battle.choose(index, 2);
  const attacks = commands.filter(command => command.kind !== 'item' &&
    command.kind !== 'heal' && command.kind !== 'defend' &&
    ![1, 2, 5, 12].includes(command.range) &&
    (hurtsHp(command) || enemies.some(enemy=>enemy.diesAtZeroMp)&&mpAttack(command) || command.id === 1));
  let best = { command: commands.find(command => command.id === 1), target, all:false, score: -Infinity }, anyDamage=false;
  for (const command of attacks) {
    for (const option of attackOptions(command,enemies)) {
      const damage=optionDamage(battle,unit,option,calculate);
      anyDamage ||= damage>0;
      let score=damage-optionCounterCost(battle,unit,option,calculate);
      // A finite MP pool must survive several ordinary encounters. Pay for
      // added total damage, including real AoE and overkill limits; reserve
      // two actual cheap healing casts when the actor owns one.
      const cost=command.mp||0,price=unit.mp<unit.maxMp*.3?12:9;
      score-=cost*price+Math.max(0,healingReserve-(unit.mp-cost))*price;
      if (score > best.score) best = {...option,score};
    }
  }
  if(!anyDamage && commands.some(command=>command.id===2))return battle.choose(index,2);
  if (best.command && battle.choose(index, best.command.id,{side:'enemy',index:battle.enemies.indexOf(best.target),all:best.all})) return true;
  return battle.choose(index,1,{side:'enemy',index:battle.enemies.indexOf(target),all:false});

  function hasHealing(actor) {
    return (actor.abilities || []).some(id => battle.data.abilities?.[typeof id === 'object' ? id.id : id]?.kind === 'heal');
  }
}
