import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { packageBinding, compileMap } from "./maps.mjs";
import { compileBattle } from "./battle.mjs";
import { compileNavigation } from "./navigation.mjs";

const read = async (file) => JSON.parse(await readFile(file, "utf8"));
const identity = (asset) => `${asset.source.file}::${asset.source.assetPath}`.toLowerCase();
async function write(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const text = JSON.stringify(value) + "\n";
  if ((await readFile(file, "utf8").catch(() => null)) !== text) await writeFile(file, text);
}

export async function compileRuntime(out) {
  const [rawTables, text, media, audio, nativeStones, colosseum] = await Promise.all(
    [
      "raw/tables.json",
      "raw/messages.json",
      "raw/media.json",
      "audio.json",
      "raw/magic-stones.json",
      "raw/colosseum.json",
    ].map((file) => read(path.join(out, file))),
  );
  const tables = Object.fromEntries(
    Object.entries(rawTables).map(([name, rows]) => [
      name,
      rows.map((row) =>
        Object.fromEntries(
          Object.entries(row).map(([key, value]) => [
            key.trim(),
            typeof value === "string" ? value.trim() : value,
          ]),
        ),
      ),
    ]),
  );
  const extraction = await read(path.join(out, "raw/index.json"));
  const sourceHashes = Object.fromEntries(extraction.files.map((file) => [file.file, file.sha256]));
  const files = extraction.files
    .map((file) => file.bundleOutput)
    .filter(Boolean)
    .map((file) => path.basename(file))
    .sort();
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  const previous = await read(path.join(out, ".cache/runtime.json")).catch(() => ({ maps: {} }));
  const tools = await Promise.all(
    ["maps.mjs", "runtime.mjs"].map((file) =>
      readFile(path.join(import.meta.dirname, file), "utf8"),
    ),
  );
  const mapCommonHash = hash(JSON.stringify([tools, tables, text]));
  const cache = { maps: {} };
  const bundles = await Promise.all(files.map((file) => read(path.join(out, "raw/bundles", file))));
  const assets = bundles.flat(),
    assetIndex = new Map(assets.map((asset) => [identity(asset), asset]));
  const packages = assets.filter(
    (asset) => asset.source.assetPath?.endsWith("/package.json") && Array.isArray(asset.data.map),
  );
  const messages = Object.assign(
    {},
    ...Object.entries(text)
      .filter(([key]) => key.endsWith("_zhc"))
      .map(([, table]) => table.values),
    text.story_mes_zhc?.values || {},
  );
  const programs = {},
    global = {},
    byMap = {},
    programIds = new Map(),
    mnemonics = new Set();
  for (const asset of assets
    .filter((asset) => Array.isArray(asset.data.Mnemonics))
    .sort((a, b) => identity(a).localeCompare(identity(b)))) {
    const raw = asset.data,
      name = path.posix.basename(asset.source.assetPath, ".json"),
      id = String(Object.keys(programs).length);
    programs[id] = {
      name,
      title: raw.Title?.main || "",
      locals: raw.ScriptLocalValue || [],
      segments: raw.Segments || [],
      ops: raw.Mnemonics.map((op) => {
        mnemonics.add(op.mnemonic);
        return [
          op.mnemonic,
          op.operands?.iValues || [],
          op.operands?.rValues || [],
          op.operands?.sValues || [],
          op.type || 1,
          op.label || "",
        ];
      }),
    };
    global[name] ??= id;
    programIds.set(identity(asset), id);
  }
  const residentPackage = packages.find((pack) => pack.data.asset_group_name === "map_script");
  const residentMap = residentPackage?.data.map.find((map) => map.name === "Resident");
  const aliases = (binding, list) =>
    Object.fromEntries(
      (list || [])
        .map((row) => [
          row.name,
          programIds.get(
            identity(binding.assetAt(row.asset) || { source: { file: "", assetPath: "" } }),
          ),
        ])
        .filter(([, id]) => id !== undefined),
    );
  const resident = residentPackage
    ? aliases(
        packageBinding(
          { id: "resident", asset_name: "map_script", map_name: "Resident" },
          packages,
          assetIndex,
        ),
        residentMap.script,
      )
    : {};
  const sourceMaps = [];
  for (const row of tables["map.csv"] || []) {
    const binding = packageBinding(row, packages, assetIndex);
    binding.bundleAssets = assetIndex;
    byMap[row.id] = { ...resident, ...aliases(binding, binding.declaration.script) };
    const cacheKey = hash(
      JSON.stringify([mapCommonHash, sourceHashes[binding.pack.source.file], byMap[row.id]]),
    );
    const mapFile = path.join(out, `maps/${row.id}.json`);
    const map =
      previous.maps[row.id] === cacheKey
        ? (await read(mapFile).catch(() => null)) ||
          compileMap(row, binding, tables, media, messages)
        : compileMap(row, binding, tables, media, messages);
    cache.maps[row.id] = cacheKey;
    // Cached maps may have been normalized before the current global registry
    // existed. Re-read the declared name and use the VM's local/global lookup.
    const initializer = tables["map_script.csv"]?.find(
      (script) => String(script.id) === String(row.script_id),
    )?.script_name;
    map.initializer =
      initializer &&
      (Object.hasOwn(byMap[row.id], initializer) || Object.hasOwn(global, initializer))
        ? initializer
        : null;
    sourceMaps.push(map);
    await write(path.join(out, `maps/${map.id}.json`), map);
  }
  const characters = {};
  for (const asset of assets.filter(
    (asset) =>
      asset.source.assetPath?.toLowerCase().endsWith("/anim_info.json") &&
      Array.isArray(asset.data.animation),
  )) {
    const key = path.basename(asset.source.file).split("_assets_all_")[0];
    const wanted = new Set(
      asset.data.animation
        .flatMap((animation) => animation.frames || [])
        .map((frame) => frame.sprite_name),
    );
    const sprites = Object.fromEntries(
      media.sprites
        .filter((sprite) => sprite.source.file === asset.source.file && wanted.has(sprite.name))
        .map((sprite) => [
          sprite.name,
          {
            file: "/web-data/" + sprite.url,
            width: sprite.width,
            height: sprite.height,
            pivot: sprite.pivot,
          },
        ]),
    );
    characters[key] = { animation: { data: asset.data }, sprites };
  }
  const data = {
    systemTables: Object.fromEntries(
      [
        "product",
        "content",
        "function_group",
        "character_status",
        "job",
        "learning",
        "transportation",
        "transportation_group",
        "landing_group",
        "product_group",
      ].map((name) => [
        name.replace(/_([a-z])/g, (_, c) => c.toUpperCase()),
        tables[name + ".csv"] || [],
      ]),
    ),
    entry: { mapId: 609, entrance: 1, script: "sc_e_0001" },
    programs,
    byMap,
    global,
    messages,
    speakers: text.story_cha_zhc?.values || {},
    characters,
    maps: Object.fromEntries(sourceMaps.map((map) => [map.id, { name: map.name }])),
    audio,
    init: tables["initialize_data.csv"],
    scriptIds: Object.fromEntries(
      (tables["script.csv"] || []).map((row) => [row.id, row.script_name]),
    ),
    fieldAssets: Object.fromEntries(
      (tables["field_character_asset.csv"] || []).map((row) => [row.id, row]),
    ),
    mapTitles: Object.fromEntries((tables["map.csv"] || []).map((row) => [row.id, row.map_title])),
    mnemonics: [...mnemonics].sort(),
  };
  const battle = compileBattle(tables, assets, media, data, nativeStones);
  battle.colosseum = colosseum;
  const navigation = compileNavigation(sourceMaps, data);
  await write(path.join(out, "data.json"), data);
  await write(path.join(out, "battle.json"), battle);
  await write(path.join(out, "navigation.json"), navigation);
  await write(path.join(out, ".cache/runtime.json"), cache);
  return {
    maps: sourceMaps.length,
    programs: Object.keys(programs).length,
    monsters: Object.keys(battle.monsters).length,
    formations: Object.keys(battle.parties).length,
    characters: Object.keys(characters).length,
    messages: Object.keys(messages).length,
  };
}
