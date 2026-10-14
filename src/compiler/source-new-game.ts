import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { z } from "zod";
import { Hash } from "../contracts.js";
import { loadCorpus } from "./corpus.js";
import { loadSystemSource } from "./system-source.js";
import { compileNewGameFieldEntry } from "./new-game-field-entry.js";
import { compileFieldActorFactory } from "./field-actor-factory.js";
import { compileFieldPuppetActorCatalog } from "./field-puppet-actors.js";
import { hash, record } from "./content.js";
import { verifyContent } from "../core/content-integrity.js";
import type { SourceNewGameContent } from "../core/source-new-game.js";
import type { BattleCatalog } from "../core/battle-content.js";
import type { WorldCatalog, WorldMapContent } from "../field/world.js";
import { assertSourceGameCatalog } from "../core/source-catalog.js";
import { assertGameWorldMapIdentity } from "../core/game-content.js";
import { tableId } from "./table-id.js";

export type SourceNewGameWorld = { catalog: WorldCatalog; maps: readonly WorldMapContent[] };
export type SourceNewGameWorldFacts = {
  sourceSetHash: string;
  parentSourceSetHash: string;
  mediaSourceSetHash: string;
  maps: readonly { mapId: number; areaId: number; name: string }[];
};

/** A candidate supplies bodies, never their expected source identity or map
 * domain. Unavailable indexed maps remain part of the complete source closure. */
export async function verifySourceNewGameWorld(supplied: SourceNewGameWorld,
  expected: SourceNewGameWorldFacts): Promise<SourceNewGameWorld> {
  const value = structuredClone(supplied), facts = structuredClone(expected);
  const catalog = await verifyContent(value.catalog);
  if (catalog.kind !== "world-development" || catalog.formatVersion !== 1 ||
      catalog.sourceSetHash !== facts.sourceSetHash || catalog.parentSourceSetHash !== facts.parentSourceSetHash ||
      catalog.mediaSourceSetHash !== facts.mediaSourceSetHash || catalog.developmentProfile !== undefined ||
      Object.hasOwn(catalog, "walkEncounters") || !Array.isArray(value.maps) || !facts.maps.length)
    throw new Error("Candidate new-game world source/profile mismatch");
  const domain = new Map(facts.maps.map((map) => [map.mapId, map]));
  if (domain.size !== facts.maps.length || facts.maps.some((map) => !Number.isInteger(map.mapId) ||
      map.mapId <= 0 || map.mapId > 0x7fffffff || !Number.isInteger(map.areaId) || map.areaId < 0 ||
      map.areaId > 0x7fffffff || typeof map.name !== "string" || !map.name))
    throw new Error("Invalid expected source map domain");
  const keys = Object.keys(catalog.maps), seen = new Set<number>();
  if (keys.length !== domain.size || keys.some((key) => String(Number(key)) !== key || !domain.has(Number(key))))
    throw new Error("Candidate new-game world requires the complete source map domain");
  for (const raw of value.maps) {
    const expectedMap = domain.get(raw.mapId);
    if (!expectedMap || seen.has(raw.mapId)) throw new Error("Duplicate or foreign candidate source map");
    seen.add(raw.mapId);
    const indexed = catalog.maps[String(raw.mapId)]!;
    await verifyContent(raw, indexed.contentHash);
    const map = assertGameWorldMapIdentity(raw.mapId, catalog, raw);
    if (indexed.url !== `/world/maps/${map.mapId}.json` || indexed.name !== expectedMap.name ||
        map.name !== expectedMap.name || map.areaId !== expectedMap.areaId || indexed.areaId !== expectedMap.areaId ||
        map.developmentProfile !== undefined || map.developmentOmissions?.length ||
        map.frameworkPresentation !== undefined || map.walkEncounters !== undefined || !Array.isArray(map.blockers))
      throw new Error("Candidate new-game map source/profile mismatch");
  }
  if (seen.size !== domain.size) throw new Error("Candidate new-game world requires every indexed source map");
  return value;
}

async function sourceWorldFacts(root: string, corpus: Awaited<ReturnType<typeof loadCorpus>>): Promise<SourceNewGameWorldFacts> {
  // Only this small header is needed here; compileWorld already consumes the
  // complete media snapshot. Do not retain another copy of every image.
  const snapshot = z.object({ formatVersion: z.literal(1), files: z.array(z.object({ file: z.string(),
    sha256: Hash }).strict()).min(1) }).strict().parse(JSON.parse(await readFile(root + "/build/world-media/snapshot.json", "utf8")));
  const refs = snapshot.files.filter((file) => file.file === "media.json");
  if (refs.length !== 1) throw new Error("Unbound candidate world media header");
  const bytes = await readFile(root + "/build/world-media/media.json");
  if (createHash("sha256").update(bytes).digest("hex") !== refs[0]!.sha256)
    throw new Error("Changed candidate world media header");
  const media = record(JSON.parse(bytes.toString("utf8")));
  if (media.formatVersion !== 1 || media.adapterVersion !== "world-media-0.1.0" ||
      media.parentSourceSetHash !== corpus.sourceSetHash || hash(media.sources) !== media.sourceSetHash || !Array.isArray(media.sources))
    throw new Error("Candidate world media source mismatch");
  const sourceFiles = (corpus.manifest.sources as unknown[]).map(record);
  for (const file of media.sources.map(record))
    if (sourceFiles.filter((source) => source.file === file.file && source.sha256 === file.sha256).length !== 1)
      throw new Error("Foreign candidate world media source");
  return { sourceSetHash: corpus.sourceSetHash, parentSourceSetHash: String(corpus.manifest.parentSourceSetHash),
    mediaSourceSetHash: Hash.parse(media.sourceSetHash),
    maps: (corpus.tables["map.csv"] ?? []).map((row) => ({ mapId: tableId(row.id), areaId: tableId(row.area_id), name: row.map_name! })) };
}

export async function compileSourceNewGame(root: string, suppliedCatalog?: BattleCatalog,
  suppliedWorld?: SourceNewGameWorld): Promise<SourceNewGameContent> {
  // Capture caller-owned candidates before any asynchronous source read.
  const candidateBattle = suppliedCatalog === undefined ? undefined : structuredClone(suppliedCatalog);
  const candidateWorld = suppliedWorld === undefined ? undefined : structuredClone(suppliedWorld);
  const [corpus, battle, world] = await Promise.all([
    loadCorpus(root),
    candidateBattle === undefined
      ? readFile(root + "/build/game/source-catalog.json", "utf8").then((s) => verifyContent(JSON.parse(s) as BattleCatalog))
      : verifyContent(candidateBattle),
    candidateWorld === undefined
      ? readFile(root + "/build/world/catalog.json", "utf8").then((s) => verifyContent(JSON.parse(s) as WorldCatalog))
      : verifyContent(candidateWorld.catalog),
  ]);
  assertSourceGameCatalog(battle);
  if (!battle.gameState.sourceNewGame || !world.nativeAnimationKeys || world.sourceSetHash !== corpus.sourceSetHash ||
      world.parentSourceSetHash !== corpus.manifest.parentSourceSetHash)
    throw new Error("New-game build requires current source-bound battle/world packages");
  const system = await loadSystemSource(root, world.parentSourceSetHash);
  const entry = compileNewGameFieldEntry(system.reader, battle.gameState.sourceNewGame, corpus.assets).definition;
  const verifiedWorld = candidateWorld === undefined ? undefined :
    await verifySourceNewGameWorld(candidateWorld, await sourceWorldFacts(root, corpus));
  const map = verifiedWorld === undefined
    ? await verifyContent(JSON.parse(await readFile(root + `/build/world/maps/${entry.mapId}.json`, "utf8")) as WorldMapContent,
      world.maps[String(entry.mapId)]?.contentHash)
    : verifiedWorld.maps.find((map) => map.mapId === entry.mapId);
  if (!map) throw new Error("Missing candidate source new-game entry map");
  if (!map.partyEntry || !map.map || map.blockers.length || !map.cameraHost || map.cameraHostBlockers?.length ||
      !map.actorView || map.actorViewBlockers?.length || !map.nativeFoot || map.nativeFootBlockers?.length)
    throw new Error("New-game map preparation providers are incomplete");
  const misc = corpus.assets.filter((a) => a.source.assetPath.endsWith("/serial_misc_assets.json"));
  if (misc.length !== 1) throw new Error("New-game actor sources are unbound");
  const sources = (corpus.manifest.sources as unknown[]).map(record).map((s) => ({ file: String(s.file), sha256: String(s.sha256) }));
  const value: Omit<SourceNewGameContent, "contentHash"> = {
    kind: "source-new-game-content-v1", sourceSetHash: corpus.sourceSetHash,
    parentSourceSetHash: world.parentSourceSetHash, battleCatalogHash: battle.contentHash,
    worldCatalogHash: world.contentHash, mapContentHash: map.contentHash, entry,
    factory: compileFieldActorFactory(sources), puppetCatalog: compileFieldPuppetActorCatalog(misc[0]!.data),
    view: structuredClone(map.actorView),
    animationKeys: structuredClone(world.nativeAnimationKeys),
  };
  return { ...value, contentHash: hash(value) };
}
