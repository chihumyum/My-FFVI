import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const read = async (file) => JSON.parse(await readFile(file));
const url = (row) => `/web-data/${row.displayUrl || row.url}`;

/** Original scenery/GPS media; no field collision, script or vehicle behavior is compiled here. */
export async function compileFieldPresentation(out) {
  const [media, tables, raw] = await Promise.all([
    read(path.join(out, "raw/media.json")),
    read(path.join(out, "raw/tables.json")),
    read(path.join(out, "raw/index.json")),
  ]);
  const image = (row) => ({
    name: row.name,
    url: url(row),
    width: row.width,
    height: row.height,
    pivot: row.pivot || [0.5, 0.5],
  });
  const scenery = { far: {}, near: {}, filter: {} };
  for (const row of media.sprites) {
    const match = row.source.file.match(
      /\/(map_(far|near|filter)(?:_map_\d+(?:_\d+)?|_common|_world)?)_assets_all/,
    );
    if (!match) continue;
    (scenery[match[2]][match[1]] ??= []).push(image(row));
  }
  for (const groups of Object.values(scenery))
    for (const images of Object.values(groups)) images.sort((a, b) => a.name.localeCompare(b.name));
  const maps = {},
    tilemaps = new Map(),
    missing = new Set();
  const actorMaterials = {},
    actorShaderTypes = {};
  for (const entry of raw.files.filter((e) => e.bundleOutput && /\/mo_/.test(e.file)))
    for (const asset of await read(path.join(out, entry.bundleOutput))) {
      if (!asset.source.assetPath?.toLowerCase().endsWith("/anim_info.json")) continue;
      const shaderType = Number(asset.data.shader_type || 0),
        name = path.basename(entry.file).split("_assets_all_")[0];
      actorShaderTypes[shaderType] = (actorShaderTypes[shaderType] || 0) + 1;
      if (shaderType !== 0)
        actorMaterials[name] = {
          shaderType,
          blendMode: shaderType === 1 ? "add" : "normal",
          source: asset.source,
        };
    }
  for (const entry of raw.files.filter((e) => e.bundleOutput && /\/map_\d+_assets/.test(e.file)))
    for (const asset of await read(path.join(out, entry.bundleOutput)))
      if (asset.data.type === "map" && asset.data.layers)
        tilemaps.set(asset.source.assetPath.toLowerCase(), asset.data);
  const mediaImage = (name, group = "") => {
    if (!name) return null;
    name = path.posix.basename(name || "").replace(/\.png$/i, "");
    const match = [...media.sprites, ...media.textures].find(
      (row) =>
        row.url && row.name === name && (!group || row.source.file.includes(`/${group}_assets`)),
    );
    if (!match) {
      missing.add(`${group}/${name}`);
      return null;
    }
    return image(match);
  };
  for (const row of tables["map.csv"]) {
    const name = row.map_name.toLowerCase();
    const tilemap = [...tilemaps].find(([file]) => file.endsWith(`/${name}/tilemap.json`))?.[1];
    if (!tilemap) continue;
    const value = { far: [], near: [], filter: [], tileLayers: [] };
    const walk = (layers, inherited = {}) => {
      for (const layer of layers || []) {
        const p = Object.fromEntries((layer.properties || []).map((p) => [p.name, p.value]));
        const context = {
          x: (inherited.x || 0) + (layer.offsetx || 0) + (layer.x || 0),
          y: (inherited.y || 0) + (layer.offsety || 0) + (layer.y || 0),
          opacity: (inherited.opacity ?? 1) * (layer.opacity ?? 1),
          visible: inherited.visible !== false && layer.visible !== false,
        };
        if (p.backdrop) value.backdrop = p.backdrop;
        if (p.body_threshold != null) value.bodyThreshold = Number(p.body_threshold);
        if (layer.type === "imagelayer") {
          const kind = /near/i.test(layer.name)
            ? "near"
            : /filter/i.test(layer.name)
              ? "filter"
              : "far";
          const sourceImage = mediaImage(layer.image, p.tex_asset_group);
          if (sourceImage)
            value[kind].push({
              name: layer.name,
              image: sourceImage,
              mask: p.mask_asset ? mediaImage(p.mask_asset, p.mask_asset_group) : null,
              ...context,
              properties: p,
              textures: String(p.textures || "")
                .split(",")
                .filter(Boolean)
                .map((name) => mediaImage(name, p.tex_asset_group))
                .filter(Boolean),
            });
        }
        if (layer.type === "tilelayer") value.tileLayers.push({ name: layer.name, properties: p });
        walk(layer.layers, context);
      }
    };
    walk(tilemap.layers);
    if (
      value.far.length ||
      value.near.length ||
      value.filter.length ||
      value.backdrop ||
      value.bodyThreshold != null
    )
      maps[row.id] = value;
  }
  const gps = {};
  for (const row of tables["gps.csv"] || []) {
    const find = (name) =>
      media.sprites.find(
        (s) => s.name === name && s.source.file.includes(`/${row.asset_name}_assets`),
      );
    const screen = find(row.gps_screen),
      overlay = find(row.gps_overlay);
    const group = tables["gps_point_group.csv"].find((g) => g.id === row.gps_point_group_id);
    gps[row.id] = {
      mapId: Number(row.map_id),
      width: Number(row.width),
      height: Number(row.height),
      screen: screen ? image(screen) : null,
      overlay: overlay ? image(overlay) : null,
      points: (tables["gps_point.csv"] || [])
        .filter(
          (p) =>
            Number(p.id) >= Number(group.base_id) &&
            Number(p.id) < Number(group.base_id) + Number(group.point_max),
        )
        .map((p) => ({
          id: Number(p.id),
          x: Number(p.pos_x),
          y: Number(p.pos_y),
          flag: Number(p.map_flag),
          visible: Number(p.display_flag) !== 0,
        })),
    };
  }
  const ocean = {};
  for (const row of media.sprites.filter((s) => s.source.file.includes("/map_far_world_assets")))
    ocean[row.name] = image(row);
  const sky = {};
  for (const row of media.textures.filter(
    (s) => s.source.file.includes("/world_skybox_assets") && s.url,
  ))
    sky[row.name] = image(row);
  const worldAsset = raw.files.find(
    (file) => file.file.includes("/map_world_assets") && file.objectsOutput,
  );
  const worldObjects = worldAsset
    ? await read(path.join(out, worldAsset.objectsOutput))
    : { objects: [] };
  const cameras = worldObjects.objects
    .filter((o) => o.type === "Camera")
    .map((o) => ({
      fov: o.data["field of view"],
      near: o.data["near clip plane"],
      far: o.data["far clip plane"],
      orthographic: o.data.orthographic,
      background: o.data.m_BackGroundColor,
    }));
  const result = {
    version: 1,
    maps,
    scenery,
    gps,
    ocean,
    sky,
    cameras,
    actorMaterials,
    summary: {
      farBundles: raw.files.filter((f) => /\/map_far.*\.bundle$/.test(f.file)).length,
      nearBundles: raw.files.filter((f) => /\/map_near.*\.bundle$/.test(f.file)).length,
      filterBundles: raw.files.filter((f) => /\/map_filter.*\.bundle$/.test(f.file)).length,
      boundMaps: Object.keys(maps).length,
      gpsVariants: Object.keys(gps).length,
      actorShaderTypes,
    },
    warnings: [
      "Scenery images, order, active flags, offsets, scroll ratios/speeds, texture groups, water colors and shader names come from PR Tiled imagelayers. Nine-slice edge stretching, native clipping and background-selector crossfade duration (0.7s) are presentation approximations.",
      "World flight reprojects the live tile/actor plane with the PR bird-view FOV and sky texture. Camera altitude/pitch/bank and skybox cylinder geometry are approximated; field movement and terrain remain unchanged.",
      "GPS uses the PR gps.csv variant, original 800px screen/overlay and 256-tile coordinates; compact placement and blinking player marker are adapted for the web viewport.",
      "Field anim_info shader_type=1 is interpreted as additive blending for the three opaque-black-backed waterfall/effect assets. The enum-to-material binding is inferred from source pixels and usage; shader_type0 keeps normal alpha blending and unknown types emit diagnostics.",
    ],
  };
  if (missing.size)
    result.warnings.push(
      `Unresolved scenery texture references: ${[...missing].sort().join(", ")}`,
    );
  await writeFile(path.join(out, "field-presentation.json"), JSON.stringify(result) + "\n");
  console.log("Field presentation", result.summary);
  return result.summary;
}

if (process.argv[1] === import.meta.filename)
  await compileFieldPresentation(path.resolve(process.argv[2] || "build/web-data"));
