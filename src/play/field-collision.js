// Field tiles and entity bodies are separate in PR. Authored puppet movement
// deliberately does not use these ordinary-walking checks.
const bodyKinds = new Set([5, 6, 7, 8, 10, 17]);
const materializedKinds = new Set([6, 7, 10, 14, 17]);
const passKinds = new Set([0, 1, 2, 3, 4, 9, 18, 19, 20, 21, 30]);
const directionBits = { up: 1, right: 2, down: 4, left: 8 };
const live = (game, entity) => game.actors?.get(String(entity.id));
const value = (actor, entity, key) => actor?.[key] ?? entity[key];
const visible = (actor, entity) => value(actor, entity, "visible") !== false;
export function fieldEntityVisible(game, entity) {
  const actor = live(game, entity);
  // refreshActors materializes these kinds. Erase removes that live actor;
  // falling back to the source row would resurrect its body and interaction.
  return (
    (game.actorEntitySource !== game.entities || !materializedKinds.has(entity.kind) || !!actor) &&
    visible(actor, entity)
  );
}
function covers(entity, actor, x, y, destination = false) {
  const px = destination ? actor?.motion?.tx : value(actor, entity, "x"),
    py = destination ? actor?.motion?.ty : value(actor, entity, "y"),
    width = Math.max(1, Number(value(actor, entity, "width")) || 1),
    height = Math.max(1, Number(value(actor, entity, "height")) || 1);
  return (
    Number.isFinite(px) &&
    Number.isFinite(py) &&
    x > px - 0.6 &&
    x < px + width - 0.4 &&
    y > py - 0.6 &&
    y < py + height - 0.4
  );
}
function sameLayer(entity, actor, layer) {
  return (
    value(actor, entity, "layer") == null ||
    value(actor, entity, "layer") === layer ||
    Boolean((actor?.npc || entity.npc)?.allLayers)
  );
}
function regionsFor(game, door) {
  const objectId = Number(door.door?.linkObjectId);
  return (game.entities || []).filter(
    (entity) =>
      entity.kind === 1 &&
      Number(entity.objectId) === objectId &&
      (entity.layer === door.layer || entity.tileAnimation?.allLayers),
  );
}
function isOpenDoor(game, entity, actor) {
  const regions = regionsFor(game, entity);
  return (
    actor?.opened === true ||
    regions.some((region) => live(game, region)?.tileNormalized === 1) ||
    // Older saves retain the source Hide but predate normalized tile frames.
    // A removed door releases its own region unless the source explicitly
    // restored the closed frame afterwards.
    (actor?.visible === false &&
      actor.opened !== false &&
      !regions.some((region) => live(game, region)?.tileNormalized === 0))
  );
}
function bodyCandidates(game) {
  const cached = game.fieldCollisionCache;
  if (
    cached?.entities === game.entities &&
    cached.actors === game.actors &&
    cached.actorCount === game.actors?.size
  )
    return cached.bodies;
  const bodies = (game.entities || []).filter(
    (entity) =>
      bodyKinds.has(entity.kind) ||
      (typeof entity.collision === "boolean" && !passKinds.has(entity.kind)),
  );
  const seen = new Set(bodies.map((entity) => String(entity.id)));
  for (const [id, actor] of game.actors || [])
    if (Number(id) < 0 && Number(id) > -100 && !seen.has(String(id))) bodies.push(actor);
  game.fieldCollisionCache = {
    entities: game.entities,
    actors: game.actors,
    actorCount: game.actors?.size,
    bodies,
  };
  return bodies;
}
function solid(game, entity, actor) {
  if (passKinds.has(entity.kind)) return false;
  if (typeof actor?.collision === "boolean") return actor.collision;
  if (typeof entity.collision === "boolean") return entity.collision;
  if (entity.kind === 8) return entity.door?.actionId === 5 && !isOpenDoor(game, entity, actor);
  if (entity.treasure) return !entity.treasure.presentation?.pickUp;
  const definition = actor?.npc || entity.npc || actor?.mapObject || entity.mapObject;
  if (definition?.collision !== undefined) return Boolean(definition.collision);
  // Negative character puppets have no map-entity row; a visible separate
  // character remains a body. Vehicle puppets (-101...) are handled elsewhere.
  return Number(entity.id) < 0 && Number(entity.id) > -100;
}

export function walkingLayerAt(game, x, y, layer) {
  for (const entity of game.entities || []) {
    if (entity.kind !== 4 || entity.destinationLayer == null) continue;
    const actor = live(game, entity);
    if (visible(actor, entity) && sameLayer(entity, actor, layer) && covers(entity, actor, x, y))
      return entity.destinationLayer;
  }
  return layer;
}

export function fieldBlockerAt(game, x, y, layer, mover = game.player, ignoredBody = null) {
  const arrivalLayer = walkingLayerAt(game, x, y, layer),
    ownId = String(mover?.id),
    leader = game.partySlots?.[game.partyIndex || 0]?.[0];
  for (const entity of bodyCandidates(game)) {
    if (ignoredBody && String(entity.id) === String(ignoredBody.id)) continue;
    if (String(entity.id) === ownId || (Number(entity.id) === -leader && mover === game.player))
      continue;
    const actor = live(game, entity) || (Number(entity.id) < 0 ? entity : null);
    if (
      !fieldEntityVisible(game, entity) ||
      !sameLayer(entity, actor, arrivalLayer) ||
      !solid(game, entity, actor)
    )
      continue;
    if (covers(entity, actor, x, y) || (actor?.motion && covers(entity, actor, x, y, true)))
      return { entity, actor };
  }
  if (
    mover !== game.player &&
    game.player?.visible !== false &&
    game.player?.layer === arrivalLayer &&
    covers(game.player, null, x, y)
  )
    return { entity: game.player, actor: game.player };
  // Party formation markers are not PR entity colliders. Source multi-party
  // puzzles explicitly allow two inactive party positions on the same plate.
  return null;
}

// A door can release only its own source-linked tile region. Decorative tile
// animations and hidden unrelated objects never turn walls into floor.
export function openedDoorTerrainAt(game, x, y, layer) {
  for (const door of game.entities || []) {
    if (door.kind !== 8 || door.door?.actionId !== 5) continue;
    const actor = live(game, door);
    if (!isOpenDoor(game, door, actor)) continue;
    if (sameLayer(door, actor, layer) && covers(door, actor, x, y)) return true;
    for (const region of regionsFor(game, door))
      if (
        (region.layer === layer || region.tileAnimation?.allLayers) &&
        covers(region, live(game, region), x, y)
      )
        return true;
  }
  return false;
}

export function setTileFrame(game, entity, normalized) {
  const actor = game.actor(entity.id),
    state = Math.max(0, Math.min(1, Number(normalized) || 0));
  actor.tileNormalized = state;
  actor.tileFrame = entity.tileAnimation?.reverse ? 1 - state : state;
  for (const door of game.entities || [])
    if (
      door.kind === 8 &&
      Number(door.door?.linkObjectId) === Number(entity.objectId) &&
      regionsFor(game, door).includes(entity)
    )
      game.actor(door.id).opened = state === 1;
  game.walkCache = null;
  return actor.tileFrame;
}

export function applyTileAnimation(game, actor, integers, reals, strings) {
  if (actor.kind !== 1 || strings[0]) return false;
  // PR's padded integer/real operands use zero for the initial frame. The
  // source inn door explicitly requests CueAnim i0=0/r0=1 for its open frame.
  const normalized = reals[0] || integers[0] || 0;
  const source =
    (game.entities || []).find(
      (entity) => entity.kind === 1 && String(entity.id) === String(actor.id),
    ) || actor;
  setTileFrame(game, source, normalized);
  return true;
}

export function openableDoorAt(game, x, y, layer, direction = null) {
  const arrivalLayer = walkingLayerAt(game, x, y, layer);
  for (const entity of game.entities || []) {
    if (entity.kind !== 8 || entity.door?.actionId !== 5 || entity.script) continue;
    const actor = live(game, entity),
      mask = entity.door.direction ?? 15;
    if (
      !visible(actor, entity) ||
      !sameLayer(entity, actor, arrivalLayer) ||
      isOpenDoor(game, entity, actor)
    )
      continue;
    if (direction && mask > 0 && !(mask & directionBits[direction])) continue;
    if (covers(entity, actor, x, y)) return entity;
  }
  return null;
}

export function openFieldDoor(game, entity) {
  if (entity.kind !== 8 || entity.door?.actionId !== 5 || entity.script) return false;
  const actor = game.actor(entity.id),
    mask = entity.door.direction ?? 15;
  if (actor.visible === false || (mask > 0 && !(mask & directionBits[game.player.direction])))
    return false;
  const regions = regionsFor(game, entity);
  for (const region of regions) setTileFrame(game, region, 1);
  actor.opened = true;
  actor.visible = false;
  game.walkCache = null;
  if (!regions.length)
    game.warn?.(
      null,
      `PR door ${entity.id} has no active linked tile region ${entity.door.linkObjectId}; its body opens, visual region unavailable.`,
    );
  if (entity.door.soundId > 0) game.event?.("se", { id: entity.door.soundId });
  game.event?.("door-open", {
    entityId: entity.id,
    objectId: entity.door.linkObjectId,
    regionIds: regions.map((region) => region.id),
  });
  return true;
}
