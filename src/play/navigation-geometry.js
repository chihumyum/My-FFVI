import { navigationRegions } from "./navigation-regions.js";
import { fieldEntityVisible } from "./field-collision.js";

const decoded = new WeakMap();
const indexed = new WeakMap();
const bodyKinds = new Set([5, 6, 7, 8, 10, 17, 19]);

export function fieldGeometryKey(game) {
  return JSON.stringify([
    game.partySlots?.[game.partyIndex || 0]?.[0],
    game.rts?.active,
    game.player?.vehicle,
    (game.entities || []).map((entity) => [entity.id, entity.visible, entity.collision]),
    [...(game.actors || [])].map(([id, actor]) => [
      id,
      actor.x,
      actor.y,
      actor.layer,
      actor.visible,
      actor.collision,
      actor.motion?.tx,
      actor.motion?.ty,
      actor.opened,
      actor.tileNormalized,
    ]),
  ]);
}

function sourceMap(index) {
  if (!decoded.has(index)) {
    const collisions = {};
    for (const [layer, runs] of Object.entries(index.geometry.collisionRuns)) {
      const grid = new Uint8Array(index.width * index.height);
      let start = 0;
      for (const [end, value] of runs) {
        grid.fill(value, start, end);
        start = end;
      }
      collisions[layer] = grid;
    }
    decoded.set(index, { width: index.width, height: index.height, collisions });
  }
  return decoded.get(index);
}

// This is the same ordinary movement query used by the field host, sampled
// only where bodies and doors can change the terrain grid. No scripts run and
// no player decisions are made while constructing this read-only index.
export function physicalNavigation(game, index, initialized) {
  if (!index.geometry || index.world) return index;
  const current = index.id === game.mapId;
  const key = current
    ? fieldGeometryKey(game)
    : JSON.stringify([
        [...initialized.groups],
        [...initialized.actorPositions],
        [...initialized.actorStates],
      ]);
  if (indexed.get(index)?.key === key) return indexed.get(index).value;
  const entities = current
    ? game.entities
    : index.geometry.entities.filter((entity) => initialized.groups.has(entity.group));
  const actors = current
    ? game.actors
    : new Map(
        entities.map((entity) => [
          String(entity.id),
          {
            ...entity,
            ...initialized.actorPositions.get(Number(entity.id)),
            ...initialized.actorStates.get(Number(entity.id)),
          },
        ]),
      );
  const map = { ...index, ...sourceMap(index), entities };
  const host = Object.assign(Object.create(game), {
    mapId: index.id,
    map,
    entities,
    actors,
    actorEntitySource: entities,
    player: { ...game.player, vehicle: null },
    fieldCollisionCache: null,
    rts: current ? game.rts : null,
  });
  const candidates = new Map();
  const layers = Object.keys(map.collisions).map(Number);
  const linkedRegions = new Set(
    entities.filter((e) => e.kind === 8).map((e) => Number(e.door?.linkObjectId)),
  );
  for (const entity of [
    ...entities,
    ...[...actors].filter(([id]) => Number(id) < 0 && Number(id) > -100).map(([, actor]) => actor),
  ]) {
    if (
      !bodyKinds.has(entity.kind) &&
      entity.kind !== 4 &&
      !(Number(entity.id) < 0 && Number(entity.id) > -100) &&
      !(entity.kind === 1 && linkedRegions.has(Number(entity.objectId)))
    )
      continue;
    const actor = actors.get(String(entity.id)) || entity;
    for (const position of [
      actor,
      ...(actor.motion ? [{ ...actor, x: actor.motion.tx, y: actor.motion.ty }] : []),
    ])
      for (const layer of layers)
        if (
          position.layer == null ||
          position.layer === layer ||
          entity.npc?.allLayers ||
          entity.tileAnimation?.allLayers
        )
          for (
            let y = Math.max(0, Math.floor(position.y - 0.59));
            y <=
            Math.min(
              map.height - 1,
              Math.ceil(position.y + Math.max(1, entity.height || 1) - 0.41),
            );
            y++
          )
            for (
              let x = Math.max(0, Math.floor(position.x - 0.59));
              x <=
              Math.min(
                map.width - 1,
                Math.ceil(position.x + Math.max(1, entity.width || 1) - 0.41),
              );
              x++
            )
              candidates.set(`${layer}:${x},${y}`, { x, y, layer });
  }
  const patches = new Map();
  for (const [key, point] of candidates)
    patches.set(key, host.canTraverse(point.x, point.y, point.layer));
  const entries = index.entries
    .filter(
      (entry) =>
        (current ? game.groups : initialized.groups).has(entry.group) &&
        entities.some((entity) => entity.id === entry.id),
    )
    .map((entry) => ({ ...entry, ...actors.get(String(entry.id)) }))
    .filter((entry) => !bodyKinds.has(entry.kind) || fieldEntityVisible(host, entry));
  const connectivity = navigationRegions(
    {
      ...map,
      entities: entities
        .map((entity) => ({ ...entity, ...actors.get(String(entity.id)) }))
        .filter((entity) => entity.kind !== 4 || fieldEntityVisible(host, entity)),
    },
    entries,
    (entry) =>
      entry.kind === 2 &&
      entry.script &&
      (() => {
        const ops =
          game.data.programs[
            game.data.byMap[index.id]?.[entry.script] ?? game.data.global[entry.script]
          ]?.ops || [];
        return (
          ops.some((op) => op[0] === "ChangeMap") &&
          !ops.some((op) => ["Msg", "Encount", "EncountBoss"].includes(op[0]))
        );
      })(),
    (x, y, layer) =>
      patches.get(`${layer}:${x},${y}`) ??
      (map.collisions[layer] || map.collisions[0])?.[y * map.width + x] !== 1,
  );
  const value = { ...index, ...connectivity };
  indexed.set(index, { key, value });
  return value;
}
