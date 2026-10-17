import path from "node:path";

const objectLayers = {
  BottomObject: 0,
  GroundObject: 1,
  UpperObject: 2,
  CeilObject: 3,
  MinimapObject: 4,
};
const collisionLayers = {
  BottomCollision: 0,
  GroundCollision: 1,
  UpperCollision: 2,
  CeilCollision: 3,
};
const directions = { 0: "down", 1: "up", 2: "right", 4: "down", 8: "left" };
const properties = (object) =>
  Object.fromEntries((object.properties || []).map((row) => [row.name, row.value]));
const dict = (rows) => Object.fromEntries(rows.map((row) => [row.id, row]));

function walkLayers(data, visit, pointer = "", inherited = {}) {
  for (const [index, layer] of (data.layers || []).entries()) {
    const location = `${pointer}/layers/${index}`;
    const context = {
      x: (inherited.x || 0) + Number(layer.x || 0),
      y: (inherited.y || 0) + Number(layer.y || 0),
      offsetx: (inherited.offsetx || 0) + Number(layer.offsetx || 0),
      offsety: (inherited.offsety || 0) + Number(layer.offsety || 0),
      opacity: (inherited.opacity ?? 1) * Number(layer.opacity ?? 1),
      visible: inherited.visible !== false && layer.visible !== false,
      group: layer.type === "group" ? layer.name : inherited.group,
    };
    if (layer.layers) walkLayers(layer, visit, location, context);
    else visit(layer, location, context);
  }
}

export function packageBinding(row, packages, assetIndex) {
  const pack = packages.find(
    (pack) =>
      pack.data.asset_group_name === row.asset_name &&
      pack.data.map?.some((map) => map.name === row.map_name),
  );
  if (!pack) throw Error(`Map ${row.id}: missing PR package ${row.asset_name}/${row.map_name}`);
  const declaration = pack.data.map.find((map) => map.name === row.map_name);
  const prefix = path.posix.dirname(pack.source.assetPath) + "/";
  const assetPath = (relative) =>
    path.posix.normalize(relative.startsWith("Assets/") ? relative : prefix + relative);
  const assetAt = (relative) =>
    relative
      ? assetIndex.get(
          (
            pack.source.file +
            "::" +
            assetPath(relative).replace(/(?:\.json)?$/, ".json")
          ).toLowerCase(),
        )
      : null;
  return { pack, declaration, prefix, assetPath, assetAt };
}

export function compileMap(row, binding, tables, media, messages) {
  const { pack, declaration, assetAt, assetPath } = binding;
  const raw = assetAt(declaration.tilemap)?.data || {
    width: 64,
    height: 64,
    tilewidth: 16,
    layers: [],
    tilesets: [],
  };
  const width = Number(raw.width),
    height = Number(raw.height),
    tileSize = Number(raw.tilewidth || 16);
  const scripts = dict(tables["script.csv"] || []),
    assets = dict(tables["mapobject.csv"] || []),
    contents = dict(tables["content.csv"] || []);
  const initializers = dict(tables["map_script.csv"] || []);
  const layers = [],
    collisions = {},
    entities = [],
    groups = {},
    routes = {},
    textures = {},
    guesses = [];
  const warn = (message) => {
    if (!guesses.includes(message)) guesses.push(message);
  };
  if (!declaration.tilemap)
    warn("PR declares no tilemap for this placeholder; retained existing empty 64x64 fallback.");
  walkLayers(raw, (layer, pointer, context) => {
    if (layer.type !== "tilelayer" || !Array.isArray(layer.data)) return;
    if (context.x || context.y || context.offsetx || context.offsety)
      warn("Visual tile-layer offsets retain their existing full-grid presentation approximation.");
    layers.push({
      name: layer.name,
      width: layer.width || width,
      height: layer.height || height,
      data: layer.data,
      opacity: context.opacity,
      sourceGroup: context.group || "",
    });
  });
  walkLayers(assetAt(declaration.collision)?.data || {}, (layer) => {
    const id = collisionLayers[layer.name];
    if (id !== undefined && Array.isArray(layer.data)) collisions[id] = layer.data;
  });
  const mountRows = tables["transportation.csv"] || [],
    fieldAssets = dict(tables["field_character_asset.csv"] || []);
  const interaction = (p, script) => {
    const ids = p.talk_target_transportation_ids
      ? String(p.talk_target_transportation_ids).split(",").map(Number)
      : mountRows
          .filter((row) => ![2, 3, 4, 6, 7, 8, 9, 10].includes(Number(row.type_id)))
          .map((row) => Number(row.id));
    return {
      acceptDirection: Number(p.accept_action_direction ?? 0),
      collision: p.collision !== false,
      soundId: Number(p.se_id || 0),
      talkMounts: mountRows
        .filter((row) => ids.includes(Number(row.id)))
        .map((row) =>
          Number(row.type_id) === 1 ? "" : fieldAssets[row.asset_id]?.asset_name || "",
        ),
      interaction: {
        ...(script
          ? { kind: "script", script }
          : p.message_key
            ? {
                kind: "talk",
                message: { key: p.message_key, text: messages[p.message_key] || "", speaker: "" },
              }
            : { kind: "none" }),
        actionId: Number(p.action_id || 0),
        productGroup: Number(p.product_group_id || 0),
      },
    };
  };
  const addGroup = (name, asset) => {
    if (!asset) {
      groups[name] = { name, entities: [] };
      return;
    }
    const output = [];
    walkLayers(asset.data, (layer, pointer, context) => {
      if (!layer.objects) return;
      const layerId = objectLayers[layer.name] ?? 1;
      for (const [index, object] of layer.objects.entries()) {
        const p = properties(object),
          kind = Number(p.object_type ?? -1);
        if (kind < 0) continue;
        const script = scripts[p.script_id]?.script_name || null;
        const layerPath = pointer
          .split("/")
          .filter((part) => /^\d+$/.test(part))
          .join(":");
        const entity = {
          id: String(p.entity_id || `${name}:${layerPath}:${index}`),
          kind,
          objectId: Number(p.object_id || 0),
          layer: layerId,
          x: (Number(object.x || 0) + context.x + context.offsetx) / tileSize,
          y:
            (Number(object.y || 0) + context.y + context.offsety) / tileSize -
            (object.gid && kind !== 1 ? Number(object.height ?? tileSize) / tileSize : 0),
          width: Number(object.width ?? tileSize) / tileSize,
          height: Number(object.height ?? tileSize) / tileSize,
          direction: directions[Number(p.direction || 0)] || "down",
          asset: [6, 17, 10].includes(kind) ? assets[p.asset_id]?.asset_name || null : null,
          script,
          collision: null,
          destinationLayer: kind === 4 ? Number(p.layer) : null,
        };
        // PR minimap objects store an editor rectangle; runtime pins its center.
        if (kind === 18) {
          entity.x += Math.trunc(Number(object.width ?? 0) / 2) / tileSize;
          entity.y -= Math.trunc(Number(object.height ?? 0) / 2) / tileSize;
        }
        if (kind === 3)
          entity.destination = { mapId: Number(p.map_id), entrance: Number(p.point_id || 1) };
        if ([6, 17].includes(kind))
          entity.npc = {
            ...interaction(p, script),
            moveType: Number(p.move_type || 0),
            pushed: Boolean(p.pushed),
            eyeContact: Boolean(p.eye_contact),
            turnAround: Boolean(p.turn_around),
            allLayers: Boolean(p.all_layers),
            birdview: Boolean(p.birdview_puppet),
          };
        if ([5, 10].includes(kind))
          entity.mapObject = { ...interaction(p, script), collision: Boolean(p.collision) };
        if (kind === 7) {
          const content = contents[p.content_id];
          entity.treasure = {
            entityId: Number(p.entity_id || 0),
            contentId: Number(p.content_id || 0),
            contentNum: Number(p.content_num || 0),
            flagId: Number(p.flag_id || 0),
            scriptName: script,
            reward:
              Number(content?.type_id) === 5
                ? { kind: "grant-gil", amount: Number(p.content_num || 0) }
                : {
                    kind: Number(content?.type_id) === 1 ? "grant-item" : "grant-equipment",
                    id: Number(p.content_id),
                    count: Number(p.content_num || 0),
                  },
            presentation: {
              pickUp: Boolean(p.pick_up),
              soundId: Number(p.se_id || 0),
              linkObjectId: Number(p.link_object_id || 0),
              messageKey: p.message_key || "",
            },
          };
        }
        if (kind === 9)
          entity.savePoint = {
            actionId: Number(p.action_id || 0),
            visible: object.visible !== false,
          };
        if (kind === 21 || (kind === 2 && p.target_transportation_ids))
          entity.transportationIds = String(p.target_transportation_ids || "")
            .split(",")
            .map(Number)
            .filter((id) => id > 0);
        if (kind === 30)
          Object.assign(entity, {
            leaveScriptId: Number(p.leave_script_id || 0),
            actionId: Number(p.action_id || 0),
          });
        output.push(entity);
      }
    });
    groups[name] = { name, entities: output };
    if (name === "entity_default") entities.push(...output);
  };
  addGroup("entity_default", assetAt(declaration.entity_default));
  for (const group of declaration.entity || []) addGroup(group.name, assetAt(group.asset));
  for (const [key, asset] of binding.bundleAssets || []) {
    const match = asset.source.assetPath.match(/\/route_instruction_(\d+)\.json$/);
    if (match && asset.source.assetPath.startsWith(binding.prefix))
      routes[match[1]] = asset.data.instruction_list || [];
  }
  for (const texture of pack.data.texture || []) {
    const location = assetPath(texture.asset)
      .replace(/(?:\.png)?$/, ".png")
      .toLowerCase();
    const image = media.textures.find(
      (image) =>
        image.source.file === pack.source.file &&
        (image.source.assetPaths || [image.source.assetPath]).some(
          (p) => p?.toLowerCase() === location,
        ),
    );
    if (image) textures[texture.name + ".png"] = "/web-data/" + image.url;
    else warn(`Missing PR texture ${texture.name}`);
  }
  const map = {
    id: Number(row.id),
    name: row.map_name,
    areaId: Number(row.area_id),
    initializer: initializers[row.script_id]?.script_name || "",
    width,
    height,
    tileSize,
    layers,
    tilesets: raw.tilesets || [],
    textures,
    collisions,
    entities,
    groups,
    routes,
  };
  if (declaration.attribute && declaration.transportation) {
    const attributes = assetAt(declaration.attribute)?.data,
      transport = assetAt(declaration.transportation)?.data;
    const cells = attributes?.layers?.[0]?.data;
    if (!cells) throw Error(`World map ${row.id}: missing foot grid`);
    const transportLayers = transport.layers || [];
    const footRows = Object.fromEntries(
      (tables["foot_information.csv"] || []).map((row) => [
        row.id,
        {
          id: Number(row.id),
          typeId: Number(row.type_id),
          subtractSteps: Number(row.subtract_steps),
          battleBackgroundAssetId: Number(row.battle_background_asset_id),
        },
      ]),
    );
    const transportationGroups = dict(tables["transportation_group.csv"] || []);
    const transportRules = Object.fromEntries(
      mountRows.map((row) => {
        const layer = transportLayers.find(
          (layer) => Number(layer.id) === Number(row.transportation_group_id),
        );
        if (!layer)
          throw Error(
            `World map ${map.id}: missing transportation group ${row.transportation_group_id}`,
          );
        const collisionByFoot = {};
        cells.forEach((foot, index) => {
          if (collisionByFoot[foot] !== undefined && collisionByFoot[foot] !== layer.data[index])
            throw Error("Spatially varying foot collision requires cell rules");
          collisionByFoot[foot] = layer.data[index];
        });
        const group = transportationGroups[row.transportation_group_id];
        return [
          row.id,
          {
            id: Number(row.id),
            typeId: Number(row.type_id),
            groupId: Number(row.transportation_group_id),
            groupFlags: Array.from({ length: 32 }, (_, index) =>
              Number(group[index < 3 ? `type${index + 1}` : `type_${index + 1}`]),
            ),
            collisionByFoot,
          },
        ];
      }),
    );
    map.worldTerrain = {
      kind: "source-world-terrain-v1",
      mapId: map.id,
      mapName: map.name,
      width,
      height,
      loopType: Number(row.loop_type),
      cells,
      footRows,
      transportRules,
    };
    if (declaration.encount) {
      const source = assetAt(declaration.encount)?.data;
      if (
        source?.width > 0 &&
        source?.height > 0 &&
        Array.isArray(source.cells) &&
        source.cells.length === source.width * source.height
      )
        map.worldTerrain.encounterGrid = {
          width: Number(source.width),
          height: Number(source.height),
          cells: source.cells.map(Number),
        };
      else
        warn(
          "PR world encounter grid is unavailable; regular table-grid lookup remains an approximation.",
        );
    }
  }
  if (guesses.length) map.guesses = guesses;
  return map;
}
