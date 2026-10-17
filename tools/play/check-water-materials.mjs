import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { waterLayerMaterial } from "../export/maps.mjs";

const root = path.resolve(import.meta.dirname, "../.."),
  read = async (file) => JSON.parse(await readFile(file, "utf8"));
const properties = (layer) =>
  Object.fromEntries((layer.properties || []).map(({ name, value }) => [name, value]));
const stable = (object) =>
  JSON.stringify(Object.entries(object || {}).sort(([a], [b]) => a.localeCompare(b)));

/** All source WaterGroup declarations, independent of which maps a story run visited. */
export async function inspectWaterMaterials({
  dataRoot = path.join(root, "build/web-data"),
  update = false,
} = {}) {
  const [tables, index, media] = await Promise.all(
    ["raw/tables.json", "raw/index.json", "raw/media.json"].map((file) =>
      read(path.join(dataRoot, file)),
    ),
  );
  const sourceLayers = [],
    groups = new Set(),
    sourceMaps = new Set(),
    sourcePlaneProperties = new Map(),
    controlsManifest = await read(path.join(dataRoot, "raw/water-controls.json")).catch(() => null);
  function walk(data, source, inherited = {}) {
    for (const layer of data.layers || []) {
      const context = {
        group: layer.type === "group" ? layer.name : inherited.group,
        properties: { ...(inherited.properties || {}), ...properties(layer) },
        visible: inherited.visible !== false && layer.visible !== false,
      };
      if (layer.type === "group" && layer.name === "WaterGroup") groups.add(source.assetPath);
      if (layer.type === "tilelayer")
        sourcePlaneProperties.set(source.assetPath + "::" + layer.name, properties(layer));
      if (context.group === "WaterGroup" && layer.type === "tilelayer")
        sourceLayers.push({ source, layer, context });
      if (layer.layers) walk(layer, source, context);
    }
  }
  for (const file of index.files.filter(
    (file) => file.bundleOutput && /\/map_\d+_/.test(file.file),
  )) {
    for (const asset of await read(path.join(dataRoot, file.bundleOutput)))
      if (asset.source.assetPath.endsWith("/tilemap.json")) walk(asset.data, asset.source);
  }
  const issues = [],
    layers = [],
    updated = [],
    warnings = [];
  for (const source of sourceLayers) {
    const mapName = source.source.assetPath.split("/").at(-2);
    for (const row of tables["map.csv"].filter(
      (row) => row.map_name.trim().toLowerCase() === mapName.toLowerCase(),
    )) {
      const file = path.join(dataRoot, `maps/${Number(row.id)}.json`),
        map = await read(file),
        layer = map.layers.find(
          (layer) => layer.sourceGroup === "WaterGroup" && layer.name === source.layer.name,
        ),
        entry = {
          mapId: Number(row.id),
          mapName,
          layer: source.layer.name,
          source: source.source.assetPath,
          controllerCells: source.layer.data.filter(Boolean).length,
        };
      sourceMaps.add(Number(row.id));
      if (!layer) {
        issues.push({ ...entry, category: "water-layer-missing" });
        continue;
      }
      if (JSON.stringify(layer.data) !== JSON.stringify(source.layer.data))
        issues.push({ ...entry, category: "controller-gids-differ-from-source" });
      if (update) {
        const material = {
          ...layer.waterMaterial,
          ...waterLayerMaterial(
            source.layer,
            source.context,
            media,
            source.source.assetPath,
            (reason) => warnings.push(reason),
          ),
        };
        if (
          JSON.stringify(layer.waterMaterial) !== JSON.stringify(material) ||
          layer.visible !== source.context.visible
        ) {
          layer.waterMaterial = material;
          layer.visible = source.context.visible;
          await writeFile(file, JSON.stringify(map) + "\n");
          updated.push({ mapId: Number(row.id), layer: layer.name });
        }
      }
      const material = layer.waterMaterial;
      if (!material) issues.push({ ...entry, category: "water-material-metadata-missing" });
      else {
        if (stable(material.properties) !== stable(source.context.properties))
          issues.push({ ...entry, category: "water-properties-differ-from-source" });
        for (const key of ["noise", "normalSmall", "normalLarge", "pattern"]) {
          const image = material.textures?.[key];
          if (!image?.url) {
            issues.push({ ...entry, category: "water-material-texture-missing", key });
            continue;
          }
          const file = path.resolve(dataRoot, image.url.replace(/^\/web-data\//, ""));
          if (!file.startsWith(path.resolve(dataRoot) + path.sep)) {
            issues.push({ ...entry, category: "water-texture-outside-data", key });
            continue;
          }
          const bytes = await readFile(file).catch(() => null);
          if (
            !bytes ||
            bytes.length < 24 ||
            !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
            bytes.readUInt32BE(16) !== image.width ||
            bytes.readUInt32BE(20) !== image.height
          )
            issues.push({ ...entry, category: "water-texture-file-invalid", key, url: image.url });
        }
      }
      const palettes = [];
      for (const set of map.tilesets) {
        const paletteURL = map.textures[set.image.replace(/\.png$/i, "_pal_anim.png")];
        if (
          !paletteURL ||
          !layer.data.some(
            (gid) =>
              ((gid >>> 0) & 0x0fffffff) >= set.firstgid &&
              !map.tilesets.some(
                (other) =>
                  other.firstgid > set.firstgid && other.firstgid <= ((gid >>> 0) & 0x0fffffff),
              ),
          )
        )
          continue;
        const control = material?.controlTextures?.[set.image],
          palette = material?.palette,
          manifest = controlsManifest?.images.find(
            (item) => item.sourceURL === map.textures[set.image] && item.paletteURL === paletteURL,
          );
        if (!control || !palette || !manifest)
          issues.push({ ...entry, category: "water-palette-control-missing", image: set.image });
        else {
          if (
            control.url !== manifest.url ||
            control.sourceURL !== map.textures[set.image] ||
            palette.url !== paletteURL ||
            palette.colors !== manifest.colors ||
            palette.frameCount !== manifest.frameCount
          )
            issues.push({ ...entry, category: "water-palette-source-mismatch", image: set.image });
          const expectedSpeed =
            sourcePlaneProperties.get(
              source.source.assetPath + "::" + source.layer.name.replace("Water", "Layer"),
            )?.pal_anim_speed ?? 1;
          if (palette.speed !== expectedSpeed)
            issues.push({
              ...entry,
              category: "water-palette-speed-mismatch",
              expectedSpeed,
              actual: palette.speed,
            });
          for (const image of [control, palette]) {
            const bytes = await readFile(
              path.join(dataRoot, image.url.replace(/^\/web-data\//, "")),
            ).catch(() => null);
            if (
              !bytes ||
              bytes.length < 24 ||
              bytes.readUInt32BE(16) !== image.width ||
              bytes.readUInt32BE(20) !== image.height
            )
              issues.push({ ...entry, category: "water-palette-image-invalid", url: image.url });
          }
          palettes.push({
            image: set.image,
            url: paletteURL,
            control: control.url,
            colors: palette.colors,
            frameCount: palette.frameCount,
            speed: palette.speed,
            alphaZeroMarkers: manifest.alphaZeroMarkers,
          });
        }
      }
      const plane = map.layers.find(
          (layer) => layer.name === source.layer.name.replace("Water", "Layer"),
        ),
        controls = new Set(),
        floors = new Set();
      let withFloor = 0,
        withoutSamePlaneFloor = 0;
      for (let index = 0; index < layer.data.length; index++)
        if (layer.data[index]) {
          controls.add((layer.data[index] >>> 0) & 0x0fffffff);
          const gid = ((plane?.data?.[index] || 0) >>> 0) & 0x0fffffff;
          if (gid) {
            floors.add(gid);
            withFloor++;
          } else withoutSamePlaneFloor++;
        }
      const references = [];
      for (const [kind, gids] of [
        ["controller", controls],
        ["floor", floors],
      ])
        for (const gid of gids) {
          const set = [...map.tilesets].reverse().find((set) => set.firstgid <= gid),
            url = map.textures[set?.image];
          if (!url) {
            issues.push({ ...entry, category: "water-tile-source-reference-missing", kind, gid });
            continue;
          }
          if (
            !(await stat(path.join(dataRoot, url.replace(/^\/web-data\//, ""))).catch(() => null))
          )
            issues.push({ ...entry, category: "water-tile-source-file-missing", kind, gid, url });
          references.push({ kind, gid, url });
        }
      layers.push({
        ...entry,
        properties: material?.properties || null,
        textures: material?.textures || null,
        palettes,
        withFloor,
        withoutSamePlaneFloor,
        references,
      });
    }
  }
  return {
    summary: {
      rawWaterGroups: groups.size,
      rawTileLayers: sourceLayers.length,
      runtimeMaps: sourceMaps.size,
      runtimeLayers: layers.length,
      issues: issues.length,
      updated: updated.length,
      paletteLayers: layers.filter((layer) => layer.palettes.length).length,
    },
    issues,
    layers,
    updated,
    warnings: [...new Set(warnings)],
    limitations: [
      "This checks complete source declarations, metadata and PNG availability, not original-game pixel equivalence.",
      "Some controllers have no same-plane floor GID; compositing then samples the already rendered lower planes. This alone is not a missing-asset finding.",
    ],
  };
}
if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const args = process.argv.slice(2),
    option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
  const report = await inspectWaterMaterials({
      dataRoot: option("--data", path.join(root, "build/web-data")),
      update: args.includes("--update"),
    }),
    target = option(
      "--report",
      path.join(root, "build/play/acceptance/step-4/water/material-audit.json"),
    );
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ report: target, ...report.summary }));
  if (report.issues.length) process.exitCode = 1;
}
