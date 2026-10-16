import { isVeldt } from './encounters.js';
import { shopScriptsForContent } from './event-systems.js';
import { routeToStory } from './navigation.js';

// These are ordinary inputs for recurring non-dialogue objectives: find a
// seller, buy an item in its menu, then walk on eligible encounter terrain.
export function randomEncounterInput(game, objective, pathTo) {
  const buy = objective.buy;
  if (buy && (game.inventory[buy.contentId] || 0) < (buy.count || 1))
    return routeToStory(game, { scripts: shopScriptsForContent(game, buy.contentId) }, pathTo);
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
