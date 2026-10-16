const dirs = ['up', 'right', 'down', 'left'];
const deltas = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const speeds = [.24, .48, .12, .96, .06, 1.92, .16];
const core = new Set(('Nop Blank Exit Return Call Jump JumpBattleAI ChangeScript Branch Calc SetFlag ResetFlag FlipFlag SetRandomValue Wait SetPuppet ExecPuppet FinishPuppet SetEntities LookAt Hide Show HidePlayer ShowPlayer CueAnim PlayAnim Msg MsgClose MsgFinishWait MsgFinishWaitAll Select ChangeMap Encount EncountBoss OrganizePartySlot ChangePartySlot GetItem RemoveItem RemoveGil RecoveryHP RecoveryMP SubtractionHP AddCondition RemoveCondition RideVehicleNPC LoseVehicle OnTheVehicle SetVehicle SwitchVehicleActive PlayBGM ReplayBgm StopBGM PlaySE PlayEnvSe StopEnvSe FadeIn FadeOut ShowMapTitle AutoSave RemoveTelepoCache AddTelepoCache CastTelepo HideMob RestoreMob SysCall TreasureBox GoToTitle OpenSaveWindow SetTimer FinishTimer').split(' '));
const effects = new Set(('BackdropColor BattleAnim ChangeMapRenderArea ChangeView ColorFade Flash Orient PauseBGM PauseEnvSe PitchEnvSe PlayBattleEffect ReadyBGM ResetAnimOnlyJockey ScreenEffect SetAnimOnlyJockey SetVolume Shake StopSE SyncBGM SyncBattleEffect SyncSE Water LoadSE').split(' '));
// Lean maps retain PR's 1-based entity/collision layers; zero means keep the actor's layer.
const sourceLayer = (request, current = 1) => request > 0 ? request : current;
const warning = (game, task, message) => {
  game.instructionWarnings ??= new Set();
  if (!game.instructionWarnings.has(message)) { game.instructionWarnings.add(message); game.warn(task, message); }
};
function move(game, task, actor, x, y, speed, animation, duration) {
  const distance = Math.abs(x - actor.x) + Math.abs(y - actor.y);
  if (!distance) return;
  game.motion(task, actor, x, y, duration ?? distance * (speeds[speed] ?? speeds[0]), animation);
}
function beginAssignedRoute(game, task, actorId, routeId, loop) {
  game.assignedRouteTasks ??= new Map();
  const previous = game.assignedRouteTasks.get(actorId);
  if (previous) previous.done = true;
  const actor = game.actor(actorId);
  actor.routeId = routeId;
  actor.routeLoop = loop;
  const route = game.map.routes?.[routeId] ?? game.data.routes?.[routeId];
  const instructions = route?.instructions ?? route?.route ?? (Array.isArray(route) ? route : null);
  if (!instructions) {
    warning(game, task, 'Assigned NPC route data is unavailable; NPC retains its current position.');
    return;
  }
  const ops = [];
  const op = (name, i = [], r = [], s = []) => ops.push([name, i, r, s, 2, '']);
  for (const entry of instructions) {
    const row = entry.raw ?? entry;
    switch (row.instruction_type) {
      case 1: op('Route', [row.cellx, row.celly, row.layer ?? 0, row.speed_id ?? -1], [], [row.animation_key ?? '']); break;
      case 2: op('Wait', [], [Math.max(0, row.delay_sec ?? 0)]); break;
      case 3: op('PlayAnim', [0, row.loop_cnt ?? 1], [], [row.animation_key ?? 'Default']); break;
      case 4: op('CueAnim', [], [], [row.animation_key ?? 'Default']); break;
      case 5: op('Show'); break;
      case 6: op('Hide'); break;
      case 7: op('Lerp', [row.cellx, row.celly, row.layer ?? 0], [row.duration ?? .24, row.jump_height ?? 0], [row.animation_key ?? '']); break;
      case 8: op('PlaySE', [row.se_id ?? 0]); break;
      case 9: op('Calc', [row.index ?? 0, row.value ?? 0], [], [row.category === 1 ? 'ScenarioVariable' : 'MapLocalVariable', '←', 'imm']); break;
      default: warning(game, task, `NPC route instruction ${row.instruction_type} is deferred.`); break;
    }
  }
  // A small delay also keeps authored zero-duration looping routes cooperative.
  if (loop) { op('Wait', [], [.05]); op('Jump', [0]); } else op('Exit');
  const name = `npc-route-${game.mapId}-${actorId}-${routeId}`;
  game.data.programs[name] = { name, ops, locals: [] };
  game.data.global[name] = name;
  const child = game.startScript(name, { actor: actorId, background: true });
  game.assignedRouteTasks.set(actorId, child);
}
function battleUnit(game, task, actor) {
  const battle = game.battle;
  if (!battle) return null;
  return task.battleActor ?? battle.enemies.find(unit => unit.id === actor?.monsterId || unit.id === Math.abs(Number(task.actor))) ?? battle.enemies[0];
}
function targets(battle, side, selector) {
  const pool = side === 1 ? battle?.players ?? [] : battle?.enemies ?? [];
  if (selector === 0 || selector === -1) return pool;
  const unit = pool.find(unit => unit.id === selector || unit.monsterId === selector || unit.slot === selector - 1) ?? pool[selector - 1];
  return unit ? [unit] : [];
}
function act(game, task, actor, ids, weights) {
  const battle = game.battle, unit = battleUnit(game, task, actor);
  const options = ids.map((id, index) => ({ id, weight: Number(weights[index] ?? 0) })).filter(option => option.weight > 0);
  if (!options.length) return;
  let roll = game.random() * options.reduce((sum, option) => sum + option.weight, 0);
  const choice = options.find(option => (roll -= option.weight) < 0) ?? options[0];
  task.aiAction = choice.id;
  if (battle && unit) {
    const ability = game.battleData.abilities?.[choice.id];
    const pool = battle.players.filter(member => member.hp > 0);
    if (ability && pool.length) {
      battle.perform(unit, pool[Math.floor(game.random() * pool.length)], ability);
      battle.checkEnd();
    }
  }
}

// Called before PlayGame's ordinary switch. False leaves the existing implementation in control.
export function executeInstruction(game, task, name, i = [], r = [], s = [], actor = game.actor(task.actor)) {
  switch (name) {
    case 'SetPos': {
      const reference = i[3] === 1 ? game.actor(i[4]) : null;
      const x = reference ? Math.floor(reference.x) + (i[0] ?? 0) : i[0] < 0 ? actor.x : i[0] ?? actor.x;
      const y = reference ? Math.floor(reference.y) + (i[1] ?? 0) : i[1] < 0 ? actor.y : i[1] ?? actor.y;
      Object.assign(actor, { x, y, layer: sourceLayer(i[2], actor.layer), motion: null });
      if (s[0]) actor.animation = s[0];
      if (actor === game.camera) actor.manual = true;
      return true;
    }
    case 'Move': case 'MoveBirdView': {
      const delta = deltas[i[0]] ?? [0, 0], steps = Math.max(0, i[1] ?? 0);
      move(game, task, actor, Math.floor(actor.x) + delta[0] * steps, Math.floor(actor.y) + delta[1] * steps, i[2], s[0]);
      if (name === 'MoveBirdView') warning(game, task, 'Bird-view movement currently uses field cells and linear movement.');
      return true;
    }
    case 'MoveTo': {
      const axis = i[0] === 1 ? 'y' : 'x', reference = i[1] === 1 ? game.actor(i[2]) : null;
      const destination = reference ? reference[axis] : i[2];
      if (actor[axis] === destination) return true;
      const value = destination + (reference ? i[3] ?? 0 : 0);
      const layer = reference ? reference.layer : sourceLayer(i[3], actor.layer);
      move(game, task, actor, axis === 'x' ? value : actor.x, axis === 'y' ? value : actor.y, i[4], s[0]);
      actor.layer = layer;
      return true;
    }
    case 'Lerp':
      move(game, task, actor, i[0] ?? actor.x, i[1] ?? actor.y, 0, s[0], Math.max(.001, Math.abs(r[0] ?? .24)));
      actor.layer = sourceLayer(i[2], actor.layer);
      if (r[1]) warning(game, task, 'Lerp preserves its destination and duration; jump-height presentation is deferred.');
      return true;
    case 'Route':
      move(game, task, actor, i[0] ?? actor.x, i[1] ?? actor.y, i[3], s[0]);
      actor.layer = sourceLayer(i[2], actor.layer);
      warning(game, task, 'Puppet Route interpolates to the authored destination; obstacle path search is deferred.');
      return true;
    case 'AssignMoveRoute': beginAssignedRoute(game, task, i[0], i[1], Boolean(i[2])); return true;
    case 'Erase':
      actor.visible = false; actor.motion = null;
      if (task.actor !== null && task.actor !== undefined) game.actors.delete(String(task.actor));
      return true;
    case 'BranchByNumOfMember': {
      const count = i[0] === 0 ? game.party.length : Object.values(game.roster).filter(unit => unit.enabled !== false).length;
      if (game.compare(count, s[0] || '＝', i[1])) task.pc = i[2];
      return true;
    }
    case 'BranchByCharacter': {
      const present = i[2] === 0 ? game.partySlots[game.partyIndex].includes(i[0]) :
        Boolean(game.roster[i[0]] && game.roster[i[0]].enabled !== false);
      if (present === (i[1] === 0)) task.pc = i[3];
      return true;
    }
    case 'BranchByLeader':
      if (game.partySlots[game.partyIndex][0] === i[0]) task.pc = i[1];
      return true;
    case 'BranchByPlayerDirection': task.pc = i[dirs.indexOf(game.player.direction)] ?? task.pc; return true;
    case 'ChangeScriptAtOnTrigger':
      game.triggerActor = i[1];
      game.triggerChangesScript = Boolean(i[0]);
      warning(game, task, 'Trigger-script changes use the current map triggers; changing the interruption policy is deferred.');
      return true;
    case 'InvalidateTelepo': game.telepoInvalid = Boolean(i[0]); return true;
    case 'ChangeGpsData': game.gpsId = i[0]; game.event('gps', { id: i[0] }); return true;
    case 'SetGilTag': {
      const fee = game.data.serviceFees?.[i[0]];
      game.messageTags ??= {};
      game.messageTags.GIL = String(fee?.amount ?? fee ?? 0);
      game.serviceFee = Number(fee?.amount ?? fee ?? 0);
      if (fee === undefined) warning(game, task, 'Service price data is unavailable; the displayed fee defaults to zero.');
      return true;
    }
    case 'Tag':
      game.messageTags ??= {};
      game.messageTags[s[0]] = game.text(s[1]);
      return true;
    case 'ShowHelpAndExit':
      game.event('help', { text: s[0] ? game.text(s[0]) : '' });
      task.done = true;
      return true;
    case 'AddAirShipFlightAltitudeChangeTask': case 'AddAirShipMoveTask': case 'AddAirShipRotateChangeTask': case 'AddAirshipUpDownMoveTask':
      game.airshipTasks ??= [];
      game.airshipTasks.push({ name, i: [...i], r: [...r] });
      return true;
    case 'StartAirShipAutoManipulate': {
      const tasks = game.airshipTasks ?? [];
      const duration = Math.max(0, ...tasks.map(op => Math.abs(op.r[0] ?? 0)));
      game.airshipTasks = [];
      if (duration) task.wait = Math.min(duration, 30);
      game.event('airship-motion', { tasks });
      warning(game, task, 'Airship cinematic movement keeps its timing; full bird-view geometry is deferred.');
      return true;
    }
    case 'BattleInteractive': game.battleInteractive = Boolean(i[0]); return true;
    case 'BattlePause': game.battlePaused = Boolean(i[0]); return true;
    case 'BattleSleepEnemy': game.enemiesSleeping = Boolean(i[0]); return true;
    case 'BattleEndEnabled': game.battleEndEnabled = Boolean(i[0]); return true;
    case 'BattleForceExitOnSave': game.saveBattleExit = true; return true;
    case 'WaitToBattleStart': case 'ExecBattleAI': case 'SyncBattleAI': case 'BattleSyncAction':
      warning(game, task, 'Battle script timing currently follows the lean battle loop.');
      return true;
    case 'BattleForceExit':
      if (game.battle) { game.battle.enemies.forEach(unit => { unit.hp = 0; }); game.battle.checkEnd(); }
      return true;
    case 'BattleAddFellow':
      if (game.battle && !game.battle.players.some(unit => unit.id === i[0])) {
        const unit = game.unit(i[0]);
        game.battle.completeUnit(unit, game.battleData.characters?.[i[0]] ?? {}, 'player', game.battle.players.length);
        game.battle.players.push(unit);
      }
      return true;
    case 'BattleAddEnemy':
      if (game.battle) {
        const base = game.battleData.monsters?.[i[0]];
        if (base) {
          const unit = { ...base, monsterId: base.id, slot: i[1] };
          game.battle.completeUnit(unit, base, 'enemy', game.battle.enemies.length);
          game.battle.enemies.push(unit);
        } else warning(game, task, `BattleAddEnemy cannot find monster ${i[0]}; skipped.`);
      }
      return true;
    case 'BattleCondition':
      for (const unit of targets(game.battle, i[0], i[1])) {
        unit.conditions ??= [];
        unit.conditions = i[3] ? [...new Set([...unit.conditions, i[2]])] : unit.conditions.filter(id => id !== i[2]);
        if (i[2] === 607) unit.magitek = Boolean(i[3]);
      }
      warning(game, task, 'Battle-condition scripts retain condition IDs; advanced status effects are deferred.');
      return true;
    case 'BattleAction': {
      const unit = targets(game.battle, i[0], i[1])[0], ability = game.battleData.abilities?.[i[2]];
      if (unit && ability) {
        const selected = targets(game.battle, i[3], i[4]);
        selected.forEach(target => game.battle.perform(unit, target, ability, selected.length));
        game.battle.checkEnd();
      } else warning(game, task, 'Scripted battle action has no live participant; skipped.');
      return true;
    }
    case 'GetEnemyMode': {
      const unit = game.battle?.enemies.find(unit => unit.slot === i[0] - 1) ?? game.battle?.enemies[i[0] - 1];
      task.locals[i[1] ?? 0] = unit?.mode ?? 0;
      return true;
    }
    case 'SyncAI': task.aiStartedAt ??= game.time; return true;
    case 'StartTable': task.aiTable = []; return true;
    case 'EndTable': task.aiTable = null; task.wait = Math.max(task.wait || 0, .05); return true;
    case 'Act': case 'LoopAct': act(game, task, actor, i, r); return true;
    case 'ActForTarget': {
      const unit = battleUnit(game, task, actor), ability = game.battleData.abilities?.[i[2]];
      const selected = targets(game.battle, i[0], i[1]);
      if (unit && ability) { selected.forEach(target => game.battle.perform(unit, target, ability, selected.length)); game.battle.checkEnd(); }
      if (s[0]) game.event('battle-message', { text: game.text(s[0]) });
      return true;
    }
    case 'ModeSet': { const unit = battleUnit(game, task, actor); if (unit) unit.mode = i[0]; return true; }
    case 'ModeCount': { const unit = battleUnit(game, task, actor); if (unit) unit.mode = (unit.mode ?? 0) + 1; return true; }
    case 'VariableAssign': task.locals[i[0]] = i[1] ?? 0; return true;
    case 'ValueCalc': task.locals[i[0]] = game.calculate(task.locals[i[0]] ?? 0, s[0], i[1]); return true;
    case 'IsVariableComparison': if (game.compare(task.locals[i[0]] ?? 0, s[0] || '＝', i[1])) task.pc = i[2]; return true;
    case 'IsCheckHp': case 'IsCheckMp': {
      const unit = battleUnit(game, task, actor), value = unit?.[name === 'IsCheckHp' ? 'hp' : 'mp'] ?? 0;
      if (game.compare(value, s[0] || '≦', i[0])) task.pc = i[1];
      return true;
    }
    case 'IsCheckMonsterPTId': if (game.battle?.encounterId === i[0]) task.pc = i[1]; return true;
    case 'IsTimerJump': if (game.time - (task.aiStartedAt ?? game.time) >= r[0]) task.pc = i[0]; return true;
    case 'IsOnlyAlive': if (game.battle?.enemies.filter(unit => unit.hp > 0).length === 1) task.pc = i[0]; return true;
    case 'IsMyCondition': {
      const unit = battleUnit(game, task, actor);
      if (unit?.conditions?.includes(i[0])) task.pc = i[1];
      return true;
    }
    case 'IsCondition': case 'IsNotCondition': {
      const found = targets(game.battle, i[0], i[1]).some(unit => unit.conditions?.includes(i[2]));
      if (found === (name === 'IsCondition')) task.pc = i[3];
      return true;
    }
    case 'IsUnitAlive': {
      const alive = targets(game.battle, i[0], i[1]).some(unit => unit.hp > 0);
      if (alive === (i[3] !== 2)) task.pc = i[2];
      return true;
    }
    case 'IsUnitAliveCount': {
      const count = targets(game.battle, i[0], 0).filter(unit => unit.hp > 0).length;
      if (game.compare(count, s[0] || '＝', i[1])) task.pc = i[2];
      return true;
    }
    case 'ExecMsg': case 'AttackAfterMes':
      if (s[0]) game.event('battle-message', { text: game.text(s[0]) });
      else warning(game, task, 'Numeric enemy message lookup is deferred.');
      return true;
    case 'DeleteExecMsg': game.dialogue = null; return true;
    case 'MonsterActRemove': task.aiCounters = []; return true;
  }
  if (effects.has(name)) {
    if (name === 'Orient') {
      const target = game.actor(i[0]), dx = target.x - actor.x, dy = target.y - actor.y;
      if (dx || dy) actor.direction = Math.abs(dx) > Math.abs(dy) ? dx > 0 ? 'right' : 'left' : dy > 0 ? 'down' : 'up';
    } else if (name === 'SetAnimOnlyJockey' || name === 'ResetAnimOnlyJockey') actor.animOnlyJockey = name === 'SetAnimOnlyJockey';
    game.event('effect', { name, i: [...i], r: [...r], s: [...s], actor: task.actor });
    warning(game, task, 'Some presentation instructions retain their parameters while rendering is deferred.');
    return true;
  }
  if (/^(Counter|Final|First|Damaged|TimerAttack)/.test(name)) {
    task.aiCounters ??= [];
    task.aiCounters.push({ name, i: [...i], r: [...r], s: [...s] });
    warning(game, task, 'Advanced enemy counters and timed action tables are deferred.');
    return true;
  }
  if (name.startsWith('Is') || name === 'TimerAddValiable') {
    warning(game, task, `Enemy instruction ${name} currently continues without its optional branch.`);
    return true;
  }
  if (core.has(name)) return false;
  if (game.data.mnemonics?.includes(name)) {
    warning(game, task, `Instruction ${name} has a provisional no-op effect.`);
    return true;
  }
  return false;
}
