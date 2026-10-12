import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Fresh reads for each audit. Runtime caching belongs to Repository only. */
export async function readSourceBatch(root, manifestPath, compiled = "dist") {
  const { ContentBatchManifest, planContentBatch } = await import(pathToFileURL(resolve(root, compiled, "src/compiler/content-batch.js")));
  const { GameContentRepository } = await import(pathToFileURL(resolve(root, compiled, "src/core/game-content.js")));
  const manifest = ContentBatchManifest.parse(JSON.parse(await readFile(resolve(root, manifestPath), "utf8")));
  if (manifest.routes.some(route => route.entry !== "source-new-game")) throw new Error("Source batch CLI accepts only source-new-game entries");
  const aliases = { "/game/battle.json": "/game/opening-playable.json", "/game/new-game.json": "/game/source-new-game.json" };
  const read = async url => {
    if (!/^\/(game|world|framework)\/[a-zA-Z0-9/_-]+\.json$/.test(url)) throw new Error("Unexpected content path");
    return JSON.parse(await readFile(root + "/build" + (aliases[url] ?? url), "utf8"));
  };
  const repository = new GameContentRepository(read, manifest.profile);
  const { content: entry, catalog, battle } = await repository.sourceNewGame();
  const maps = await Promise.all(manifest.mapIds.map(id => {
    const ref = catalog.maps[id]; if (!ref) throw new Error(`No source package for declared map ${id}`);
    return read(ref.url);
  }));
  const packages = { catalog, maps, battle, entry };
  return { plan: planContentBatch(manifest, packages), repository, packages };
}

export function batchRouteSpecs(manifest) {
  return manifest.routes.map(({ id, entry, expectedMapId, requiredMapIds, requiredEncounterIds }) =>
    ({ id, entry, expectedMapId, requiredMapIds, requiredEncounterIds }));
}
