// Automatic play submits the same commands as the battle menu. Predictions
// never consume the game's random sequence, grant abilities, or alter stats.
const functionsOf = ability => ability.functions || [];
const hasFunction = (ability, ...ids) => functionsOf(ability).some(fn => ids.includes(fn.id));
const hurtsHp = ability => functionsOf(ability).some(fn => [2,78].includes(fn.id) ||
  [3,69,77].includes(fn.id) && fn.values?.[0] !== 2);
const conditionIds = (battle, ability) => functionsOf(ability).flatMap(fn =>
  [11, 38].includes(fn.id) ? [Number(fn.values?.[0])] : fn.id === 12
    ? (battle.data.conditionGroups || []).filter(row => row.group_id === fn.values?.[0]).map(row => row.condition_id) : []);
const living = (battle, units) => units.filter(unit => battle.targetable(unit));
const sameSideTarget = (units, unit) => ({ side: unit.side || 'player', index: units.indexOf(unit) });

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
    defender.hp = Math.max(0, defender.hp - damage);
    const preview = { data:battle.data,elapsed:battle.elapsed,encounterId:battle.encounterId,
      players:battle.players.map(unit=>copies.get(unit)),enemies:battle.enemies.map(unit=>copies.get(unit)),
      aiQueue:[],random:()=>roll,warning:()=>{},addLog:()=>{},event:()=>{},queueAIAction:action=>actions.push(action) };
    const ai = Object.assign(Object.create(Object.getPrototypeOf(live)),live,{
      battle:preview,unit:defender,vars:[...live.vars],pending:[],output:[],visits:new Set(live.visits),running:false,
    });
    defender.aiState=ai;
    ai.wake(defender.hp>0?'reaction':'final',{actor:source,target:defender,ability:command,amount:damage,hit:true});
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
      .map(command => Math.max(...enemies.map(enemy => predictedDamage(calculate,ally,enemy,command,1))))), 0);
    const retaliation=allies.reduce((sum,ally)=>{
      const options=battle.commandsFor(battle.players.indexOf(ally)).filter(command=>!command.disabled&&hurtsHp(command)&&command.target!=='ally')
        .flatMap(command=>enemies.map(enemy=>{
          const damage=predictedDamage(calculate,ally,enemy,command,command.all?enemies.length:1);
          return {damage,cost:predictedCounterCost(battle,ally,enemy,command,damage,calculate)};
        })).sort((a,b)=>(b.damage-b.cost)-(a.damage-a.cost));
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
    const missing = weak.maxHp - weak.hp;
    heals.sort((a, b) => healingCost(a) - healingCost(b));
    for (const command of heals)
      if (battle.choose(index, command.id, sameSideTarget(battle.players, weak))) return true;
    return false;
    function healingCost(command) {
      const amount = command.kind === 'item' ? Number(command.amount || missing) :
        predictedDamage(calculate, unit, weak, { ...command, kind: 'heal' }, 1);
      return Math.max(0, missing - amount) * 2 + (command.mp || 0) + Math.max(0, amount - missing) / 20;
    }
  };
  // A Phoenix Down restores little HP. Stabilise the remaining party before
  // spending every turn raising a member who cannot survive the next attack.
  if (fallen.length && weak && weak.hp < weak.maxHp * (allies.length === 1 ? 0.75 : 0.3) && heal()) return true;
  if (fallen.length) {
    // Preserve a healer when possible. A Phoenix Down remains a normal item
    // use and costs the acting character's turn.
    fallen.sort((a, b) => Number(hasHealing(b)) - Number(hasHealing(a)) || b.maxHp - a.maxHp);
    for (const command of revivals.sort((a, b) => (a.mp || 0) - (b.mp || 0)))
      if (battle.choose(index, command.id, sameSideTarget(battle.players, fallen[0]))) return true;
  }
  if (weak && weak.hp / weak.maxHp < 0.55 && heal()) return true;
  if (unit.mp < unit.maxMp * 0.15 && (commands.some(command => command.mp > 0) ||
      (unit.abilities || []).some(id => battle.data.abilities?.[id]?.mp > unit.mp))) {
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
  const target = enemies.find(enemy => enemy.role !== 'ymir-shell') || enemies[0];
  if (!target) return battle.choose(index, 2);
  const attacks = commands.filter(command => command.kind !== 'item' &&
    command.kind !== 'heal' && command.kind !== 'defend' &&
    ![1, 2, 5, 12].includes(command.range) &&
    (hurtsHp(command) || command.id === 1));
  let best = { command: commands.find(command => command.id === 1), target, score: -Infinity }, anyDamage=false;
  for (const command of attacks) {
    for (const victim of enemies.filter(enemy => enemy.role !== 'ymir-shell' || enemies.length === 1)) {
      const targets = command.all ? enemies : [victim];
      let score = targets.reduce((sum, enemy) => {
        const result=calculate(unit,enemy,command,()=>0.25,targets.length);
        const amount=result.missed||result.resource==='mp'?0:result.amount||0;
        anyDamage ||= amount>0;
        return sum+(amount<0?-Math.min(enemy.maxHp-enemy.hp,-amount):Math.min(enemy.hp,amount));
      },0);
      score -= targets.reduce((sum, enemy) => sum + predictedCounterCost(battle,unit,enemy,command,
        predictedDamage(calculate,unit,enemy,command,targets.length),calculate),0);
      // MP is finite and must last between rests. Cast when it materially
      // outperforms a free move; retain enough for one emergency Cure.
      score -= (command.mp || 0) * (unit.mp < unit.maxMp * 0.3 ? 5 : 1.5);
      if (score > best.score) best = { command, target: victim, score };
    }
  }
  if(!anyDamage && commands.some(command=>command.id===2))return battle.choose(index,2);
  if (best.command && battle.choose(index, best.command.id, battle.enemies.indexOf(best.target))) return true;
  return battle.choose(index, 1, battle.enemies.indexOf(target));

  function hasHealing(actor) {
    return (actor.abilities || []).some(id => battle.data.abilities?.[typeof id === 'object' ? id.id : id]?.kind === 'heal');
  }
}
