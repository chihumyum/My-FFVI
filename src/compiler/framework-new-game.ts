import type { FrameworkNewGameContent } from "../core/framework-new-game.js";
import { assertFrameworkNewGameBindings } from "../core/framework-new-game.js";
import type { SourceNewGameContent } from "../core/source-new-game.js";
import type { BattleCatalog } from "../core/battle-content.js";
import type { WorldCatalog, WorldMapContent } from "../field/world.js";
import { assertSourceGameCatalog } from "../core/source-catalog.js";
import { contentDigest, verifyContent } from "../core/content-integrity.js";
import { canonical, hash } from "./content.js";
import { resolveFieldPresentation } from "../core/field-presentation.js";

export type FrameworkNewGameInput = {
  sourceEntry: SourceNewGameContent;
  sourceBattle: BattleCatalog;
  sourceMap: WorldMapContent;
  world: WorldCatalog;
  map: WorldMapContent;
  battle: BattleCatalog;
  entrance: number;
};

/** The original initializer remains immutable. A separately declared map
 * supplies placement and authored events, with its own entry/save identity. */
export async function compileFrameworkNewGame(input: FrameworkNewGameInput): Promise<FrameworkNewGameContent> {
  const data = structuredClone(input);
  const { sourceEntry, sourceBattle, sourceMap, world, map, battle, entrance } = data;
  await Promise.all([sourceEntry, sourceBattle, sourceMap, world, map, battle].map(value => verifyContent(value)));
  assertSourceGameCatalog(sourceBattle);
  assertSourceGameCatalog(battle, "framework");
  if (sourceEntry.kind !== "source-new-game-content-v1" || sourceEntry.developmentProfile !== undefined ||
      sourceMap.developmentProfile !== undefined || sourceEntry.battleCatalogHash !== sourceBattle.contentHash ||
      sourceEntry.sourceSetHash !== sourceMap.sourceSetHash ||
      sourceEntry.parentSourceSetHash !== sourceMap.parentSourceSetHash ||
      world.sourceSetHash !== sourceMap.sourceSetHash || world.parentSourceSetHash !== sourceMap.parentSourceSetHash ||
      world.mediaSourceSetHash !== sourceMap.mediaSourceSetHash)
    throw new Error("Framework entry source dependency mismatch");
  if (canonical(battle.gameState) !== canonical(sourceBattle.gameState))
    throw new Error("Framework entry cannot change the source initializer or owned catalogs");
  if (!battle.gameState.sourceNewGame || !world.developmentProfile || !world.nativeAnimationKeys)
    throw new Error("Framework entry requires initialized state and native field providers");
  const presentation = resolveFieldPresentation(map);
  const value: Omit<FrameworkNewGameContent, "contentHash"> = {
    kind: "framework-new-game-content-v1",
    sourceSetHash: world.sourceSetHash, parentSourceSetHash: world.parentSourceSetHash,
    battleCatalogHash: battle.contentHash, worldCatalogHash: world.contentHash, mapContentHash: map.contentHash,
    initializerHash: await contentDigest(sourceBattle.gameState.sourceNewGame),
    developmentProfile: { ...structuredClone(world.developmentProfile), sourceContentHash: sourceEntry.contentHash,
      omissions: [] },
    entry: { mapId: map.mapId, entrance }, factory: structuredClone(sourceEntry.factory),
    puppetCatalog: structuredClone(sourceEntry.puppetCatalog), view: structuredClone(presentation.view),
    animationKeys: structuredClone(world.nativeAnimationKeys),
    provenance: { kind: "source-initializer-authored-map-v1", sourceEntryHash: sourceEntry.contentHash,
      sourceMapHash: sourceMap.contentHash },
  };
  const content: FrameworkNewGameContent = { ...value, contentHash: hash(value) };
  assertFrameworkNewGameBindings(content, world, map, battle);
  return content;
}
