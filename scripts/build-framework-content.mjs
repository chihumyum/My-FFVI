import { mkdtemp, mkdir, readFile, writeFile, rename, rm, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { compileFrameworkContent } from "../dist/src/compiler/framework-content.js";
import { canonical } from "../dist/src/compiler/content.js";

const root = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const read = async (path) => JSON.parse(await readFile(root + path, "utf8"));
const catalog = await read("/build/world/catalog.json");
const maps = await Promise.all(Object.keys(catalog.maps).map((id) => read(`/build/world/maps/${id}.json`)));
const entry = await read("/build/game/source-new-game.json");
const result = compileFrameworkContent(catalog, maps, entry);
const target = root + "/build/framework", backup = root + "/build/.previous-framework";
const staged = await mkdtemp(root + "/build/.framework-");
try {
  await mkdir(staged + "/world/maps", { recursive: true });
  await writeFile(staged + "/world/catalog.json", canonical(result.catalog) + "\n");
  await writeFile(staged + "/new-game.json", canonical(result.entry) + "\n");
  await writeFile(staged + "/profile-report.json", JSON.stringify(result.report, null, 2) + "\n");
  for (const map of result.maps)
    await writeFile(staged + `/world/maps/${map.mapId}.json`, canonical(map) + "\n");
  try {
    await stat(backup);
    throw new Error("Inspect interrupted build/.previous-framework");
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  let previous = false;
  try { await rename(target, backup); previous = true; }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  try { await rename(staged, target); }
  catch (error) { if (previous) await rename(backup, target); throw error; }
  if (previous) await rm(backup, { recursive: true });
  console.log(JSON.stringify({ profile: result.catalog.developmentProfile.kind,
    omittedEnvironmentEffects: result.catalog.developmentProfile.omissions.length,
    contentHash: result.catalog.contentHash, output: "build/framework" }));
} finally { await rm(staged, { recursive: true, force: true }); }
