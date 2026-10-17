const dirs = ["up", "right", "down", "left"];
const deltas = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];
const speeds = [0.24, 0.48, 0.12, 0.96, 0.06, 1.92, 0.16];
const routeBanks = [
  "ScenarioFlag1",
  "ScenarioFlag2",
  "ScenarioFlag3",
  "ScenarioFlag4",
  "TreasureFlag1",
  "TreasureFlag2",
  "TreasureFlag3",
  "TreasureFlag4",
  "ScenarioVariable",
  "AreaLocalVariable",
  "MapLocalVariable",
  "ScriptLocalVariable",
  "MessageSelection",
  "ItemSelection",
];
const core = new Set(
  "Nop Blank Exit Return Call Jump JumpBattleAI ChangeScript Branch Calc SetFlag ResetFlag FlipFlag SetRandomValue Wait SetPuppet ExecPuppet FinishPuppet SetEntities LookAt Hide Show HidePlayer ShowPlayer CueAnim PlayAnim Msg MsgClose MsgFinishWait MsgFinishWaitAll Select ChangeMap Encount EncountBoss OrganizePartySlot ChangePartySlot GetItem RemoveItem RemoveGil RecoveryHP RecoveryMP SubtractionHP AddCondition RemoveCondition RideVehicleNPC LoseVehicle OnTheVehicle SetVehicle SwitchVehicleActive PlayBGM ReplayBgm StopBGM PlaySE PlayEnvSe StopEnvSe FadeIn FadeOut ShowMapTitle AutoSave RemoveTelepoCache AddTelepoCache CastTelepo HideMob RestoreMob SysCall TreasureBox GoToTitle OpenSaveWindow SetTimer FinishTimer".split(
    " ",
  ),
);
const effects = new Set(
  "BackdropColor BattleAnim ChangeMapRenderArea ChangeView ColorFade Flash Orient PauseBGM PauseEnvSe PitchEnvSe PlayBattleEffect ReadyBGM ResetAnimOnlyJockey ScreenEffect SetAnimOnlyJockey SetVolume Shake StopSE SyncBGM SyncBattleEffect SyncSE Water LoadSE".split(
    " ",
  ),
);
// PR SetPos/Lerp/MoveTo requests are 1-based; zero preserves the actor's layer.
const sourceLayer = (request, current = 1) => (request > 0 ? request - 1 : current);
const warning = (game, task, message) => {
  game.instructionWarnings ??= new Set();
  if (!game.instructionWarnings.has(message)) {
    game.instructionWarnings.add(message);
    game.warn(task, message);
  }
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
    warning(
      game,
      task,
      "Assigned NPC route data is unavailable; NPC retains its current position.",
    );
    return;
  }
  const ops = [];
  const op = (name, i = [], r = [], s = []) => ops.push([name, i, r, s, 2, ""]);
  const routeLayer = (row) => {
    const raw = row.layer ?? actor.layer,
      layers = Object.keys(game.map.collisions || {}).map(Number);
    if (!layers.length) return raw + 1;
    const candidates = [raw, raw - 1].filter((layer) => layers.includes(layer));
    const selected = candidates.includes(actor.layer)
      ? actor.layer
      : (candidates[0] ?? actor.layer);
    if (selected !== raw)
      warning(
        game,
        task,
        `NPC route layer ${raw} resolves to existing walking layer ${selected}; PR route layer numbering is inferred from the map grid and actor.`,
      );
    return selected + 1;
  };
  for (const entry of instructions) {
    const row = entry.raw ?? entry;
    switch (row.instruction_type) {
      // NPC routes store a walking-layer index; puppet operands use index+1.
      case 1:
        op(
          "Route",
          [row.cellx, row.celly, routeLayer(row), row.speed_id ?? -1],
          [],
          [row.animation_key ?? ""],
        );
        break;
      case 2:
        op("Wait", [], [Math.max(0, row.delay_sec ?? 0)]);
        break;
      case 3:
        if (row.delay_sec > 0) op("Wait", [], [row.delay_sec]);
        op("PlayAnim", [0, row.loop_cnt ?? 1], [], [row.animation_key ?? "Default"]);
        break;
      case 4:
        op("CueAnim", [], [], [row.animation_key ?? "Default"]);
        break;
      case 5:
      case 6:
        if (row.delay_sec > 0) op("Wait", [], [row.delay_sec]);
        op(row.instruction_type === 5 ? "Show" : "Hide");
        if (row.duration > 0) op("Wait", [], [row.duration]);
        break;
      case 7:
        op(
          "Lerp",
          [row.cellx, row.celly, routeLayer(row)],
          [row.duration ?? 0.24, row.jump_height ?? 0],
          [row.animation_key ?? ""],
        );
        break;
      case 8:
        op("PlaySE", [row.se_id ?? 0]);
        break;
      case 9:
      case 10: {
        const bank = routeBanks[row.category];
        if (!bank) {
          warning(
            game,
            task,
            `NPC route storage category ${row.category} is unknown; instruction skipped.`,
          );
          break;
        }
        if (row.instruction_type === 9)
          op("Calc", [row.index ?? 0, row.value ?? 0], [], [bank, "←", "imm"]);
        else {
          const pc = ops.length;
          op("Branch", [row.index ?? 0, row.value ?? 0, pc + 3], [], [bank, "＝", "imm"]);
          op("Wait", [], [0.05]);
          op("Jump", [pc]);
        }
        break;
      }
      default:
        warning(game, task, `NPC route instruction ${row.instruction_type} is deferred.`);
        break;
    }
  }
  // A small delay also keeps authored zero-duration looping routes cooperative.
  if (loop) {
    op("Wait", [], [0.05]);
    op("Jump", [0]);
  } else op("Exit");
  const name = `npc-route-${game.mapId}-${actorId}-${routeId}`;
  game.data.programs[name] = { name, ops, locals: [] };
  game.data.global[name] = name;
  const child = game.startScript(name, { actor: actorId, background: true });
  game.assignedRouteTasks.set(actorId, child);
}
// Called before PlayGame's ordinary switch. False leaves the existing implementation in control.
export function executeInstruction(
  game,
  task,
  name,
  i = [],
  r = [],
  s = [],
  actor = game.actor(task.actor),
) {
  const layer = sourceLayer;
  switch (name) {
    case "SetPos": {
      const reference = i[3] === 1 ? game.actor(i[4]) : null;
      const x = reference
        ? Math.floor(reference.x) + (i[0] ?? 0)
        : i[0] < 0
          ? actor.x
          : (i[0] ?? actor.x);
      const y = reference
        ? Math.floor(reference.y) + (i[1] ?? 0)
        : i[1] < 0
          ? actor.y
          : (i[1] ?? actor.y);
      Object.assign(actor, { x, y, layer: layer(i[2], actor.layer), motion: null });
      if (s[0]) actor.animation = s[0];
      if (actor === game.camera) actor.manual = true;
      return true;
    }
    case "Move":
    case "MoveBirdView": {
      const delta = deltas[i[0]] ?? [0, 0],
        steps = Math.max(0, i[1] ?? 0);
      move(
        game,
        task,
        actor,
        Math.floor(actor.x) + delta[0] * steps,
        Math.floor(actor.y) + delta[1] * steps,
        i[2],
        s[0],
      );
      if (name === "MoveBirdView")
        warning(game, task, "Bird-view movement currently uses field cells and linear movement.");
      return true;
    }
    case "MoveTo": {
      const axis = i[0] === 1 ? "y" : "x",
        reference = i[1] === 1 ? game.actor(i[2]) : null;
      const destination = reference ? reference[axis] : i[2];
      if (actor[axis] === destination) return true;
      const value = destination + (reference ? (i[3] ?? 0) : 0);
      const destinationLayer = reference ? reference.layer : layer(i[3], actor.layer);
      move(
        game,
        task,
        actor,
        axis === "x" ? value : actor.x,
        axis === "y" ? value : actor.y,
        i[4],
        s[0],
      );
      actor.layer = destinationLayer;
      return true;
    }
    case "Lerp":
      move(
        game,
        task,
        actor,
        i[0] ?? actor.x,
        i[1] ?? actor.y,
        0,
        s[0],
        Math.max(0.001, Math.abs(r[0] ?? 0.24)),
      );
      actor.layer = layer(i[2], actor.layer);
      if (r[1])
        warning(
          game,
          task,
          "Lerp preserves its destination and duration; jump-height presentation is deferred.",
        );
      return true;
    case "Route":
      move(game, task, actor, i[0] ?? actor.x, i[1] ?? actor.y, i[3], s[0]);
      actor.layer = layer(i[2], actor.layer);
      warning(
        game,
        task,
        "Puppet Route interpolates to the authored destination; obstacle path search is deferred.",
      );
      return true;
    case "AssignMoveRoute":
      beginAssignedRoute(game, task, i[0], i[1], Boolean(i[2]));
      return true;
    case "Erase":
      actor.visible = false;
      actor.motion = null;
      // Keep the removed body's tombstone: the next VM instruction resolves
      // its actor too, and a deleted entry would be recreated from the map row.
      return true;
    case "BranchByNumOfMember": {
      const count =
        i[0] === 0
          ? game.party.length
          : Object.values(game.roster).filter((unit) => unit.enabled !== false).length;
      if (game.compare(count, s[0] || "＝", i[1])) task.pc = i[2];
      return true;
    }
    case "BranchByCharacter": {
      const present =
        i[2] === 0
          ? game.partySlots[game.partyIndex].includes(i[0])
          : Boolean(game.roster[i[0]] && game.roster[i[0]].enabled !== false);
      if (present === (i[1] === 0)) task.pc = i[3];
      return true;
    }
    case "BranchByLeader":
      if (game.partySlots[game.partyIndex][0] === i[0]) task.pc = i[1];
      return true;
    case "BranchByPlayerDirection":
      task.pc = i[dirs.indexOf(game.player.direction)] ?? task.pc;
      return true;
    case "ChangeScriptAtOnTrigger":
      game.triggerActor = i[1];
      game.triggerChangesScript = Boolean(i[0]);
      game.triggerScriptProgram = task.program;
      warning(
        game,
        task,
        "Trigger interruption applies to this source program and current map; source-reset overlap callbacks are checked while stationary and before the parent resumes. Exact Unity callback ordering is approximated.",
      );
      return true;
    case "InvalidateTelepo":
      game.telepoInvalid = Boolean(i[0]);
      return true;
    case "ChangeGpsData":
      game.gpsId = i[0];
      game.event("gps", { id: i[0] });
      return true;
    case "SetGilTag": {
      const fee =
        game.data.serviceFees?.[i[0]] ??
        game.data.systemTables?.product?.find(
          (row) => Number(row.group_id) === i[0] && Number(row.content_id) === 0,
        )?.coefficient;
      game.messageTags ??= {};
      game.messageTags.GIL = String(fee?.amount ?? fee ?? 0);
      game.serviceFee = Number(fee?.amount ?? fee ?? 0);
      if (fee === undefined)
        warning(
          game,
          task,
          "Service price data is unavailable; the displayed fee defaults to zero.",
        );
      return true;
    }
    case "Tag":
      game.messageTags ??= {};
      game.messageTags[s[0]] = game.text(s[1]);
      return true;
    case "ShowHelpAndExit":
      game.event("help", { text: s[0] ? game.text(s[0]) : "" });
      task.done = true;
      return true;
    case "AddAirShipFlightAltitudeChangeTask":
    case "AddAirShipMoveTask":
    case "AddAirShipRotateChangeTask":
    case "AddAirshipUpDownMoveTask":
      game.airshipTasks ??= [];
      game.airshipTasks.push({ name, i: [...i], r: [...r] });
      return true;
    case "StartAirShipAutoManipulate": {
      const tasks = game.airshipTasks ?? [];
      const duration = Math.max(0, ...tasks.map((op) => Math.abs(op.r[0] ?? 0)));
      game.airshipTasks = [];
      if (duration) task.wait = Math.min(duration, 30);
      game.event("airship-motion", { tasks });
      warning(
        game,
        task,
        "Airship cinematic movement keeps its timing; full bird-view geometry is deferred.",
      );
      return true;
    }
  }
  if (effects.has(name)) {
    if (name === "Flash") {
      // Source0302_4 starts delayed puppet replacements, flashes twice, then
      // calls FinishPuppet. A skipped duration cancels their state changes.
      task.wait = Math.max(0, r[0] || 0);
      warning(
        game,
        task,
        "Flash waits for its positive authored duration; native tween callback timing is inferred from the concurrent source puppet sequence.",
      );
    } else if (name === "Orient") {
      const target = game.actor(i[0]),
        dx = target.x - actor.x,
        dy = target.y - actor.y;
      if (dx || dy)
        actor.direction =
          Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
    } else if (name === "SetAnimOnlyJockey" || name === "ResetAnimOnlyJockey")
      actor.animOnlyJockey = name === "SetAnimOnlyJockey";
    game.event("effect", { name, i: [...i], r: [...r], s: [...s], actor: task.actor });
    warning(
      game,
      task,
      "Some presentation instructions retain their parameters while rendering is deferred.",
    );
    return true;
  }
  if (core.has(name)) return false;
  if (game.data.mnemonics?.includes(name)) {
    warning(game, task, `Instruction ${name} has a provisional no-op effect.`);
    return true;
  }
  return false;
}
