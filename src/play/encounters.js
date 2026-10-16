// PR terrain and encounter masters determine eligibility and the formation
// pool. The step accumulator and Veldt pool order remain logged approximations.
export function currentFoot(game, x = game.player.x, y = game.player.y) {
  const terrain = game.map.worldTerrain;
  if (!terrain) return { type: 0, subtract: game.battleData.encounters?.maps[game.mapId]?.subtract || 0 };
  const type = terrain.cells[Math.floor(y) * terrain.width + Math.floor(x)] || 0,
    row = terrain.footRows[type];
  return { type: row?.typeId ?? type, subtract: row?.subtractSteps ?? 0,
    background: row?.battleBackgroundAssetId };
}

export function isVeldt(game, x, y) {
  return (!game.player.vehicle || game.player.vehicle === 1) &&
    [31, 32].includes(currentFoot(game, x, y).type);
}

export function encounterPool(game) {
  const data = game.battleData, source = data.encounters,
    map = source?.maps[game.mapId];
  if (!map) return [];
  if (isVeldt(game)) {
    const seen = [...new Set(game.battles.map(battle => battle.encounterId))];
    return seen.filter(id => {
      const party = data.parties[id];
      return party?.members.length && party.members.every(member => !data.monsters[member.monsterId]?.boss) &&
        data.scriptNames[party.script] === 'sc_b_0239';
    }).map(id => ({ id, weight: 1 }));
  }
  let set = map.set;
  if (map.grid) {
    const grid = source.grids[map.grid];
    if (grid) {
      const col = Math.floor((game.player.x - grid.x_start_point) * grid.grid_width / game.map.width),
        row = Math.floor((game.player.y - grid.y_start_point) * grid.grid_height / game.map.height),
        area = source.areas[grid.base_number + row * grid.grid_width + col];
      set = area?.[currentFoot(game).type - 1] ?? set;
    }
  }
  const choices = source.sets[set]?.choices || [];
  // Zero is an empty source slot, never an invented formation or victory.
  if (choices.some(choice => choice.weight > 0 && !choice.id))
    game.warn(null, `PR encounter set ${set} contains empty weighted slots; empty rolls produce no battle.`);
  return choices;
}

export function walkEncounter(game) {
  if (game.busy || game.rts?.active || !game.Battle ||
      game.player.vehicle && game.player.vehicle !== 1) return false;
  const map = game.battleData.encounters?.maps[game.mapId], foot = currentFoot(game);
  if (!map || foot.subtract <= 0) return false;
  const pool = encounterPool(game);
  if (!pool.some(choice => choice.id && choice.weight > 0)) return false;
  let state = game.walkEncounterState;
  if (!state || state.mapId !== game.mapId) {
    state = game.walkEncounterState = { mapId: game.mapId, remaining: 0 };
    game.warn(null, 'Walking encounters subtract PR foot cost once per cell and sample the PR step range; subcell timing is approximated.');
  }
  if (state.remaining <= 0)
    state.remaining = Math.max(1, map.min + Math.floor(game.random() * Math.max(1, map.max - map.min + 1)));
  state.remaining -= foot.subtract;
  if (state.remaining > 0) return false;
  const total = pool.reduce((sum, choice) => sum + Math.max(0, choice.weight), 0);
  let draw = game.random() * total, selected;
  for (const choice of pool) {
    draw -= Math.max(0, choice.weight);
    if (draw < 0) { selected = choice.id; break; }
  }
  if (!selected || !game.battleData.parties[selected]) return false;
  const veldt = isVeldt(game);
  if (veldt) game.warn(null, 'Veldt samples previously encountered eligible PR formations uniformly; original pool rotation is approximated.');
  const task = { program: null, pc: 0, locals: [], done: false, waitFor: null };
  game.encounter(selected, '', task, { isVeldt: veldt, backgroundId: foot.background, randomEncounter: true });
  return true;
}
