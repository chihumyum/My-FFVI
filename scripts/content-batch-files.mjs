import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, posix, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

/** Fresh reads for each audit. Runtime caching belongs to Repository only. */
export async function readSourceBatch(root, manifestPath, compiled = "dist") {
  const { ContentBatchManifest, planContentBatch } = await import(pathToFileURL(resolve(root, compiled, "src/compiler/content-batch.js")));
  const { GameContentRepository } = await import(pathToFileURL(resolve(root, compiled, "src/core/game-content.js")));
  const manifest = ContentBatchManifest.parse(JSON.parse(await readFile(resolve(root, manifestPath), "utf8")));
  const entryLane = manifest.routes[0].entry;
  if (!["source-new-game", "development-map"].includes(entryLane) || manifest.routes.some(route => route.entry !== entryLane))
    throw new Error("Source batch CLI accepts only source-new-game or development-map entries in one lane");
  const aliases = { "/game/battle.json": "/game/opening-playable.json", "/game/new-game.json": "/game/source-new-game.json" };
  const buildRoot = resolve(root, "build");
  const withinBuild = path => {
    const child = relative(buildRoot, path);
    return child.length > 0 && child !== ".." && !child.startsWith(".." + sep) && !isAbsolute(child);
  };
  const read = async url => {
    if (typeof url !== "string" || !/^\/(game|world|framework|content-packages)\/[a-zA-Z0-9/_-]+\.json$/.test(url) ||
        posix.normalize(url) !== url) throw new Error("Unexpected content path");
    // Explicit host references are exact. Compatibility aliases apply only
    // when the old manifest did not nominate a reference package.
    const selected = manifest.contentRefs ? url : (aliases[url] ?? url);
    const path = resolve(buildRoot, "." + selected);
    if (!withinBuild(path)) throw new Error("Unexpected content path outside build");
    const [base, file] = await Promise.all([realpath(buildRoot), realpath(path)]);
    const child = relative(base, file);
    if (child.length === 0 || child === ".." || child.startsWith(".." + sep) || isAbsolute(child))
      throw new Error("Unexpected content path outside build");
    return JSON.parse(await readFile(file, "utf8"));
  };
  const repository = new GameContentRepository(read, manifest.profile, manifest.contentRefs);
  let entry, catalog, battle;
  if (entryLane === "development-map") {
    if (manifest.profile !== "framework") throw new Error("Development map batch requires the framework profile");
    const opening = await repository.opening();
    if (!opening.development) throw new Error("Development map batch requires a declared map entry");
    entry = opening.field; battle = opening.battle; catalog = opening.development.catalog;
  } else ({ content: entry, catalog, battle } = await repository.sourceNewGame());
  const maps = await Promise.all(manifest.mapIds.map(id => {
    const ref = catalog.maps[id]; if (!ref) throw new Error(`No source package for declared map ${id}`);
    return repository.map(id, catalog);
  }));
  const packages = { catalog, maps, battle, entry };
  return { plan: planContentBatch(manifest, packages), repository, packages };
}

export function batchRouteSpecs(manifest) {
  return manifest.routes.map(({ id, entry, expectedMapId, requiredMapIds, requiredEncounterIds, inputs }) => {
    const spec = { id, entry, expectedMapId,
      requiredMapIds: [...requiredMapIds], requiredEncounterIds: [...requiredEncounterIds] };
    if (inputs.some(input => input.kind === "menu" || input.kind === "save-restore" ||
      input.kind === "shop" || input.kind === "leave-shop")) {
      const firstRestore = inputs.findIndex(input => input.kind === "save-restore");
      spec.program = {
        inputCount: inputs.length,
        menuCount: inputs.filter(input => input.kind === "menu").length,
        restoreCount: inputs.filter(input => input.kind === "save-restore").length + 1,
        postRestoreInputCount: firstRestore === -1 ? 0 :
          inputs.slice(firstRestore + 1).filter(input => input.kind !== "save-restore").length,
      };
    }
    return spec;
  });
}
