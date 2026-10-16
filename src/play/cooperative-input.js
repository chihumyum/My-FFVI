// Ordinary multi-party controls. Plate flags belong exclusively to their PR
// enter/leave scripts; this module records physical occupancy and player input.
const directions = [['up', 0, -1], ['right', 1, 0], ['down', 0, 1], ['left', -1, 0]];
const stateFor = game => game.cooperativeState ??= { maps: {}, occupied: {}, queue: [] };
const countFor = game => Math.max(1, Math.min(3, Number(game.banks?.ScenarioVariable?.[5]) ||
  game.partySlots.filter(slot => slot.length).length));
const pose = game => ({ x: game.player.x, y: game.player.y, layer: game.player.layer,
  direction: game.player.direction, mapId: game.mapId });
const onPlate = (position, plate) => position.mapId === plate.mapId &&
  (position.layer === undefined || plate.layer === undefined || position.layer === plate.layer) &&
  position.x >= plate.x - .45 && position.x < plate.x + Math.max(1, plate.width || 1) - .45 &&
  position.y >= plate.y - .45 && position.y < plate.y + Math.max(1, plate.height || 1) - .45;
const plateName = (game, plate, leaving) => leaving ?
  plate.leaveScript || game.data.scriptIds?.[plate.leaveScriptId] : plate.script;

export function saveCooperativePosition(game) {
  if (!game.rts?.active || !game.player || !game.mapId) return false;
  game.partyPositions ??= [];
  game.partyPositions[game.partyIndex] = pose(game);
  game.banks ??= {};
  (game.banks.ScenarioVariable ??= {})[11 + game.partyIndex] = game.mapId;
  return true;
}

function restoreLeader(game) {
  const id = game.partySlots[game.partyIndex]?.[0], asset = game.data.fieldAssets?.[id];
  if (id) {
    game.player.characterId = id;
    game.player.asset = typeof asset === 'string' ? asset : asset?.asset_name ?? `mo_ff6_p${String(id).padStart(3, '0')}`;
  }
  game.player.visible = true;
  game.player.motion = null;
  if (game.camera) game.camera.manual = false;
  game.event?.('party', { partyIndex: game.partyIndex, members: [...(game.partySlots[game.partyIndex] || [])] });
}

// Called by the two exact PR RTS selectors. The cross-map continuation is the
// source sc_sht_corps_after; its initializer refresh remains source-owned.
export function executeCooperativeSyscall(game, task, name) {
  if (!['RTS：操作パーティ切替', 'RTS：操作パーティ切替（後）'].includes(name)) return false;
  game.banks ??= {};
  const variables = game.banks.ScenarioVariable ??= {}, systems = game.banks.PlaySystems ??= {};
  const after = name.endsWith('（後）'), count = countFor(game);
  const next = Number(systems.pendingPartySwitch ?? (game.partyIndex + 1) % count);
  if (!after) saveCooperativePosition(game);
  const position = game.partyPositions?.[next], destination = position?.mapId ?? variables[11 + next];
  if (!after && destination && destination !== game.mapId && game.enter) {
    systems.pendingPartySwitch = next;
    if (task) task.done = true;
    game.pending = game.enter(destination, 1, 'sc_sht_corps_after');
    return true;
  }
  game.partyIndex = Math.max(0, Math.min(count - 1, next));
  if (position && (!position.mapId || position.mapId === game.mapId)) Object.assign(game.player, position);
  variables[4] = game.partyIndex;
  delete systems.pendingPartySwitch;
  restoreLeader(game);
  return true;
}

export function switchCooperativeParty(game, index = (game.partyIndex + 1) % countFor(game)) {
  if (game.busy || !game.rts?.active || index === game.partyIndex ||
      !Number.isInteger(index) || index < 0 || index >= countFor(game) || !game.partySlots[index]?.length) return false;
  updateCooperativeInput(game);
  if (game.busy) return false;
  (game.banks.PlaySystems ??= {}).pendingPartySwitch = index;
  return executeCooperativeSyscall(game, { locals: [], pc: 0 }, 'RTS：操作パーティ切替');
}

function dispatch(game, callback) {
  const name = plateName(game, callback.plate, callback.leaving);
  if (!name) {
    if (callback.leaving) game.warn?.(null, `PR plate ${callback.plate.mapId}:${callback.plate.id} has no exported leave script; no flag was guessed.`);
    return false;
  }
  // A party may leave a plate through a map boundary. Resolve the callback in
  // the plate's source map even after the field loader has changed maps.
  const program = game.resolve?.(name, callback.plate.mapId);
  const task = game.startScript?.(name);
  if (!task) return false;
  if (program !== undefined && program !== task.program) {
    task.program = program;
    task.locals = [...(game.data.programs?.[program]?.locals || [])];
  }
  task.cooperativeParty = callback.party;
  game.event?.('party-plate', { partyIndex: callback.party, mapId: callback.plate.mapId,
    entityId: callback.plate.id, leaving: callback.leaving, script: name });
  return true;
}

// Hook after a normal move and on idle ticks, before ordinary checkTriggers.
// Switching control does not move the inactive party off its plate. Occupancy
// is serializable with partyPositions/rts for ordinary field saves.
export function updateCooperativeInput(game) {
  if (game.loading || !game.rts?.active || countFor(game) < 2 || game.busy) return false;
  const state = stateFor(game);
  state.maps ??= {}; state.occupied ??= {}; state.queue ??= [];
  if (state.queue.length) return dispatch(game, state.queue.shift());
  saveCooperativePosition(game);
  const unique = new Map();
  for (const entity of game.entities || []) if (entity.kind === 30) {
    const actual = { ...entity, ...game.actors?.get(String(entity.id)) };
    if (actual.visible === false) continue;
    unique.set(String(entity.id), { id: entity.id, mapId: game.mapId, x: actual.x, y: actual.y,
      layer: actual.layer, width: actual.width, height: actual.height, script: entity.script,
      leaveScript: entity.leaveScript, leaveScriptId: entity.leaveScriptId });
  }
  state.maps[game.mapId] = [...unique.values()];
  const next = {};
  for (let party = 0; party < countFor(game); party++) {
    const position = game.partyPositions?.[party];
    next[party] = position && game.partySlots[party]?.length ?
      (state.maps[position.mapId] || []).filter(plate => onPlate(position, plate)) : [];
  }
  const covered = occupied => {
    const plates = new Map();
    for (const [party, entries] of Object.entries(occupied)) for (const plate of entries)
      if (!plates.has(`${plate.mapId}:${plate.id}`)) plates.set(`${plate.mapId}:${plate.id}`, { party: Number(party), plate });
    return plates;
  };
  const before = covered(state.occupied), after = covered(next);
  // Two parties can share a cell. The plate remains pressed until the last
  // party leaves; a duplicate occupant does not need another enter callback.
  for (const [key, entry] of before) if (!after.has(key)) state.queue.push({ ...entry, leaving: true });
  for (const [key, entry] of after) if (!before.has(key)) state.queue.push({ ...entry, leaving: false });
  state.occupied = next;
  if (state.queue.length) return dispatch(game, state.queue.shift());
  return false;
}

const occupants = game => Object.entries(stateFor(game).occupied || {}).flatMap(([party, plates]) =>
  plates.map(plate => ({ party: Number(party), plate })));
const scriptMatch = (plate, scripts) => (scripts || []).includes(plate.script);

// Returns a performed ordinary input, or null to let the caller's normal route
// run. findTarget/followTarget are injected so this module does not own field
// pathfinding, objective conditions, or story dispatch.
export function cooperativeStoryInput(game, objective, { condition, findTarget, followTarget } = {}) {
  if (!objective?.cooperative || !game.rts?.active || countFor(game) < 2) return null;
  if (game.busy) return { status: 'busy' };
  updateCooperativeInput(game);
  if (game.busy) return { status: 'busy' };
  const occupied = occupants(game), releases = objective.release || [];
  const released = occupied.find(entry => scriptMatch(entry.plate, releases));
  if (released) {
    if (released.party !== game.partyIndex) return switchCooperativeParty(game, released.party) ?
      { status: 'party', party: released.party, releasing: true } : { status: 'busy' };
    for (const [direction, dx, dy] of directions) {
      const point = { ...pose(game), x: game.player.x + dx, y: game.player.y + dy };
      if (!game.canMove?.(point.x, point.y, point.layer) || onPlate(point, released.plate) ||
          (stateFor(game).maps[game.mapId] || []).some(plate => onPlate(point, plate))) continue;
      if (game.move(direction)) { updateCooperativeInput(game); return { status: 'release-party', party: game.partyIndex }; }
    }
    return { status: 'no-route', reason: 'The party cannot walk off its occupied source plate.' };
  }
  if (!findTarget || !followTarget) return null;
  const parts = objective.parts || [];
  const remaining = parts.filter(part => !condition?.(game, part.complete));
  if (parts.length && !remaining.length) return { status: 'needs-input',
    reason: 'The source plates are occupied, but their combined source callback has not completed the objective.' };
  const held = new Set();
  if (objective.hold) for (const part of parts) {
    // Keep one party per requested plate. A route to another wing can cross
    // a completed plate, so treating every occupant as held strands the spare
    // party on the same switch (the real M9 three-plate save reproduced this).
    const owner = occupied.find(entry => !held.has(entry.party) && scriptMatch(entry.plate, part.scripts));
    if (owner) held.add(owner.party);
  }
  const state = stateFor(game), key = JSON.stringify([objective.id, remaining.map(part => part.scripts),
    occupied.map(entry => [entry.party, entry.plate.mapId, entry.plate.id])]);
  if (state.driver?.key !== key) state.driver = { key, tried: [] };
  const driver = state.driver;
  if (!held.has(game.partyIndex)) {
    for (const part of remaining.length ? remaining : [objective]) {
      const input = findTarget(game, { ...objective, ...part, parts: undefined, release: undefined });
      if (!['no-route', 'no-input', 'needs-input'].includes(input.status)) {
        driver.tried = [];
        return followTarget(game, input);
      }
    }
    if (!driver.tried.includes(game.partyIndex)) driver.tried.push(game.partyIndex);
  }
  for (let delta = 1; delta <= countFor(game); delta++) {
    const next = (game.partyIndex + delta) % countFor(game);
    if (held.has(next) || driver.tried.includes(next) || !game.partySlots[next]?.length) continue;
    if (switchCooperativeParty(game, next)) return { status: 'party', party: next, holding: [...held] };
  }
  return { status: 'no-route', reason: 'No unheld party currently has a source route to this cooperative objective.' };
}
