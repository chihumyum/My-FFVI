// Native field hosts requested by serialized PR SysCalls. Contact dispatches
// the authored field trigger, never a formation ID or a reward continuation.
const family = {
  syscall: "デスゲイズ配置",
  script: "sc_e_0964",
  completed: ["ScenarioFlag2", 216],
  sourceVehicle: 5,
};
const system = (game) => ((game.banks ??= {}).PlaySystems ??= {});
const complete = (game) =>
  Number(game.banks?.[family.completed[0]]?.[family.completed[1]] || 0) === 1;
const bodies = (game) =>
  (game.entities || []).filter((body) => body.kind === 2 && body.script === family.script);
const wrap = (n, size) => ((n % size) + size) % size;

export function executeFlightEncounterSyscall(game, task, name, _i = [], _r = []) {
  if (name !== family.syscall) return false;
  const terrain = game.map?.worldTerrain,
    entries = bodies(game);
  if (!terrain || !entries.length || complete(game)) {
    if (!complete(game))
      game.warn?.(task, `${name}: no active PR flight-trigger bodies; no encounter was invented.`);
    return true;
  }
  const random = game.random || Math.random,
    width = terrain.width,
    height = terrain.height,
    origin = [
      Math.min(...entries.map((body) => body.x)),
      Math.min(...entries.map((body) => body.y)),
    ],
    anchor = [Math.floor(random() * width), Math.floor(random() * height)];
  const placement = {
    mapId: game.mapId,
    script: family.script,
    bodyIds: entries.map((body) => String(body.id)),
    anchor,
    pending: false,
  };
  game.actors ??= new Map();
  for (const body of entries) {
    const previous = game.actors.get(String(body.id));
    game.actors.set(String(body.id), {
      ...body,
      ...previous,
      x: wrap(anchor[0] + body.x - origin[0], width),
      y: wrap(anchor[1] + body.y - origin[1], height),
      visible: true,
      motion: null,
    });
  }
  system(game).deathgazePlacement = placement;
  game.warn?.(
    task,
    "PR Deathgaze placement has no serialized random coordinates: retain all authored trigger offsets around one uniform world-cell anchor. Exact native placement distribution and subcell flight contact are approximated; only a moved Falcon can contact them.",
  );
  game.event?.("flight-encounter-placement", { script: family.script, bodyIds: placement.bodyIds });
  return true;
}

// Called only after one accepted ordinary vehicle movement. Foot/town triggers
// remain with Game.checkTriggers; their source transportation filters also win.
export function checkFlightEncounterContact(game) {
  if (game.busy || game.control === false || !game.map?.worldTerrain || complete(game))
    return false;
  const entries = bodies(game);
  if (!entries.length) return false;
  const placement = system(game).deathgazePlacement;
  if (!placement || placement.mapId !== game.mapId) {
    game.warn?.(
      null,
      "PR flight triggers have not run their placement SysCall in this restored scene; an ordinary world-map re-entry must run its initializer before contact.",
    );
    return false;
  }
  if (placement.pending) return false;
  for (const body of entries) {
    const actual = game.actors?.get(String(body.id)),
      allowed = body.transportationIds?.length ? body.transportationIds : [family.sourceVehicle];
    if (!allowed.includes(Number(game.player.vehicle))) continue;
    if (!body.transportationIds?.length)
      game.warn?.(
        null,
        "PR flight-trigger transportation filter is missing from this export; ev_e_0964 source target_transportation_ids=5 is used for compatibility.",
      );
    if (!actual || actual.visible === false || actual.layer !== game.player.layer) continue;
    if (
      game.player.x < actual.x ||
      game.player.y < actual.y ||
      game.player.x >= actual.x + Math.max(1, body.width || 1) ||
      game.player.y >= actual.y + Math.max(1, body.height || 1)
    )
      continue;
    const programId = game.resolve?.(body.script);
    if (!game.data?.programs?.[programId]) {
      game.warn?.(
        null,
        `PR flight contact ${body.id}: missing source ${body.script}; no formation was substituted.`,
      );
      return false;
    }
    placement.pending = true;
    const task = game.startScript(body.script);
    if (!task) {
      placement.pending = false;
      return false;
    }
    game.event?.("flight-contact", {
      entityId: body.id,
      script: body.script,
      vehicleId: game.player.vehicle,
    });
    return true;
  }
  return false;
}
