import { readFile } from "node:fs/promises";
import { loadCorpus } from "./corpus.js";
import { loadSystemSource } from "./system-source.js";
import { bindMapPackages } from "./map-package.js";
import { compileNewGameFieldEntry } from "./new-game-field-entry.js";
import { compileFieldActorFactory } from "./field-actor-factory.js";
import { compileFieldPuppetActorCatalog } from "./field-puppet-actors.js";
import { compileFieldActorView } from "./field-actor-view.js";
import { hash, record } from "./content.js";
import { verifyContent } from "../core/content-integrity.js";
import type { SourceNewGameContent } from "../core/source-new-game.js";
import type { BattleCatalog } from "../core/battle-content.js";
import type { WorldCatalog, WorldMapContent } from "../field/world.js";

export async function compileSourceNewGame(root: string): Promise<SourceNewGameContent> {
  const [corpus, battle, world] = await Promise.all([
    loadCorpus(root),
    readFile(root + "/build/game/opening-playable.json", "utf8").then((s) => verifyContent(JSON.parse(s) as BattleCatalog)),
    readFile(root + "/build/world/catalog.json", "utf8").then((s) => verifyContent(JSON.parse(s) as WorldCatalog)),
  ]);
  if (!battle.gameState.sourceNewGame || world.sourceSetHash !== corpus.sourceSetHash ||
      world.parentSourceSetHash !== corpus.manifest.parentSourceSetHash)
    throw new Error("New-game build requires current source-bound battle/world packages");
  const system = await loadSystemSource(root, world.parentSourceSetHash);
  const entry = compileNewGameFieldEntry(system.reader, battle.gameState.sourceNewGame, corpus.assets).definition;
  const map = await verifyContent(JSON.parse(await readFile(root + `/build/world/maps/${entry.mapId}.json`, "utf8")) as WorldMapContent,
    world.maps[String(entry.mapId)]?.contentHash);
  if (!map.partyEntry || !map.map || map.blockers.length || !map.cameraHost || map.cameraHostBlockers?.length)
    throw new Error("New-game map preparation providers are incomplete");
  const binding = bindMapPackages(corpus.assets, corpus.tables).find((m) => Number(m.id) === entry.mapId);
  const tile = corpus.assets.find((a) => a.id === binding?.tilemap);
  const pkg = corpus.assets.find((a) => a.id === binding?.packageId);
  const misc = corpus.assets.filter((a) => a.source.assetPath.endsWith("/serial_misc_assets.json"));
  if (!tile?.source.objectId || !pkg?.source.objectId || misc.length !== 1) throw new Error("New-game actor sources are unbound");
  const sources = (corpus.manifest.sources as unknown[]).map(record).map((s) => ({ file: String(s.file), sha256: String(s.sha256) }));
  const value: Omit<SourceNewGameContent, "contentHash"> = {
    kind: "source-new-game-content-v1", sourceSetHash: corpus.sourceSetHash,
    parentSourceSetHash: world.parentSourceSetHash, battleCatalogHash: battle.contentHash,
    worldCatalogHash: world.contentHash, mapContentHash: map.contentHash, entry,
    factory: compileFieldActorFactory(sources), puppetCatalog: compileFieldPuppetActorCatalog(misc[0]!.data),
    view: compileFieldActorView(sources, { data: tile.data, source: { ...tile.source, objectId: tile.source.objectId } },
      { data: pkg.data, source: { ...pkg.source, objectId: pkg.source.objectId } }, map.partyEntry.mapRange),
  };
  return { ...value, contentHash: hash(value) };
}
