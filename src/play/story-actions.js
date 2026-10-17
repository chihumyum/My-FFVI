import { canVehicleLand, autoVehicleInput, vehicleInputState } from './vehicle-input.js';
import { partyInputMembers } from './party-input.js';
import { isVeldt } from './encounters.js';
import { shopScriptsForContent } from './event-systems.js';
import { routeToStory } from './navigation.js';

// These are ordinary inputs for recurring non-dialogue objectives: find a
// seller, buy an item in its menu, then walk on eligible encounter terrain.
export function randomEncounterInput(game, objective, pathTo) {
  const buy = objective.buy;
  if (buy && (game.inventory[buy.contentId] || 0) < (buy.count || 1))
    return routeToStory(game, { scripts: shopScriptsForContent(game, buy.contentId),
      shops: [...new Set((game.data.systemTables?.product || []).filter(row =>
        Number(row.content_id) === buy.contentId).map(row => Number(row.group_id)))] }, pathTo);
  if (!game.map.worldTerrain) {
    const worlds = Object.values(game.battleData.encounters?.maps || {}).filter(map => map.grid).map(map => map.id);
    return routeToStory(game, { action: 'visit-map', maps: worlds }, pathTo);
  }
  const targetAt = (x, y) => ({ id: 'encounter-walk', kind: 2, x, y, layer: game.player.layer });
  if (!isVeldt(game)) {
    const terrain = game.map.worldTerrain, candidates = [];
    for (let y = 0; y < terrain.height; y++) for (let x = 0; x < terrain.width; x++)
      if (isVeldt(game, x, y)) candidates.push({ x, y, distance: Math.abs(x - game.player.x) + Math.abs(y - game.player.y) });
    candidates.sort((a, b) => a.distance - b.distance);
    for (const point of candidates) {
      const target = targetAt(point.x, point.y), route = pathTo(game, target);
      if (route) return { status: 'target', target, route };
    }
    return { status: 'no-encounter-terrain' };
  }
  const choices = [['right', 1, 0], ['left', -1, 0], ['up', 0, -1], ['down', 0, 1]],
    start = game.encounterWalkDirection || 0;
  for (let n = 0; n < 4; n++) {
    const index = (start + n) % 4, [direction, dx, dy] = choices[index],
      x = game.player.x + dx, y = game.player.y + dy;
    if (!isVeldt(game, x, y) || !game.canMove(x, y) || game.entities.some(entity =>
      [2, 3].includes(entity.kind) && entity.x === x && entity.y === y)) continue;
    game.encounterWalkDirection = index === 0 ? 1 : 0;
    game.move(direction);
    return { status: 'encounter-walk' };
  }
  return { status: 'no-encounter-terrain' };
}

// A required recruited member must be selected through an available source
// formation menu. Airship deck access uses the same public vehicle controls.
export function prepareStoryParty(game, objective, pathTo) {
  const requirements = objective.party, current = game.partySlots[game.partyIndex] || [];
  if (!requirements || (requirements.include || []).every(id => current.includes(id)) &&
      current.length >= (requirements.minimum || 1)) return null;
  const available = new Set(partyInputMembers(game).map(unit => unit.id));
  if (!(requirements.include || []).every(id => available.has(id))) return null;
  const model = vehicleInputState(game);
  if (model.flying && autoVehicleInput(game, { action: 'deck', vehicleId: model.id }))
    return { status: 'vehicle' };
  const worlds = [...new Set(Object.entries(game.banks.PlaySystems?.vehicles || {})
    .filter(([id, vehicle]) => [4, 5].includes(Number(id)) && vehicle.enabled !== false && vehicle.mapId > 0)
    .map(([, vehicle]) => vehicle.mapId))];
  if (!worlds.length) return null;
  if (!game.map.worldTerrain) {
    const menu = routeToStory(game, { syscalls: ['パーティ編成：１パーティ'] }, pathTo);
    if (menu.status !== 'no-route') return menu;
  }
  if (!game.map.worldTerrain) return routeToStory(game, { action: 'visit-map', maps: worlds }, pathTo);
  return { status: 'no-route' };
}

// Travel uses normal directional input and the source landing callback. Find
// a legal landing tile from which the actual town/field trigger is walkable.
function landingCandidates(game, vehicleId, target) {
  const key=JSON.stringify([game.mapId,vehicleId,target.id,target.x,target.y,target.layer,game.navigationCache?.signature]);
  if(game.flightLandingCache?.key===key)return game.flightLandingCache.points;
  const map=game.data.navigation?.maps[game.mapId],runs=map?.regionRuns?.[game.player.layer],
    regions=new Set(map?.entries.find(entry=>entry.id===target.id)?.regions || []),points=[];
  const add=(x,y)=>{if(canVehicleLand(game,vehicleId,x,y))points.push({x,y,
    cost:Math.abs(x-target.x)+Math.abs(y-target.y)+(Math.abs(x-game.player.x)+Math.abs(y-game.player.y))/1000});};
  // A cave can be connected to a legal landing field by a long narrow
  // corridor. Search its complete walking region instead of a fixed radius.
  if(runs&&regions.size){let start=0;for(const[end,region]of runs){
    if(regions.has(region))for(let cell=start;cell<end;cell++)add(cell%map.width,Math.floor(cell/map.width));
    start=end;
  }}else for(let y=0;y<game.map.height;y++)for(let x=0;x<game.map.width;x++)add(x,y);
  points.sort((a,b)=>a.cost-b.cost);
  game.flightLandingCache={key,points};return points;
}
export function vehicleJourneyInput(game, input, pathTo) {
  if (!game.map?.worldTerrain) return null;
  const model = vehicleInputState(game);
  if ([2, 3].includes(model.id) && input.target &&
      autoVehicleInput(game, { action: 'dismount', vehicleId: model.id }))
    return { ...input, status: 'vehicle' };
  if (model.flying && input.target) {
    if(input.target.kind===21)return input.target.transportationIds?.includes(model.id)?null:{...input,status:'wrong-vehicle'};
    const candidates = landingCandidates(game,model.id,input.target);
    for (const point of candidates) {
      const foot = Object.create(game);
      foot.player = { ...game.player, ...point, vehicle: null };
      foot.walkCache = null; foot.canMove = game.canWalk.bind(game);
      if (!pathTo(foot, input.target)) continue;
      const target = { id: `landing:${point.x},${point.y}`, kind: 0, ...point, layer: game.player.layer },
        route = pathTo(game, target);
      if (!route) continue;
      if (route.length) { game.move(route[0]); return { ...input, target, route, status: 'walk' }; }
      if (autoVehicleInput(game, { action: 'land', vehicleId: model.id })) return { ...input, status: 'vehicle' };
    }
    return { ...input, status: 'no-landing' };
  }
  if (model.id === 1 && (input.status === 'no-route' || input.route?.length > 12 || input.target?.kind===21)) {
    const parked = Object.entries(game.banks.PlaySystems?.vehicles || {})
      .filter(([id, value]) => [4, 5].includes(Number(id)) && value.mapId === game.mapId && value.enabled !== false)
      .map(([id, value]) => ({ ...value, id: `board:${id}`, kind: 6, vehicleId: Number(id) }));
    for (const target of parked) {
      const route = pathTo(game, target);
      if (!route) continue;
      if (route.length) { game.move(route[0]); return { target, route, status: 'walk' }; }
      if (autoVehicleInput(game, { action: 'takeoff', vehicleId: target.vehicleId })) return { status: 'vehicle' };
    }
  }
  return null;
}
