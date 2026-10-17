import { readFile, writeFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { navigationRegions } from "./play-navigation-regions.mjs";
import { recoverSourceMap } from "./play-source-map.mjs";
import { addNpcFlags } from "./build-play.mjs";
const root = resolve(import.meta.dirname, "..");
export async function buildNavigation({ force = false } = {}) {
  const output = resolve(root, "build/play/navigation.json");
  if (!force) {
    try {
      const cached = JSON.parse(await readFile(output, "utf8"));
      if (cached.maps[1]?.world && Object.values(cached.maps).some(map => map.entries.some(entry => entry.productGroup)))
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
        if(!raw.map)raw.map=await recoverSourceMap(raw);
        const header = {
          id: raw.mapId,
          name: raw.name,
          areaId: raw.areaId,
          initializer: raw.initializer,
          world: Boolean(raw.map?.worldTerrain),
        };
        if (!raw.map) {
          maps[raw.mapId] = { ...header, entries: [], entrances: {} };
          return;
        }
        const assigned=new Map();
        for(const id of new Set(Object.values(data.byMap[raw.mapId]||{})))
          for(const [op,i] of data.programs[id].ops)if(op==='AssignMoveRoute'){
            const list=assigned.get(String(i[0]))||new Set();list.add(i[1]);assigned.set(String(i[0]),list);
          }
        if(assigned.size || [...raw.map.entities || [], ...Object.values(raw.map.groups || {}).flatMap(group => group.entities || [])].some(entry => entry.npc))await addNpcFlags(raw.map);
        const entries = [],
          add = (entry, group) => {
            if (
              !(entry.script || entry.destination || entry.npc?.interaction?.actionId === 8) ||
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
              productGroup: entry.npc?.interaction?.actionId === 8 ? entry.npc.interaction.productGroup : undefined,
              routePoints:[...assigned.get(String(entry.id))||[]].flatMap(id=>(raw.map.routes?.[id]||[])
                .filter(row=>[1,7].includes(row.instruction_type))
                .map(row=>({x:row.cellx,y:row.celly,layer:row.layer??entry.layer}))),
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
