import { readFile, writeFile, mkdir, copyFile, stat, readdir, unlink } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
const project = path.resolve(import.meta.dirname, "../..");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex").slice(0, 20);
const read = async (file) => JSON.parse(await readFile(file));

export async function prepareWeb({ dataRoot = "build/web-data", out = null } = {}) {
  dataRoot = path.resolve(project, dataRoot);
  out = path.resolve(project, out || path.join(dataRoot, "web"));
  await mkdir(path.join(out, "data"), { recursive: true });
  const data = await read(path.join(dataRoot, "data.json"));
  const battle = await read(path.join(dataRoot, "battle.json"));
  const navigation = await read(path.join(dataRoot, "navigation.json"));
  const files = new Set();
  async function payload(value, label) {
    const bytes = Buffer.from(JSON.stringify(value));
    const file = `data/${label}-${hash(bytes)}.json`;
    try {
      await stat(path.join(out, file));
    } catch {
      await writeFile(path.join(out, file), bytes);
    }
    files.add(file);
    return file;
  }
  const chunks = new Map(),
    programFiles = {};
  for (const [id, program] of Object.entries(data.programs)) {
    const numeric = program.name.match(/^sc_e_(\d{4})/),
      map = program.name.match(/^sc_map_(\d+)/);
    const region = program.name.startsWith("sc_ai_")
      ? "monster-ai"
      : program.name.startsWith("sc_b_")
        ? "battle-events"
        : numeric
          ? `story-${Math.floor(Number(numeric[1]) / 50)}`
          : map
            ? `maps-${Math.floor(Number(map[1]) / 100)}`
            : "common";
    if (!chunks.has(region)) chunks.set(region, {});
    chunks.get(region)[id] = program;
  }
  for (const [region, programs] of chunks) {
    const file = await payload(programs, region);
    for (const id of Object.keys(programs)) programFiles[id] = file;
  }
  const knownNames = new Set(Object.keys(data.global));
  for (const names of Object.values(data.byMap))
    for (const name of Object.keys(names)) knownNames.add(name);
  const collectNames = (value, result = new Set(), key = "") => {
    if (typeof value === "string" && knownNames.has(value)) result.add(value);
    else if (value && typeof value === "object")
      for (const [name, child] of Object.entries(value)) collectNames(child, result, name);
    if (/script/i.test(key) && data.scriptIds[value]) result.add(data.scriptIds[value]);
    return result;
  };
  const universal = collectNames(data.systemTables);
  // Battle AI/events execute from battleData. Its script-name registry is not
  // a field-VM dependency and must not pull the complete story into every map.
  if (data.scriptIds[5000]) universal.add(data.scriptIds[5000]);
  const incoming = new Map();
  for (const p of Object.values(data.programs))
    for (const [op, i, , s] of p.ops)
      if (op === "ChangeMap" && s?.[0]) {
        const id = String(i[0]);
        if (!incoming.has(id)) incoming.set(id, new Set());
        incoming.get(id).add(s[0]);
      }
  const maps = {},
    mapPrograms = {};
  for (const id of Object.keys(data.maps)) {
    const map = await read(path.join(dataRoot, `maps/${id}.json`));
    maps[id] = await payload(map, `map-${id}`);
    const resolve = (name) => data.byMap[id]?.[name] ?? data.global[name];
    const names = collectNames(map, new Set([...universal, ...(incoming.get(id) || [])]));
    if (Number(id) === data.entry.mapId) names.add(data.entry.script);
    const ids = new Set(Object.values(data.byMap[id] || {}).map(String));
    for (const name of names) if (resolve(name) !== undefined) ids.add(String(resolve(name)));
    const queue = [...ids];
    for (let n = 0; n < queue.length; n++) {
      const p = data.programs[queue[n]];
      if (!p) throw Error(`Unknown program ${queue[n]} in map ${id}`);
      for (const [op, , , strings] of p.ops) {
        // Map transitions are async loading boundaries. Their continuations are
        // roots of the destination pack, rather than pulling the entire story.
        if (op === "ChangeMap") continue;
        for (const name of strings || [])
          if (knownNames.has(name)) {
            const target = resolve(name);
            if (target === undefined || ids.has(String(target))) continue;
            ids.add(String(target));
            queue.push(String(target));
          }
      }
    }
    mapPrograms[id] = [...ids];
  }
  const { programs, ...core } = data;
  const index = {
    version: 1,
    core: await payload(core, "core"),
    battle: await payload(battle, "battle"),
    navigation: await payload(navigation, "navigation"),
    maps,
    mapPrograms,
    programFiles,
    assets: { images: {}, audio: {} },
  };
  const atlasRoot = path.resolve(project, "build/web-assets");
  const python = process.env.PYTHON || path.resolve(project, ".venv/bin/python");
  const atlas = spawnSync(
    python,
    [path.resolve(project, "tools/export/atlas.py"), "--data", dataRoot, "--out", atlasRoot],
    { stdio: "inherit" },
  );
  if (atlas.status !== 0) throw Error("Runtime atlas export failed");
  const atlasIndex = await read(path.join(atlasRoot, "atlas-index.json"));
  index.assets.images = atlasIndex.images;
  async function copy(source, file) {
    const dest = path.join(out, file);
    await mkdir(path.dirname(dest), { recursive: true });
    const sourceStat = await stat(source);
    let current;
    try {
      current = await stat(dest);
    } catch {}
    if (current?.size !== sourceStat.size) await copyFile(source, dest, constants.COPYFILE_FICLONE);
    files.add(file);
  }
  for (const file of new Set(Object.values(index.assets.images).map((i) => i.file)))
    await copy(path.join(atlasRoot, file), file);
  const visitAudio = async (value) => {
    if (!value || typeof value !== "object") return;
    if (typeof value.file === "string" && /\.(opus|m4a)$/.test(value.file)) {
      if (!index.assets.audio[value.file]) {
        const source = path.join(dataRoot, value.file.replace(/^\/web-data\//, ""));
        const file = `audio/${hash(await readFile(source))}${path.extname(value.file)}`;
        await copy(source, file);
        index.assets.audio[value.file] = file;
      }
    }
    for (const child of Object.values(value))
      if (child && typeof child === "object") await visitAudio(child);
  };
  await visitAudio(data.audio);
  await writeFile(path.join(out, "data/index.json"), JSON.stringify(index));
  files.add("data/index.json");
  const summary = {
    maps: Object.keys(maps).length,
    programs: Object.keys(programFiles).length,
    scriptChunks: chunks.size,
    atlases: atlasIndex.summary,
    files: files.size,
    startPrograms: mapPrograms[data.entry.mapId]?.length,
    startScriptChunks: new Set(mapPrograms[data.entry.mapId].map((id) => programFiles[id])).size,
  };
  await writeFile(path.join(out, "data/summary.json"), JSON.stringify(summary, null, 2));
  files.add("data/summary.json");
  async function clean(directory, prefix = "") {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = prefix + entry.name;
      if (entry.isDirectory()) await clean(path.join(directory, entry.name), file + "/");
      else if (!files.has(file)) await unlink(path.join(directory, entry.name));
    }
  }
  await clean(out);
  console.log(JSON.stringify(summary));
  return { out, index, summary };
}
if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) await prepareWeb();
