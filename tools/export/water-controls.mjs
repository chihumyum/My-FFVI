import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const project = path.resolve(import.meta.dirname, "../.."),
  read = async (file) => JSON.parse(await readFile(file, "utf8")),
  hash = (value) => createHash("sha256").update(value).digest("hex").slice(0, 24),
  properties = (layer) =>
    Object.fromEntries((layer.properties || []).map(({ name, value }) => [name, value]));
async function write(file, value) {
  const bytes = JSON.stringify(value) + "\n";
  if ((await readFile(file, "utf8").catch(() => null)) !== bytes) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);
  }
}

// PR package declarations omit .json, while extracted TextAssets include it.
export function palettePlaneProperties(sources, sourcePath, waterLayerName) {
  const raw = sources.get(sourcePath?.replace(/(?:\.json)?$/, ".json"));
  const visit = (node) => {
    for (const layer of node?.layers || []) {
      if (layer.name === waterLayerName.replace("Water", "Layer")) return layer;
      const found = visit(layer);
      if (found) return found;
    }
  };
  const layer = visit(raw);
  return { layer: layer?.name ?? null, properties: properties(layer || {}) };
}

/** Post-process only PR maps containing water palette inputs, never rebuild map geometry. */
export async function compileWaterControls(
  out,
  { python = path.join(project, ".venv/bin/python") } = {},
) {
  out = path.resolve(out);
  const [tables, extraction] = await Promise.all([
      read(path.join(out, "raw/tables.json")),
      read(path.join(out, "raw/index.json")),
    ]),
    sources = new Map();
  const check = spawnSync(python, ["-c", "import PIL;print(PIL.__version__)"], {
    encoding: "utf8",
  });
  if (check.status !== 0)
    throw Error(`Pillow is required for PR water controls: ${check.stderr || check.error}`);
  for (const item of extraction.files.filter(
    (file) => file.bundleOutput && /\/map_\d+_/.test(file.file),
  ))
    for (const asset of await read(path.join(out, item.bundleOutput)))
      if (asset.source.assetPath.endsWith("/tilemap.json"))
        sources.set(asset.source.assetPath, asset.data);
  const profile = hash(
      Buffer.concat([
        await readFile(import.meta.filename),
        await readFile(path.join(import.meta.dirname, "water-controls.py")),
        Buffer.from(
          check.stdout.trim() +
            ":rgba128-nibble-one-based:cyan-centered-index:palette-column-cycle",
        ),
      ]),
    ),
    maps = new Map(),
    requests = [],
    jobs = new Map();
  function local(url) {
    if (!url.startsWith("/web-data/")) throw Error(`Invalid PR water source URL ${url}`);
    const file = path.resolve(out, url.slice(10));
    if (!file.startsWith(out + path.sep))
      throw Error(`Water source escapes output directory: ${url}`);
    return file;
  }
  for (const row of tables["map.csv"]) {
    const id = Number(row.id),
      map = await read(path.join(out, `maps/${id}.json`));
    for (const layer of map.layers.filter((layer) => layer.sourceGroup === "WaterGroup")) {
      if (layer.waterMaterial?.controlTextures || layer.waterMaterial?.palette) {
        delete layer.waterMaterial.controlTextures;
        delete layer.waterMaterial.palette;
        maps.set(id, map);
      }
      const sourcePlane = palettePlaneProperties(
          sources,
          layer.waterMaterial?.source?.assetPath,
          layer.name,
        ),
        rawProperties = sourcePlane.properties,
        speed = Number(rawProperties.pal_anim_speed ?? 1);
      for (const set of map.tilesets) {
        const paletteName = set.image.replace(/\.png$/i, "_pal_anim.png"),
          paletteURL = map.textures[paletteName];
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
        const sourceURL = map.textures[set.image],
          source = local(sourceURL),
          palette = local(paletteURL),
          key = hash(
            Buffer.concat([Buffer.from(profile), await readFile(source), await readFile(palette)]),
          ),
          url = `/web-data/media/water-controls/${key}.png`;
        jobs.set(key, {
          source,
          palette,
          sourceURL,
          paletteURL,
          url,
          target: local(url),
          metadata: path.join(out, `.cache/water-controls/${key}.json`),
        });
        requests.push({
          mapId: id,
          layer: layer.name,
          image: set.image,
          key,
          speed,
          sourceSpeedLayer: rawProperties.pal_anim_speed != null ? sourcePlane.layer : null,
          tiles: Object.fromEntries(
            [
              ...new Set(
                layer.data
                  .map((gid) => (gid >>> 0) & 0x0fffffff)
                  .filter(
                    (gid) =>
                      gid >= set.firstgid &&
                      !map.tilesets.some(
                        (other) => other.firstgid > set.firstgid && other.firstgid <= gid,
                      ),
                  ),
              ),
            ].map((gid) => [
              gid - set.firstgid,
              layer.data.filter((value) => ((value >>> 0) & 0x0fffffff) === gid).length,
            ]),
          ),
        });
        maps.set(id, map);
      }
    }
  }
  const result = spawnSync(python, [path.join(import.meta.dirname, "water-controls.py")], {
    input: JSON.stringify([...jobs.values()]),
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0)
    throw Error(`PR water palette derivation failed: ${result.stderr || result.error}`);
  const generated = JSON.parse(result.stdout),
    byURL = new Map(generated.map((item) => [item.url, item])),
    layers = [];
  for (const request of requests) {
    const map = maps.get(request.mapId),
      layer = map.layers.find((layer) => layer.name === request.layer),
      image = byURL.get(jobs.get(request.key).url),
      material = layer.waterMaterial;
    material.controlTextures ??= {};
    material.controlTextures[request.image] = {
      url: image.url,
      width: image.size[0],
      height: image.size[1],
      sourceURL: image.sourceURL,
    };
    if (material.palette && material.palette.url !== image.paletteURL)
      throw Error(`Map ${request.mapId} ${layer.name} needs multiple palette samplers`);
    material.palette = {
      url: image.paletteURL,
      width: image.paletteSize[0],
      height: image.paletteSize[1],
      colors: image.colors,
      bankOffset: image.waterBankOffset,
      frameCount: image.frameCount,
      speed: request.speed,
      sourceSpeedLayer: request.sourceSpeedLayer,
    };
    layers.push({
      ...request,
      url: image.url,
      markers: image.markerPixels,
      alphaZeroMarkers: image.alphaZeroMarkers,
      usedMarkerPixels: Object.entries(request.tiles).reduce(
        (sum, [tile, count]) => sum + (image.markerTiles[tile] || 0) * count,
        0,
      ),
    });
  }
  for (const [id, map] of maps) await write(path.join(out, `maps/${id}.json`), map);
  const warnings = [
    "PR nonzero RGBA 0/128 codes are interpreted as little-endian 4-bit, one-based palette row indices; all-zero remains transparent. WaterGroup uses the second 8-color bank: the first bank can be black (map398) or transparent (map114), while the second contains water-control colors. This bank/layout is inferred from source data, not native shader disassembly.",
    "Palette columns are sampled cyclically using the source pal_anim_speed as cycles per second (default shader speed 1 when absent); native shader _Time scaling is not exported.",
  ];
  const manifest = {
    summary: {
      maps: new Set(requests.map((request) => request.mapId)).size,
      layers: layers.length,
      controlImages: generated.length,
      paletteImages: new Set(generated.map((item) => item.paletteURL)).size,
      markerPixels: generated.reduce((n, item) => n + item.markerPixels, 0),
      alphaZeroMarkers: generated.reduce((n, item) => n + item.alphaZeroMarkers, 0),
    },
    images: generated.map(({ cached, ...image }) => image),
    layers,
    warnings,
  };
  await write(path.join(out, "raw/water-controls.json"), manifest);
  console.log(
    JSON.stringify({
      waterControls: manifest.summary,
      cached: generated.filter((item) => item.cached).length,
    }),
  );
  return manifest;
}
if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const at = process.argv.indexOf("--data");
  await compileWaterControls(at < 0 ? path.join(project, "build/web-data") : process.argv[at + 1]);
}
