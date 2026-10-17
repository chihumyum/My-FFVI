import { fieldEntityVisible, walkingLayerAt } from "./field-collision.js";
import { acceptsFieldInteraction } from "./field-interaction.js";

const directions = ["up", "right", "down", "left"];
const deltas = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];
const speeds = [0.24, 0.48, 0.12, 0.96, 0.06, 1.92, 0.16];
const intervals = [0.65, 0.25, 0.5, 1, 1.5, 2, 0.05];

function warn(
  game,
  message = "PR NPC movement uses source type, MoveArea, step, speed and interval IDs. Types 1=turn, 2=wander, 3=approach and interval durations are inferred; movement speed follows the existing field speed table. NPC-only walkability flags are approximated by terrain, bodies, MoveArea and avoiding map exits/stairs. SNES NPCMoveRand confirms terrain/body checks and paused movement during events.",
) {
  game.instructionWarnings ??= new Set();
  if (!game.instructionWarnings.has(message)) {
    game.instructionWarnings.add(message);
    game.warn(null, message);
  }
}

// Action9 is a collision input, including Gogo's bridge guards. The source
// event owns falling, map changes and battle outcomes; contact does not move
// either participant through the other's body.
export function tryNpcContact(game, entity) {
  const actor = game.actors.get(String(entity.id));
  if (
    game.busy ||
    entity.kind !== 6 ||
    entity.npc?.interaction?.actionId !== 9 ||
    !entity.script ||
    !fieldEntityVisible(game, entity)
  )
    return false;
  const actual = { ...entity, ...actor };
  if (
    (actual.layer !== game.player.layer && !entity.npc?.allLayers) ||
    Math.abs(actual.x - game.player.x) + Math.abs(actual.y - game.player.y) > 1.01 ||
    !acceptsFieldInteraction(actual, game.player.x, game.player.y)
  )
    return false;
  const key = `${game.mapId}:${[...game.groups].join(",")}:${entity.id}`;
  if (game.triggered.has(key)) return false;
  game.triggered.add(key);
  if (game.rts?.active && entity.npc.moveType === 3)
    (game.banks.MapLocalVariable ??= {})[0] = game.partyIndex;
  game.event("npc-contact", { entityId: entity.id, script: entity.script });
  game.startScript(entity.script);
  return true;
}

function insideArea(area, x, y, layer) {
  return (
    !area ||
    ((area.layer == null || area.layer === layer) &&
      x >= area.x &&
      x < area.x + Math.max(1, area.width || 1) &&
      y >= area.y &&
      y < area.y + Math.max(1, area.height || 1))
  );
}

export function updateNpcMovement(game, dt) {
  if (!game.control || game.loading || game.battle || game.over) return;
  for (const entity of game.entities || []) {
    const definition = entity.npc;
    if (entity.kind !== 6 || !fieldEntityVisible(game, entity)) continue;
    const actor = game.actors.get(String(entity.id));
    if (
      actor &&
      Math.abs(actor.x - game.player.x) + Math.abs(actor.y - game.player.y) < 0.6 &&
      tryNpcContact(game, entity)
    )
      return;
    if (
      ![1, 2, 3].includes(definition?.moveType) ||
      (definition.moveType === 3 && game.rts?.active)
    )
      continue;
    if (
      !actor ||
      actor.motion ||
      (game.busy && !(game.dialogue && definition.moveWhileDisplayMessage)) ||
      game.tasks.some((task) => !task.done && String(task.actor) === String(entity.id)) ||
      game.assignedRouteTasks?.get(Number(entity.id))?.done === false
    )
      continue;
    actor.npcMoveWait = (actor.npcMoveWait || 0) + dt;
    if (actor.npcMoveWait < (intervals[definition.moveIntervalId] ?? intervals[0])) continue;
    actor.npcMoveWait = 0;
    warn(game);
    const randomDirection = Math.min(3, Math.floor(game.random() * 4));
    if (definition.moveType === 1) {
      actor.direction = directions[randomDirection];
      actor.animation = "Default";
      continue;
    }
    let order = [randomDirection];
    if (definition.moveType === 3) {
      const dx = game.player.x - actor.x,
        dy = game.player.y - actor.y;
      order =
        Math.abs(dx) > Math.abs(dy)
          ? [dx > 0 ? 1 : 3, dy > 0 ? 2 : 0]
          : [dy > 0 ? 2 : 0, dx > 0 ? 1 : 3];
    }
    const area =
      definition.moveAreaId > 0
        ? game.entities.find(
            (candidate) => candidate.kind === 13 && candidate.objectId === definition.moveAreaId,
          )
        : null;
    for (const direction of order) {
      const [dx, dy] = deltas[direction];
      let x = Math.round(actor.x),
        y = Math.round(actor.y),
        layer = actor.layer,
        steps = 0;
      for (let step = 0; step < Math.max(1, definition.moveStep || 1); step++) {
        const nx = x + dx,
          ny = y + dy;
        if (!insideArea(area, nx, ny, layer)) break;
        if (
          game.player.visible !== false &&
          game.player.layer === layer &&
          Math.abs(game.player.x - nx) + Math.abs(game.player.y - ny) < 0.6 &&
          tryNpcContact(game, entity)
        )
          return;
        if (
          !game.canMove(nx, ny, layer, actor) ||
          game.entities.some(
            (entry) =>
              [3, 4].includes(entry.kind) &&
              entry.layer === layer &&
              Math.abs(entry.x - nx) + Math.abs(entry.y - ny) < 0.6,
          )
        )
          break;
        x = nx;
        y = ny;
        layer = walkingLayerAt(game, x, y, layer);
        steps++;
      }
      if (!steps) continue;
      if (speeds[definition.moveSpeedId] == null)
        warn(
          game,
          `PR NPC speed id ${definition.moveSpeedId} has no exported duration table; using normal field speed ${speeds[0]} seconds/cell.`,
        );
      actor.direction = directions[direction];
      game.motion({}, actor, x, y, steps * (speeds[definition.moveSpeedId] ?? speeds[0]));
      actor.layer = layer;
      game.walkCache = null;
      break;
    }
  }
}
