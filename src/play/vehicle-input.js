// Manual controls and auto play share these inputs. Only transportation-table
// callbacks (ordinary takeoff/landing/deck scripts) may be dispatched here.
// Destination story scripts, ScenarioFlags and arbitrary coordinates are never
// accepted as input. SetVehicle/LoseVehicle legitimately change release flags.
import { worldCollisionByFoot } from "./encounters.js";
import { checkFlightEncounterContact } from "./flight-encounters.js";
import { fieldTerrainBlockerAt } from "./field-collision.js";
const selectors = Object.freeze({
  "乗り物に乗る：船": 2,
  "乗り物に乗る：チョコボ": 3,
  "乗り物に乗る：チョコボ(アニメ・BGMなし)": 3,
  "乗り物に乗る：ブラックジャック号": 4,
  "乗り物に乗る：ブラックジャック号(アニメ・BGMなし)": 4,
  "乗り物に乗る：ファルコン号": 5,
  "乗り物に乗る：ファルコン号(アニメ・BGMなし)": 5,
  "乗り物に乗る：魔導アーマー": 6,
  "乗り物に乗る：トランスティナ": 7,
  "乗り物に乗る：鳥": 8,
});
export const vehicleInputSelectors = Object.freeze([
  ...Object.keys(selectors),
  "乗り物から降りる",
  "乗り物から降りる(アニメ・BGMなし)",
  "飛空艇着陸時演出開始",
  "バードビュー情報を保存",
  "バードビュー情報を設定",
  "リーダーがチョコボに乗る",
]);
const directions = ["up", "right", "down", "left"];
const steps = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];
const state = (game) => ((game.banks ??= {}).PlaySystems ??= {});
const rows = (game, key) => game.data?.systemTables?.[key] ?? [];
const definition = (game, id) =>
  rows(game, "transportation").find((row) => Number(row.id) === Number(id));
const currentId = (game) => Number(game.player?.vehicle || 1);
const airship = (id) => id === 4 || id === 5;
const world = (game) => Boolean(game.map?.worldTerrain);
const emit = (game, kind, payload) => game.event?.(kind, payload);
const warn = (game, task, message) => game.warn?.(task, message);
const pose = (game) => ({
  mapId: Number(game.mapId),
  x: game.player.x,
  y: game.player.y,
  layer: game.player.layer,
  direction: game.player.direction,
});
const records = (game) => (state(game).vehicles ??= {});

function release(game, row, value) {
  if (!row) return;
  const index = Number(row.release_flag),
    name = `TreasureFlag${Math.floor(index / 256) + 1}`;
  (game.banks[name] ??= {})[index % 256] = value;
}
function available(game, id) {
  const row = definition(game, id),
    record = game.banks?.PlaySystems?.vehicles?.[id];
  if (!row || !record || record.mapId < 1) return false;
  const index = Number(row.release_flag),
    bank = game.banks?.[`TreasureFlag${Math.floor(index / 256) + 1}`];
  // Older saves have parking but did not write the source release flag. An
  // explicitly cleared flag still wins; mere table/actor inspection owns none.
  return bank && Object.hasOwn(bank, index % 256)
    ? Number(bank[index % 256]) === 1
    : record.enabled !== false;
}
function asset(game, id) {
  const row = definition(game, id);
  return game.data?.fieldAssets?.[Number(row?.asset_id)];
}
function actorSelector(game, id) {
  const character = Number(asset(game, id)?.character_id);
  return character > 0 ? -character : null;
}
function appearance(game, actor, id) {
  if (id > 1) {
    actor.walkAsset ??= actor.asset;
    const field = asset(game, id);
    if (field?.asset_name) actor.asset = field.asset_name;
    actor.vehicle = id;
  } else {
    const member = game.party?.[0]?.id,
      field = game.data?.fieldAssets?.[member];
    actor.asset =
      actor === game.player
        ? (field?.asset_name ?? actor.walkAsset ?? actor.asset)
        : (actor.walkAsset ?? actor.asset);
    actor.vehicle = null;
    delete actor.walkAsset;
  }
}

// Call after map entry (or updateVehicleInput once per tick) so source puppets
// -103/-104 refer to the parked airships and use their real PR field assets.
export function syncVehicleActors(game) {
  if (!game.actor || !game.player) return;
  const active = game.banks?.PlaySystems?.vehicleActive !== false;
  for (const row of rows(game, "transportation")) {
    const id = Number(row.id),
      selector = actorSelector(game, id);
    if (id < 2 || selector === null) continue;
    const record = game.banks?.PlaySystems?.vehicles?.[id];
    const existing = game.actors?.get(String(selector));
    if (!record && !existing) continue;
    const body = existing ?? game.actor(selector);
    body.asset = asset(game, id)?.asset_name ?? body.asset;
    body.transportationId = id;
    const parkedHere = available(game, id) && Number(record.mapId) === Number(game.mapId);
    if (parkedHere && !body.motion)
      Object.assign(body, {
        x: record.x,
        y: record.y,
        layer: record.layer ?? game.player.layer,
        direction: record.direction || "down",
      });
    body.visible = active && parkedHere && currentId(game) !== id;
  }
}

function changeVehicle(game, id, task, silent = false) {
  const previous = currentId(game),
    system = state(game);
  // A cinematic can borrow a vehicle parked elsewhere. Changing appearance
  // must not overwrite that source SetVehicle position with a town/deck pose.
  if (previous > 1 && world(game))
    records(game)[previous] = { ...records(game)[previous], ...pose(game) };
  if (id > 1 && world(game) && !records(game)[id])
    records(game)[id] = { ...pose(game), enabled: true };
  appearance(game, game.player, id);
  system.currentVehicle = id;
  game.player.visible = true;
  if (id === 6 || previous === 6) for (const member of game.party ?? []) member.magitek = id === 6;
  if (id > 1) {
    const row = definition(game, id);
    if (!silent && Number(row?.bgm_id) > 0) emit(game, "bgm", { id: Number(row.bgm_id) });
  }
  syncVehicleActors(game);
  emit(game, "vehicle", { id, previous });
}

// Intercept before game.js's old catch-all vehicle cases. These commands do
// not mean "board": place owns parking, position owns player/camera placement,
// and active only hides/shows the source vehicle bodies (i0==0 means enabled).
export function executeVehicleInstruction(game, task, name, i = [], r = [], s = []) {
  if (name === "SetVehicle") {
    const id = Number(i[0]),
      row = definition(game, id);
    records(game)[id] = {
      mapId: Number(i[1]),
      x: Number(i[2]),
      y: Number(i[3]),
      // Like Puppet.SetPos, PR Vehicle.SetVehicle maps a nonzero layer
      // request to Unity layer request+8 (our exported layers start at zero).
      layer: i[4] > 0 ? i[4] - 1 : game.player.layer,
      direction: directions[i[5]] || game.player.direction,
      enabled: true,
    };
    release(game, row, 1);
    if (!row) warn(game, task, `Vehicle ${id} has no transportation row; source parking retained.`);
    syncVehicleActors(game);
    emit(game, "vehicle-park", { id, ...records(game)[id] });
    return true;
  }
  if (name === "LoseVehicle") {
    const id = Number(i[0]);
    records(game)[id] = { ...records(game)[id], mapId: -1, enabled: false };
    release(game, definition(game, id), 0);
    syncVehicleActors(game);
    emit(game, "vehicle-lost", { id });
    return true;
  }
  if (name === "OnTheVehicle") {
    const id = Number(i[0]),
      record = records(game)[id];
    syncVehicleActors(game);
    if (record && Number(record.mapId) === Number(game.mapId)) {
      Object.assign(game.player, {
        x: record.x,
        y: record.y,
        layer: record.layer ?? game.player.layer,
        motion: null,
      });
      if (game.camera)
        Object.assign(game.camera, { x: record.x, y: record.y, manual: false, motion: null });
      const leader = game.party?.[0]?.id;
      if (leader && game.actor)
        Object.assign(game.actor(-leader), {
          x: record.x,
          y: record.y,
          layer: game.player.layer,
          motion: null,
        });
    } else
      warn(
        game,
        task,
        `Vehicle ${id} parking is absent from map ${game.mapId}; position unchanged.`,
      );
    return true;
  }
  if (name === "SwitchVehicleActive") {
    state(game).vehicleActive = i[0] === 0;
    syncVehicleActors(game);
    return true;
  }
  if (name === "RideVehicleNPC") {
    const actor = game.actor?.(i[1]) ?? game.player;
    appearance(game, actor, Number(i[0]));
    return true;
  }
  return false;
}

export function executeVehicleSyscall(game, task, name, i = [], r = []) {
  if (Object.hasOwn(selectors, name)) {
    changeVehicle(game, selectors[name], task, name.includes("アニメ・BGMなし"));
    return true;
  }
  if (name === "乗り物から降りる" || name === "乗り物から降りる(アニメ・BGMなし)") {
    changeVehicle(game, 1, task, name.includes("アニメ・BGMなし"));
    return true;
  }
  if (name === "飛空艇着陸時演出開始") {
    const id = currentId(game);
    if (id > 1) records(game)[id] = { ...records(game)[id], ...pose(game), enabled: true };
    state(game).landingVehicle = id;
    changeVehicle(game, 1, task, true);
    warn(
      game,
      task,
      "Landing restores the walking leader after the authored descent ends; PR control-callback timing is inferred.",
    );
    emit(game, "vehicle-landing", { id });
    return true;
  }
  if (name === "バードビュー情報を保存") {
    state(game).worldPose = { ...pose(game), vehicle: currentId(game) };
    return true;
  }
  if (name === "バードビュー情報を設定") {
    const saved = state(game).worldPose;
    if (saved && Number(saved.mapId) === Number(game.mapId)) {
      Object.assign(game.player, {
        x: saved.x,
        y: saved.y,
        layer: saved.layer,
        direction: saved.direction,
        motion: null,
      });
      if (game.camera)
        Object.assign(game.camera, { x: saved.x, y: saved.y, manual: false, motion: null });
      const id = currentId(game);
      if (id > 1) records(game)[id] = { ...records(game)[id], ...pose(game), enabled: true };
    } else
      warn(game, task, "Saved bird-view position is absent or belongs to another map; unchanged.");
    return true;
  }
  if (name === "リーダーがチョコボに乗る") {
    changeVehicle(game, 3, task, true);
    return true;
  }
  return false;
}

function cell(game, x, y) {
  const terrain = game.map?.worldTerrain;
  const width = terrain?.width ?? game.map?.width,
    height = terrain?.height ?? game.map?.height;
  if (!width || !height || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  x = Math.floor(x);
  y = Math.floor(y);
  if (terrain?.loopType & 1) x = ((x % width) + width) % width;
  if (terrain?.loopType & 2) y = ((y % height) + height) % height;
  if (x < 0 || y < 0 || x >= width || y >= height) return null;
  const foot = terrain?.cells?.[y * width + x];
  return { x, y, foot, type: Number(terrain?.footRows?.[foot]?.typeId) };
}
export function canVehicleMove(game, x, y, id = currentId(game)) {
  const point = cell(game, x, y);
  if (!point) return false;
  if (fieldTerrainBlockerAt(game, point.x, point.y, game.player.layer, id)) return false;
  const code = worldCollisionByFoot(game.map, point.foot, id);
  if (code !== undefined) return code !== 1;
  if (airship(Number(id)) && world(game)) return true;
  return game.canWalk?.(point.x, point.y, game.player.layer) ?? true;
}
export function canVehicleLand(game, id = currentId(game), x = game.player.x, y = game.player.y) {
  const row = definition(game, id),
    point = cell(game, x, y);
  if (!row || !point || !world(game)) return false;
  const group = rows(game, "landingGroup").find(
    (group) => Number(group.id) === Number(row.landing_group_id),
  );
  const key = point.type <= 3 ? `type${point.type}` : `type_${point.type}`;
  if (group && Number.isFinite(point.type)) return Number(group[key]) === 1;
  // This fallback uses the source walking collision, rather than allowing an
  // airship to land on every tile it can fly over. Exact PR landing rows win.
  warn(
    game,
    null,
    "PR landing group is unavailable; vehicle landing falls back to source walking collision.",
  );
  return canVehicleMove(game, x, y, 1);
}

// One ordinary cardinal input, shared by keyboard and route driving. Airborne
// movement intentionally does not run foot/town triggers. Host may check them
// after landing. No API accepts a destination coordinate or map ID.
export function moveVehicle(game, direction) {
  const id = currentId(game),
    index = directions.indexOf(direction);
  if (
    id < 2 ||
    !world(game) ||
    game.busy ||
    game.control === false ||
    game.player.motion ||
    index < 0
  )
    return false;
  const [dx, dy] = steps[index],
    point = cell(game, game.player.x + dx, game.player.y + dy);
  if (!point || !canVehicleMove(game, point.x, point.y, id)) return false;
  if (airship(id))
    warn(
      game,
      null,
      "Flight controls use ordinary world-map cells; perspective, acceleration and banking are simplified.",
    );
  Object.assign(game.player, { x: point.x, y: point.y, direction });
  if (game.camera) game.camera.manual = false;
  records(game)[id] = { ...records(game)[id], ...pose(game), enabled: true };
  emit(game, "vehicle-move", { id, direction, x: point.x, y: point.y });
  checkFlightEncounterContact(game);
  return true;
}

function scriptName(game, id) {
  const value = game.data?.scriptIds?.[id];
  return typeof value === "string" ? value : (value?.script_name ?? value?.name);
}
function sourceProgram(game, name, mapId = game.mapId) {
  const resolved = game.resolve?.(name, mapId);
  if (
    resolved !== undefined &&
    game.data.programs[resolved]?.ops?.some((op) => !["Nop", "Exit"].includes(op[0]))
  )
    return resolved;
  // Some shared names have an empty global alias. Prefer the actual exported
  // body only after the current map's resolver has had its normal first choice.
  return (
    Object.entries(game.data?.programs ?? {})
      .filter(([, p]) => p.name === name && p.ops?.length > 2)
      .sort(([, a], [, b]) => b.ops.length - a.ops.length)[0]?.[0] ?? resolved
  );
}
function ordinaryScript(game, name, caller = null) {
  if (!name) return false;
  const program = sourceProgram(game, name);
  if (program === undefined) {
    warn(game, caller, `Vehicle callback ${name} is missing; input skipped.`);
    return false;
  }
  if (caller) {
    caller.scriptFrames ??= [];
    caller.scriptFrames.push({
      program: caller.program,
      pc: caller.pc,
      locals: caller.locals,
      stack: caller.stack,
    });
    Object.assign(caller, {
      program,
      pc: 0,
      locals: [...(game.data.programs[program].locals ?? [])],
      stack: [],
      done: false,
      wait: 0,
      waitFor: null,
    });
  } else {
    const task = game.startScript?.(name);
    if (!task) return false;
    Object.assign(task, {
      program,
      pc: 0,
      locals: [...(game.data.programs[program].locals ?? [])],
    });
  }
  return true;
}

export function vehicleInputState(game) {
  const id = currentId(game),
    system = game.banks?.PlaySystems ?? {};
  const parked = Object.entries(system.vehicles ?? {}).map(([id, record]) => ({
    id: Number(id),
    ...record,
  }));
  const nearby = rows(game, "transportation")
    .map((row) => Number(row.id))
    .filter((id) => {
      const record = system.vehicles?.[id];
      return (
        available(game, id) &&
        Number(record.mapId) === Number(game.mapId) &&
        Math.abs(record.x - game.player.x) + Math.abs(record.y - game.player.y) <= 1
      );
    });
  const actions = [];
  if (world(game) && id === 1 && system.vehicleActive !== false)
    for (const target of nearby) {
      if (airship(target)) actions.push({ action: "takeoff", vehicleId: target });
      else if ([2, 3].includes(target)) actions.push({ action: "board", vehicleId: target });
    }
  if (world(game) && airship(id)) {
    actions.push({ action: "land", vehicleId: id, enabled: canVehicleLand(game, id) });
    if (Number(definition(game, id)?.transition_inboard) > 0)
      actions.push({ action: "deck", vehicleId: id });
  } else if (world(game) && [2, 3].includes(id)) {
    const exits = dismountCells(game, id);
    actions.push({
      action: "dismount",
      vehicleId: id,
      enabled: exits.length > 0,
      directions: exits.map((point) => point.direction),
    });
  }
  actions.push({ action: "resume", vehicleId: id });
  return {
    id,
    flying: world(game) && airship(id),
    active: system.vehicleActive !== false,
    nearby,
    parked,
    actions,
  };
}

function dismountCells(game, id) {
  const adjacent =
    id === 2
      ? steps.map(([dx, dy], index) => ({
          x: game.player.x + dx,
          y: game.player.y + dy,
          direction: directions[index],
        }))
      : [];
  return [{ x: game.player.x, y: game.player.y, direction: null }, ...adjacent].filter(
    (point) =>
      canVehicleLand(game, id, point.x, point.y) && canVehicleMove(game, point.x, point.y, 1),
  );
}

export function openVehicleInput(game, task = null) {
  if (game.vehicleMenu || (!task && (game.busy || game.control === false))) return false;
  game.vehicleMenu = { ...vehicleInputState(game), task };
  if (task) task.waitFor = "vehicle";
  const { task: ignored, ...payload } = game.vehicleMenu;
  emit(game, "vehicle-menu", payload);
  return true;
}
export function closeVehicleInput(game) {
  if (!game.vehicleMenu) return false;
  const task = game.vehicleMenu.task;
  if (task?.waitFor === "vehicle") task.waitFor = null;
  game.vehicleMenu = null;
  emit(game, "vehicle-menu-close");
  return true;
}
export function submitVehicleInput(game, input) {
  const request = typeof input === "string" ? { action: input } : (input ?? {});
  const menu = game.vehicleMenu;
  if (!menu && (game.busy || game.control === false)) return false;
  const model = vehicleInputState(game),
    id = Number(request.vehicleId || model.id);
  const offered = model.actions.find(
    (action) =>
      action.action === request.action && (request.action === "resume" || action.vehicleId === id),
  );
  if (!offered || offered.enabled === false) return false;
  const task = menu?.task ?? null,
    row = definition(game, id);
  if (request.action === "resume") {
    closeVehicleInput(game);
    return true;
  }
  if (request.action === "board") {
    const parked = records(game)[id];
    // Boarding a same/adjacent parked body is a player input, not world travel.
    Object.assign(game.player, {
      x: parked.x,
      y: parked.y,
      layer: parked.layer ?? game.player.layer,
    });
    closeVehicleInput(game);
    changeVehicle(game, id, task);
    return true;
  }
  if (request.action === "dismount") {
    const point = dismountCells(game, id).find(
      (point) => request.direction === undefined || point.direction === request.direction,
    );
    if (!point) return false;
    // Save the vessel at the water's edge before the single disembarking step.
    closeVehicleInput(game);
    changeVehicle(game, 1, task);
    const target = cell(game, point.x, point.y);
    Object.assign(game.player, { x: target.x, y: target.y });
    return true;
  }
  const callback = scriptName(
    game,
    row?.[
      request.action === "takeoff"
        ? "start_takeoff"
        : request.action === "land"
          ? "start_landing"
          : "transition_inboard"
    ],
  );
  if (!callback || sourceProgram(game, callback) === undefined) {
    warn(game, task, `Vehicle ${id} ${request.action} callback unavailable; unchanged.`);
    return false;
  }
  if (request.action === "takeoff") executeVehicleInstruction(game, task, "OnTheVehicle", [id]);
  if (request.action === "land")
    records(game)[id] = { ...records(game)[id], ...pose(game), enabled: true };
  closeVehicleInput(game);
  const accepted = ordinaryScript(game, callback, task);
  if (accepted) emit(game, "vehicle-input", { action: request.action, id, script: callback });
  return accepted;
}
export function autoVehicleInput(game, input) {
  // No implicit destination, landing tile or story choice. The driver supplies
  // the same menu action/direction a human can enter after ordinary navigation.
  if (typeof input === "string" && directions.includes(input)) return moveVehicle(game, input);
  if (input?.direction && !input.action) return moveVehicle(game, input.direction);
  return input ? submitVehicleInput(game, input) : false;
}
export function updateVehicleInput(game) {
  if (game.loading || !game.map) return;
  if (game.vehicleMapId !== game.mapId || game.vehicleActorMap !== game.actors) {
    game.vehicleMapId = game.mapId;
    game.vehicleActorMap = game.actors;
    syncVehicleActors(game);
  }
  const system = game.banks?.PlaySystems;
  if (system?.landingVehicle && currentId(game) === 1 && world(game) && !game.busy) {
    // The source landing continuation hides the walking leader while the
    // vehicle body descends, with no final Show opcode. Its control callback
    // restores the player only once that authored sequence has actually ended.
    const id = system.landingVehicle;
    delete system.landingVehicle;
    game.player.visible = true;
    syncVehicleActors(game);
    emit(game, "vehicle-landed", { id, ...pose(game) });
  }
}
