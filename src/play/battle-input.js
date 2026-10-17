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

export function autoBattleInput(battle, unit, calculate) {
  const index = battle.players.indexOf(unit);
  if (index < 0) return false;
  const scripted = battle.events?.autoCommand(unit);
  if (scripted && battle.choose(index, scripted.abilityId, scripted.targetIndex)) return true;
  if (battle.ymirHead?.hidden) return battle.choose(index, 2);
  const commands = battle.commandsFor(index).filter(command => !command.disabled &&
    (command.kind === 'item' || battle.supported(command)));
  const allies = living(battle, battle.players), enemies = living(battle, battle.enemies);
  if (battle.context.randomEncounter && !battle.isVeldt && battle.canEscape) {
    const incoming = enemies.reduce((sum, enemy) => sum + predictedDamage(calculate, enemy, unit,
      battle.data.abilities?.[1] || {kind:'physical',power:0}, 1), 0);
    const outgoing = allies.reduce((sum, ally) => sum + Math.max(1, ...battle.commandsFor(battle.players.indexOf(ally))
      .filter(command => !command.disabled && hurtsHp(command) && command.target !== 'ally')
      .map(command => Math.max(...enemies.map(enemy => predictedDamage(calculate,ally,enemy,command,1))))), 0);
    const roundsToWin = enemies.reduce((sum, enemy) => sum + enemy.hp, 0) / Math.max(1, outgoing),
      roundsToFall = allies.reduce((sum, ally) => sum + ally.hp, 0) / Math.max(1, incoming);
    if (roundsToWin > 1.5 && roundsToFall < roundsToWin * 0.8 && battle.requestEscape()) return true;
  }
  const weak = [...allies].sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
  const fallen = battle.players.filter(target => !target.removed && !target.escaped && !target.hidden && target.hp <= 0);
  const revivals = commands.filter(command => command.revive ||
    hasFunction(command, 34) && conditionIds(battle, command).includes(5));
  if (fallen.length) {
    // Preserve a healer when possible. A Phoenix Down remains a normal item
    // use and costs the acting character's turn.
    fallen.sort((a, b) => Number(hasHealing(b)) - Number(hasHealing(a)) || b.maxHp - a.maxHp);
    for (const command of revivals.sort((a, b) => (a.mp || 0) - (b.mp || 0)))
      if (battle.choose(index, command.id, sameSideTarget(battle.players, fallen[0]))) return true;
  }
  if (unit.mp < unit.maxMp * 0.15 && (commands.some(command => command.mp > 0) ||
      (unit.abilities || []).some(id => battle.data.abilities?.[id]?.mp > unit.mp))) {
    const ether = commands.find(command => command.kind === 'item' &&
      [3, 4].includes(battle.data.items?.[command.itemId]?.battle_function_group_id));
    if (ether && battle.choose(index, ether.id, sameSideTarget(battle.players, unit))) return true;
  }
  if (weak && weak.hp / weak.maxHp < 0.55) {
    const heals = commands.filter(command => command.kind === 'heal' && command.power > 0 && !command.revive ||
      command.kind === 'item' && !command.revive &&
      [1, 4].includes(battle.data.items?.[command.itemId]?.battle_function_group_id));
    const missing = weak.maxHp - weak.hp;
    heals.sort((a, b) => healingCost(a) - healingCost(b));
    for (const command of heals) {
      if (battle.choose(index, command.id, sameSideTarget(battle.players, weak))) return true;
    }
    function healingCost(command) {
      const amount = command.kind === 'item' ? Number(command.amount || missing) :
        predictedDamage(calculate, unit, weak, { ...command, kind: 'heal' }, 1);
      // Prefer a sufficient heal; avoid spending a turn on fifty HP late in
      // the game when the actor has a stronger affordable spell.
      return Math.max(0, missing - amount) * 2 + (command.mp || 0) + Math.max(0, amount - missing) / 20;
    }
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
  let best = { command: commands.find(command => command.id === 1), target, score: -Infinity };
  for (const command of attacks) {
    for (const victim of enemies.filter(enemy => enemy.role !== 'ymir-shell' || enemies.length === 1)) {
      const targets = command.all ? enemies : [victim];
      let score = targets.reduce((sum, enemy) => sum +
        Math.min(enemy.hp, predictedDamage(calculate, unit, enemy, command, targets.length)), 0);
      // MP is finite and must last between rests. Cast when it materially
      // outperforms a free move; retain enough for one emergency Cure.
      score -= (command.mp || 0) * (unit.mp < unit.maxMp * 0.3 ? 5 : 1.5);
      if (score > best.score) best = { command, target: victim, score };
    }
  }
  if (best.command && battle.choose(index, best.command.id, battle.enemies.indexOf(best.target))) return true;
  return battle.choose(index, 1, battle.enemies.indexOf(target));

  function hasHealing(actor) {
    return (actor.abilities || []).some(id => battle.data.abilities?.[typeof id === 'object' ? id.id : id]?.kind === 'heal');
  }
}
