import { readFile, writeFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { navigationRegions } from "./play-navigation-regions.mjs";
const root = resolve(import.meta.dirname, "..");
export async function buildNavigation({ force = false } = {}) {
  const output = resolve(root, "build/play/navigation.json");
  if (!force) {
    try {
      if (JSON.parse(await readFile(output, "utf8")).maps[1]?.entrances)
        return output;
    } catch {}
  }
  const files = (await readdir(resolve(root, "build/world/maps"))).filter((f) =>
    /^\d+\.json$/.test(f),
  );
  const maps = {},
    data = JSON.parse(
      await readFile(resolve(root, "build/play/data.json"), "utf8"),
    );
  const warpCache = new Map();
  function isWarp(entry, mapId) {
    if (entry.kind !== 2 || !entry.script) return false;
    const id = data.byMap[mapId]?.[entry.script] ?? data.global[entry.script];
    if (!warpCache.has(id)) {
      const ops = data.programs[id]?.ops || [];
      warpCache.set(
        id,
        ops.some((o) => o[0] === "ChangeMap") &&
          !ops.some((o) => ["Msg", "Encount", "EncountBoss"].includes(o[0])),
      );
    }
    return warpCache.get(id);
  }
  for (let batch = 0; batch < files.length; batch += 8) {
    await Promise.all(
      files.slice(batch, batch + 8).map(async (file) => {
        const raw = JSON.parse(
          await readFile(resolve(root, "build/world/maps", file), "utf8"),
        );
        const header = {
          id: raw.mapId,
          name: raw.name,
          areaId: raw.areaId,
          initializer: raw.initializer,
        };
        if (!raw.map) {
          maps[raw.mapId] = { ...header, entries: [], entrances: {} };
          return;
        }
        const entries = [],
          add = (entry, group) => {
            if (
              !(entry.script || entry.destination) ||
              entries.some((e) => e.id === entry.id && e.group === group)
            )
              return;
            entries.push({
              id: entry.id,
              kind: entry.kind,
              layer: entry.layer,
              x: entry.x,
              y: entry.y,
              script: entry.script,
              destination: entry.destination,
              group,
            });
          };
        for (const [group, value] of Object.entries(raw.map.groups || {}))
          for (const entry of value.entities || []) add(entry, group);
        for (const entry of raw.map.entities || [])
          add(entry, "entity_default");
        maps[raw.mapId] = {
          ...header,
          ...navigationRegions(raw.map, entries, (entry) =>
            isWarp(entry, raw.mapId),
          ),
        };
      }),
    );
  }
  await writeFile(output, JSON.stringify({ maps }));
  console.log(
    `Navigation index: ${files.length} existing maps, entrance connectivity only.`,
  );
  return output;
}
if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename)
  await buildNavigation({ force: process.argv.includes("--force") });
