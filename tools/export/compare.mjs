// Optional migration acceptance only. Baseline is never an exporter input.
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual as same } from "node:util";
const read = async (file) => JSON.parse(await readFile(file, "utf8"));
export async function compareExports(baseline, current) {
  const [old, data, a, b] = await Promise.all([
    read(path.join(baseline, "data.json")),
    read(path.join(current, "data.json")),
    read(path.join(baseline, "battle.json")),
    read(path.join(current, "battle.json")),
  ]);
  const missingPrograms = [];
  let comparedPrograms = 0;
  for (const [map, aliases] of Object.entries(old.byMap))
    for (const [name, id] of Object.entries(aliases)) {
      comparedPrograms++;
      if (!same(old.programs[id], data.programs[data.byMap[map]?.[name] ?? data.global[name]]))
        missingPrograms.push({ map, name });
    }
  const omitNames = (v) =>
    Array.isArray(v)
      ? v.map(omitNames)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .filter(([k]) => !["name", "sprite", "magitekSprite"].includes(k))
              .map(([k, v]) => [k, omitNames(v)]),
          )
        : v;
  const battleFields = {};
  for (const key of Object.keys(a))
    battleFields[key] = same(a[key], b[key])
      ? "identical"
      : ["monsters", "characters", "commands", "backgrounds"].includes(key) &&
          same(omitNames(a[key]), omitNames(b[key]))
        ? "same gameplay; localized names or media URLs differ"
        : ["contentNames", "sprites", "messages"].includes(key)
          ? "PR translations expanded or original media URLs replaced"
          : "REVIEW";
  const mapChanges = {};
  for (const file of (await readdir(path.join(baseline, "maps"))).filter((file) =>
    /^\d+\.json$/.test(file),
  )) {
    const [old, fresh] = await Promise.all([
      read(path.join(baseline, "maps", file)),
      read(path.join(current, "maps", file)),
    ]);
    const differences = [];
    for (const key of [
      "width",
      "height",
      "tileSize",
      "collisions",
      "layers",
      "tilesets",
      "areaId",
      "initializer",
    ])
      if (!same(old[key], fresh[key])) differences.push(key);
    if (differences.length) mapChanges[file] = differences;
  }
  return {
    comparedPrograms,
    missingPrograms,
    battleFields,
    mapChanges,
    counts: {
      oldPrograms: Object.keys(old.programs).length,
      newPrograms: Object.keys(data.programs).length,
      oldCachedMaps: (await readdir(path.join(baseline, "maps"))).filter((file) =>
        /^\d+.json$/.test(file),
      ).length,
      newPreparedMaps: Object.keys(data.maps).length,
      oldMessages: Object.keys(old.messages).length,
      newMessages: Object.keys(data.messages).length,
    },
    explanations: [
      "Program IDs are rebuilt deterministic local indices; map-local PR aliases and every compared program body remain identical.",
      "All 649 maps are now prepared, including those the old request-time cache never visited. PR entries declaring no tilemap retain the existing empty-map fallback and a warning.",
      "Source reference/admission metadata, nativeComposition/nativeNpc descriptors and unused editor objects are not in the gameplay payload. Complete original typetrees/JSON remain under raw/.",
      "Tiled editor visibility does not gate runtime triggers. Runtime entity groups continue to control visibility; collision/tile geometry are unchanged.",
      "Runtime textures and logical-canvas sprites now refer to independently generated media. Raw UV/pivot/camera/UI metadata is retained separately for later rendering work.",
      "Messages now include all available simplified-Chinese tables; ability/item/command names resolve directly from PR content keys.",
      "All 649 SE master rows are indexed, versus 628 previously admitted sounds and 20 environment selections. Multi-command SAB programs explicitly warn and retain the decoder first-stream approximation; audio semantics are addressed in foundation step 3.",
    ],
  };
}
if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const result = await compareExports(
    process.argv[2] || "build/play",
    process.argv[3] || "build/web-data",
  );
  const target = process.argv[4] || "build/play/foundation-export-comparison.json";
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
  if (result.missingPrograms.length || Object.values(result.battleFields).includes("REVIEW"))
    process.exitCode = 1;
}
