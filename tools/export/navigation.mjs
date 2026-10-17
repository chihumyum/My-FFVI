import { navigationRegions } from "./regions.mjs";

function runs(grid) {
  const result = [];
  for (let cell = 0; cell < grid.length; cell++) {
    const value = grid[cell];
    if (result.at(-1)?.[1] === value) result.at(-1)[0] = cell + 1;
    else result.push([cell + 1, value]);
  }
  return result;
}

function geometryEntity(entity, group) {
  const keys = [
    "id",
    "objectId",
    "kind",
    "x",
    "y",
    "width",
    "height",
    "layer",
    "visible",
    "collision",
    "destinationLayer",
    "door",
    "tileAnimation",
    "script",
  ];
  const result = { group };
  for (const key of keys) if (entity[key] !== undefined) result[key] = entity[key];
  for (const key of ["npc", "mapObject"])
    if (entity[key])
      result[key] = {
        collision: entity[key].collision,
        allLayers: entity[key].allLayers,
        acceptDirection: entity[key].acceptDirection,
        moveType: entity[key].moveType,
        interaction: entity[key].interaction,
      };
  if (entity.treasure)
    result.treasure = { presentation: { pickUp: entity.treasure.presentation?.pickUp } };
  return result;
}
function canVehicleLand(host, id, x, y) {
  const terrain = host.map.worldTerrain,
    foot = terrain.cells[y * terrain.width + x],
    type = terrain.footRows[foot]?.typeId;
  const row = host.data.systemTables.transportation.find((row) => Number(row.id) === Number(id));
  const group = host.data.systemTables.landingGroup.find(
    (group) => Number(group.id) === Number(row?.landing_group_id),
  );
  return Number(group?.[type <= 3 ? `type${type}` : `type_${type}`]) === 1;
}
export function compileNavigation(sourceMaps, data) {
  const maps = {};
  const warpCache = new Map();
  function isWarp(entry, mapId) {
    if (entry.kind !== 2 || !entry.script) return false;
    const id = data.byMap[mapId]?.[entry.script] ?? data.global[entry.script];
    if (!warpCache.has(id)) {
      const ops = data.programs[id]?.ops || [];
      warpCache.set(
        id,
        ops.some((o) => o[0] === "ChangeMap") &&
          !ops.some((o) => ["Msg", "Encount", "EncountBoss"].includes(o[0])),
      );
    }
    return warpCache.get(id);
  }

  for (const raw of sourceMaps) {
    const header = {
      id: raw.id,
      name: raw.name,
      areaId: raw.areaId,
      initializer: raw.initializer,
      world: Boolean(raw.worldTerrain),
    };
    const assigned = new Map();
    for (const id of new Set(Object.values(data.byMap[raw.id] || {})))
      for (const [op, i] of data.programs[id].ops)
        if (op === "AssignMoveRoute") {
          const list = assigned.get(String(i[0])) || new Set();
          list.add(i[1]);
          assigned.set(String(i[0]), list);
        }
    const entries = [],
      add = (entry, group) => {
        if (
          !(entry.script || entry.destination || entry.npc?.interaction?.actionId === 8) ||
          entries.some((e) => e.id === entry.id && e.group === group)
        )
          return;
        entries.push({
          id: entry.id,
          kind: entry.kind,
          layer: entry.layer,
          x: entry.x,
          y: entry.y,
          script: entry.script,
          destination: entry.destination,
          productGroup:
            entry.npc?.interaction?.actionId === 8 ? entry.npc.interaction.productGroup : undefined,
          routePoints: [...(assigned.get(String(entry.id)) || [])].flatMap((id) =>
            (raw.routes?.[id] || [])
              .filter((row) => [1, 7].includes(row.instruction_type))
              .map((row) => ({ x: row.cellx, y: row.celly, layer: row.layer ?? entry.layer })),
          ),
          group,
        });
      };
    for (const [group, value] of Object.entries(raw.groups || {}))
      for (const entry of value.entities || []) add(entry, group);
    for (const entry of raw.entities || []) add(entry, "entity_default");
    maps[raw.id] = {
      ...header,
      ...navigationRegions(raw, entries, (entry) => isWarp(entry, raw.id)),
    };
    if (!header.world) {
      const entities = new Map();
      for (const [group, value] of Object.entries(raw.groups || {}))
        for (const entity of value.entities || [])
          entities.set(`${group}:${entity.id}`, geometryEntity(entity, group));
      for (const entity of raw.entities || [])
        entities.set(`entity_default:${entity.id}`, geometryEntity(entity, "entity_default"));
      maps[raw.id].geometry = {
        collisionRuns: Object.fromEntries(
          Object.entries(raw.collisions || {}).map(([layer, grid]) => [layer, runs(grid)]),
        ),
        entities: [...entities.values()],
      };
    }
    if (header.world) {
      const indexed = maps[raw.id],
        host = { data, map: raw, mapId: raw.id, player: { layer: 0 } },
        sets = { 4: new Set(), 5: new Set() };
      let start = 0;
      for (const [end, region] of indexed.regionRuns[0]) {
        if (region)
          for (const id of [4, 5])
            if (!sets[id].has(region))
              for (let cell = start; cell < end; cell++) {
                if (
                  canVehicleLand(host, id, cell % indexed.width, Math.floor(cell / indexed.width))
                ) {
                  sets[id].add(region);
                  break;
                }
              }
        start = end;
      }
      indexed.landingRegions = Object.fromEntries(
        Object.entries(sets).map(([id, set]) => [id, [...set]]),
      );
    }
  }
  return { maps };
}
