import { readFile, writeFile, stat, rename } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const read = async (file) => JSON.parse(await readFile(file, "utf8"));
const id = (source) => `${source.serializedFile}:${source.pathId}`;
const rgba = (c) => [c.r, c.g, c.b, c.a];

function category(file) {
  const name = path.basename(file);
  if (name.startsWith("ef_")) return "battle-particles";
  if (/opera/.test(name)) return "opera";
  if (/world/.test(name)) return "world";
  if (/^bg_/.test(name)) return "battle-background";
  if (/map_/.test(name)) return "field";
  if (/chara/.test(name)) return "characters";
  if (/^(?:key_|touch_|ui_)/.test(name)) return "ui";
  return "scene/common";
}

function adapter(name) {
  if (name === "Last/LastEffectMaster")
    return {
      kind: "particle-material",
      operations: [
        "base/mask/noise UV and scrolling",
        "alpha from base",
        "two-color or texture gradient",
        "mask red×alpha",
        "dissolve edge/cutoff",
        "ramp",
        "emission",
        "color/alpha quantization",
        "polar/pixelate",
      ],
      approximations: [
        "DXBC arithmetic/order is inferred from named source properties",
        "_ScaleWithAilpha geometry scaling is not reproduced; _AEmission uses inferred alpha gain",
        "material cache updates at 15 Hz",
      ],
    };
  if (/FarBgCrossFade/.test(name))
    return {
      kind: "crossfade",
      operations: ["MainTex/MainTex2 RGBA interpolation", "normalized UV offset/scroll", "opacity"],
      approximations: ["PR camera-dependent loop/bottom offsets supplied by presentation context"],
    };
  if (/Foreground/.test(name))
    return {
      kind: /AlphaMask/.test(name) ? "foreground-mask" : "foreground",
      operations: [
        "UV offset/scroll",
        "zero alpha clipping",
        "optional normalized foreground mask/inversion",
      ],
      approximations: [
        "camera depth clipping and automatic perspective offsets are caller responsibilities",
        "manual bilinear option uses native nearest presentation sampling",
      ],
    };
  if (name === "Last/LastBackGround")
    return {
      kind: "final-background",
      operations: ["weighted multiply/add tint", "pixel mosaic"],
      approximations: [
        "_Block interpreted as horizontal cell count; exact DXBC rounding unavailable",
      ],
    };
  if (name === "Unlit/LastMapOverlayEffect")
    return {
      kind: "overlay",
      operations: ["SubTex alpha overlay", "tint and opacity"],
      approximations: ["exact original two-texture operation inferred"],
    };
  if (/FilterColor/.test(name))
    return {
      kind: "color-gradient",
      operations: ["vertical top/bottom tint gradient"],
      approximations: ["gradient position/amount/range interpreted from serialized controls"],
    };
  if (/FilterScreen/.test(name))
    return {
      kind: "screen",
      operations: [
        "scroll",
        "wave/raster UV",
        "sepia",
        "saturation",
        "brightness",
        "vignette",
        "four-tap blur",
      ],
      approximations: [
        "normal-map distortion, destination-cell geometry and magnetic effect are not reproduced",
      ],
    };
  if (/LastSpriteMaster/.test(name))
    return {
      kind: "sprite",
      operations: ["tint/add tint", "negative", "mosaic"],
      approximations: [
        "sprite UV scroll/dissolve, skin/palette overrides, hollow color matching and multi-sprite raster are not reproduced",
      ],
    };
  if (/LastDamageFont/.test(name))
    return { kind: "tint", operations: ["RGBA tint/opacity"], approximations: [] };
  if (/Ocean|Water|Warter|river/.test(name))
    return {
      kind: "water",
      operations: ["source texture/noise displacement", "scroll and wave", "base/add tint"],
      approximations: [
        "caustics, sun reflection, fresh/ocean mixing, waterfall and controller-channel compositing are not reproduced",
      ],
    };
  return {
    kind: "tile",
    operations: ["RGBA tint/opacity"],
    approximations: [
      "palette animation lookup, stencil and material-color mixing need dedicated map adapters",
    ],
  };
}

export async function compileShaders(out, { game = null } = {}) {
  out = path.resolve(out);
  game ||= (await read(path.join(out, ".cache/unity-export.json"))).game;
  const python = process.env.PYTHON || path.join(root, ".venv/bin/python");
  const source = spawnSync(
    python,
    [
      path.join(import.meta.dirname, "shader_metadata.py"),
      "--game",
      game,
      "--index",
      path.join(out, "raw/index.json"),
    ],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  if (source.status !== 0) throw Error(`PR shader metadata extraction failed: ${source.stderr}`);
  const extracted = JSON.parse(source.stdout),
    definitions = extracted.shaders;
  const shaders = Object.fromEntries(
    definitions.map((row) => [
      row.name,
      { ...row, adapter: adapter(row.name), usage: { materials: 0, categories: {}, examples: [] } },
    ]),
  );
  const byPointer = new Map(definitions.map((row) => [id(row.source), row.name]));
  for (const [key, name] of Object.entries(extracted.aliases))
    if (shaders[name]) byPointer.set(key, name);
  const [index, media, tables] = await Promise.all([
    read(path.join(out, "raw/index.json")),
    read(path.join(out, "raw/media.json")),
    read(path.join(out, "raw/tables.json")),
  ]);
  const mediaByPointer = new Map(
    [...media.textures, ...media.sprites].map((row) => [id(row.source), row]),
  );
  const materials = {},
    materialsByName = {},
    warnings = [...extracted.warnings];
  for (const file of index.files.filter((row) => row.objectsOutput && row.counts.Material)) {
    const objects = await read(path.join(out, file.objectsOutput));
    for (const row of objects.objects.filter((row) => row.type === "Material")) {
      function pointer(ref) {
        if (!ref?.m_PathID || ref.m_PathID === "0") return null;
        const external = ref.m_FileID
          ? objects.externalFiles[row.source.serializedFile]?.find(
              (item) => item.fileId === ref.m_FileID,
            )
          : null;
        const file = ref.m_FileID
          ? external && path.posix.basename(external.path)
          : row.source.serializedFile;
        return file && `${file}:${ref.m_PathID}`;
      }
      const shader = byPointer.get(pointer(row.data.m_Shader));
      if (!shader) continue;
      const p = row.data.m_SavedProperties || {},
        textures = {};
      for (const [name, texture] of p.m_TexEnvs || []) {
        const image = mediaByPointer.get(pointer(texture.m_Texture)),
          url = image?.displayUrl || image?.url;
        if (url)
          textures[name] = {
            url: `/web-data/${url}`,
            width: image.width,
            height: image.height,
            scale: [texture.m_Scale.x, texture.m_Scale.y],
            offset: [texture.m_Offset.x, texture.m_Offset.y],
          };
      }
      const key = id(row.source),
        kind = category(file.file);
      materials[key] = {
        name: row.name,
        shader,
        textures,
        floats: Object.fromEntries(p.m_Floats || []),
        colors: Object.fromEntries((p.m_Colors || []).map(([name, color]) => [name, rgba(color)])),
        keywords: row.data.m_ShaderKeywords || "",
        source: row.source,
      };
      (materialsByName[row.name] ||= []).push(key);
      const usage = shaders[shader].usage;
      usage.materials++;
      usage.categories[kind] = (usage.categories[kind] || 0) + 1;
      if (usage.examples.length < 8)
        usage.examples.push({ material: key, name: row.name, source: file.file });
    }
  }
  for (const row of definitions)
    if (!shaders[row.name].usage.materials)
      warnings.push(
        `${row.name}: no serialized Material using this shader was found in current extracted metadata; the declaration alone is not an implemented scene.`,
      );
  const mapLayers = {};
  for (const file of index.files.filter(
    (row) => /\/map_\d+_assets_/.test(row.file) && row.bundleOutput,
  )) {
    for (const asset of await read(path.join(out, file.bundleOutput))) {
      if (!asset.source.assetPath?.endsWith("/tilemap.json") || !asset.data.layers) continue;
      const name = path.posix.basename(path.posix.dirname(asset.source.assetPath)).toLowerCase();
      const maps = tables["map.csv"].filter(
        (row) =>
          row.map_name.trim().toLowerCase() === name ||
          row.asset_name.trim().toLowerCase() === name,
      );
      if (!maps.length) continue;
      function scan(layers) {
        for (const layer of layers) {
          const properties = Object.fromEntries(
            (layer.properties || []).map((row) => [row.name, row.value]),
          );
          const names = [properties.opaque_shader, properties.transparent_shader].filter(Boolean);
          if (names.length) {
            const resolved = names
              .map((name) =>
                Object.keys(shaders).find((key) => key === name || key.endsWith("/" + name)),
              )
              .filter(Boolean);
            for (const name of resolved) {
              const usage = shaders[name].usage;
              usage.layers = (usage.layers || 0) + maps.length;
            }
            for (const map of maps)
              (mapLayers[map.id.trim()] ||= []).push({
                name: layer.name,
                id: layer.id,
                image: layer.image,
                properties,
                shaders: resolved,
                source: asset.source.assetPath,
              });
          }
          if (layer.layers) scan(layer.layers);
        }
      }
      scan(asset.data.layers);
    }
  }
  warnings.push(
    "Original shader programs are D3D11 DXBC. WebGL operations follow actual properties/pass states with the per-adapter approximations listed; GPU pixel parity is not claimed.",
  );
  const result = {
    version: 1,
    shaders,
    materials,
    materialsByName,
    mapLayers,
    warnings,
    summary: {
      projectShaders: definitions.length,
      materials: Object.keys(materials).length,
      byAdapter: Object.values(shaders).reduce(
        (counts, row) => ((counts[row.adapter.kind] = (counts[row.adapter.kind] || 0) + 1), counts),
        {},
      ),
    },
  };
  await writeFile(path.join(out, "shaders.json.tmp"), JSON.stringify(result) + "\n");
  await rename(path.join(out, "shaders.json.tmp"), path.join(out, "shaders.json"));
  console.log(
    JSON.stringify({ ...result.summary, bytes: (await stat(path.join(out, "shaders.json"))).size }),
  );
  return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const args = process.argv.slice(2),
    at = args.indexOf("--data");
  await compileShaders(at >= 0 ? args[at + 1] : "build/web-data");
}
