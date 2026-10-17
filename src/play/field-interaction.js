import { openShop } from "./event-systems.js";

export const fieldInteractionDefinition = (entity) => entity.npc || entity.mapObject;

// PR stores the side of the object from which the player acts. A player below
// an object is on its south side (4), although the player is facing north.
export function acceptsFieldInteraction(entity, x, y) {
  const mask = fieldInteractionDefinition(entity)?.acceptDirection;
  if (mask == null || Number(mask) === 0) return true;
  const dx = x - entity.x,
    dy = y - entity.y,
    side = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 2 : 8) : dy > 0 ? 4 : dy < 0 ? 1 : 0;
  return Boolean(Number(mask) & side);
}

export function sameCellFieldInteraction(entity) {
  const definition = entity.mapObject;
  return Boolean(
    definition &&
    definition.collision === false &&
    definition.acceptDirection === 0 &&
    (entity.script || definition.interaction?.script || definition.interaction?.actionId > 0),
  );
}

function beginInteraction(game, source, actual, definition, distance) {
  game.event("field-interaction", {
    entityId: source.id,
    entityKind: source.kind,
    actionId: definition?.interaction?.actionId ?? null,
    group: source.group,
  });
  if (distance === 2)
    game.warn(
      null,
      "Counter interaction treats one blocked cell between player and object as a talk-through counter; exact counter tile flags are not exported.",
    );
  if (definition?.acceptDirection === 0)
    game.warn(
      null,
      "PR accept_action_direction=0 on an active field object has no side bits; ordinary adjacent or overlapping confirmation is allowed. Exact overlap activation semantics are inferred.",
    );
  if (definition?.soundId > 0) game.event("se", { id: definition.soundId });
  if (source.npc?.eyeContact && source.npc?.turnAround) {
    const actor = game.actor(source.id),
      dx = game.player.x - actual.x,
      dy = game.player.y - actual.y;
    actor.direction =
      Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
  }
}

// Both NPCs and map objects carry the same PR action/message/product fields.
// A source script owns the interaction even if its numeric action differs.
export function dispatchFieldInteraction(game, source, actual = source, distance = 1) {
  const definition = fieldInteractionDefinition(actual) || fieldInteractionDefinition(source),
    interaction = definition?.interaction,
    script = actual.script || interaction?.script;
  if (script) {
    beginInteraction(game, source, actual, definition, distance);
    game.startScript(script);
    return true;
  }
  if (interaction?.actionId === 8) {
    beginInteraction(game, source, actual, definition, distance);
    return openShop(game, interaction.productGroup);
  }
  const message = interaction?.message;
  if (message) {
    const key = message.key || "",
      text = game.text(key, message.text);
    if (text) {
      beginInteraction(game, source, actual, definition, distance);
      game.dialogue = {
        key,
        text,
        speaker: game.data.speakers?.[key] || message.speaker || "",
        task: null,
        elapsed: 0,
      };
      game.event("dialogue", { key, text, entityId: source.id, group: source.group });
      return true;
    }
    game.warn(null, `PR field message ${key || "(no key)"} on entity ${source.id} is empty.`);
  } else if (interaction?.actionId > 0)
    game.warn(
      null,
      `PR field action ${interaction.actionId} on entity ${source.id} has no source script, message or shop; interaction has no effect.`,
    );
  return false;
}
