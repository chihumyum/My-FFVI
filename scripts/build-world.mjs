import { mkdtemp, mkdir, writeFile, rename, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { compileWorld } from "../dist/src/compiler/world.js";
import { canonical } from "../dist/src/compiler/content.js";
const root = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const result = await compileWorld(root);
const staged = await mkdtemp(root + "/build/.world-"),
  target = root + "/build/world",
  backup = root + "/build/.previous-world";
try {
  await mkdir(staged + "/maps");
  await writeFile(staged + "/catalog.json", canonical(result.catalog) + "\n");
  for (const map of result.maps)
    await writeFile(staged + `/maps/${map.mapId}.json`, canonical(map) + "\n");
  // A prior backup signals an interrupted publish; never overwrite it.
  const { stat } = await import("node:fs/promises");
  try {
    await stat(backup);
    throw new Error("Inspect interrupted build/.previous-world");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  let previous = false;
  try {
    await rename(target, backup);
    previous = true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  try {
    await rename(staged, target);
  } catch (error) {
    if (previous) await rename(backup, target);
    throw error;
  }
  if (previous) await rm(backup, { recursive: true });
  console.log(
    JSON.stringify(
      {
        maps: result.maps.length,
        geometryReady: result.maps.filter((m) => m.map && !m.blockers.length)
          .length,
        defaultGroupReady: Object.values(result.catalog.maps).filter(
          (m) => m.defaultGroupReady,
        ).length,
        characters: Object.keys(result.catalog.characters).length,
        contentHash: result.catalog.contentHash,
        output: "build/world",
      },
      null,
      2,
    ),
  );
} finally {
  await rm(staged, { recursive: true, force: true });
}
