import { contentDigest } from "../../src/core/content-integrity.js";
import { GameContentRepository } from "../../src/core/game-content.js";
import type { GameContentRefsV2 } from "../../src/core/game-content-refs.js";
import type { GameContentRelease, GameContentReleaseIndex } from "../../src/core/game-content-release.js";
import { compileFrameworkNewGame } from "../../src/compiler/framework-new-game.js";
import type { FieldEntity, Op, Site } from "../../src/field/types.js";
import type { WorldMapContent } from "../../src/field/world.js";
import { frameworkNewGameFixture } from "./framework-new-game.js";
import { sealBatchContent } from "./content-batch.js";

type Instruction<T> = T extends Site ? Omit<T, keyof Site> : never;

export const releaseSessionHost = { visible: true, mediaReady: true, overlayOpen: false };
export const releaseSessionRuntime = { battleHandoff: "prepared" as const,
  audioReadiness: { isReady: () => true }, soundPresentation: { isPresented: () => true } };

/** Two authored, initialized releases of one package. The original JSON URLs
 * intentionally collide; only their immutable archive objects distinguish
 * them. No source story, original media, gameplay owner or result is mocked. */
export async function contentReleaseSessionFixture(options: {
  /** Optional authored PNG identities for actual-app tests. The default
   * remains a JSON-only, headless content/owner fixture. */
  uiMedia?: { old: string; current: string };
} = {}) {
  const base = await frameworkNewGameFixture(), packageId = "controlled-release-session";
  const initialMapId = base.map.mapId, nextMapId = initialMapId + 1;
  const source = { file: "tests/fixtures/content-release-session.ts", assetPath: "authored/releases" };
  const urls = { entry: "/controlled/release/entry.json", battle: "/controlled/release/battle.json",
    world: "/controlled/release/world.json", map: (id: number) => `/controlled/release/maps/${id}.json` };
  const mediaFiles = { character: "/controlled/release/actor.png", initialMap: "/controlled/release/start.png",
    nextMap: "/controlled/release/destination.png" };
  const script = (name: string, instructions: Instruction<Op>[]): Op[] =>
    instructions.map((instruction, index) => ({ ...instruction, script: name, index, source }) as Op);

  async function version(label: "old" | "current", grant: number, gil: number) {
    const battle = structuredClone(base.battle);
    const encounter = battle.encounters[base.encounterId]!;
    encounter.enemies[0]!.gil = gil;
    battle.common.abilities[10]!.name = `Authored ${label} release attack`;
    const qualification = battle.common.battleEntry!.maps.find(map => map.id === initialMapId)!;
    battle.common.battleEntry!.maps.push({ ...structuredClone(qualification), id: nextMapId });
    const sealedBattle = sealBatchContent(battle);

    async function mapDefinition(mapId: number): Promise<WorldMapContent> {
      const map = structuredClone(base.map), first = mapId === initialMapId;
      map.mapId = mapId; map.name = `Authored ${label} release ${first ? "start" : "destination"}`;
      map.map!.identity!.mapId = mapId; map.map!.entryContext!.mapId = mapId; map.partyEntry!.mapId = mapId;
      const point = map.partyEntry!.pointIns[0]!;
      const pointEntity = map.map!.entities.find(entity => entity.kind === 0)!;
      const trigger = (id: string, x: number, y: number, target: number): FieldEntity => ({
        ...structuredClone(pointEntity), id, objectId: target, kind: 3, x, y, script: null,
        source, destination: { mapId: target, entrance: point.id },
      });
      const battleTrigger: FieldEntity = { ...structuredClone(pointEntity), id: "release-battle", objectId: 771,
        kind: 2, x: point.x + 1, y: point.y, script: "stone-battle", source };
      const talkTrigger: FieldEntity = { ...structuredClone(pointEntity), id: "release-talk", objectId: 772,
        kind: 2, x: point.x - 1, y: point.y, script: "release-talk", source };
      const entities = first ? [pointEntity, trigger("release-exit", point.x + 1, point.y, nextMapId)]
        : [pointEntity, battleTrigger, trigger("release-return", point.x, point.y + 1, initialMapId),
          ...(options.uiMedia ? [talkTrigger] : [])];
      map.map!.entities = entities;
      map.map!.groups = { entity_default: { name: "entity_default", entities: structuredClone(entities), blockers: [], source } };
      map.scripts["authored-initialize"] = script("authored-initialize", [
        { kind: "inventory", command: { kind: "grant-item", id: 701, count: grant }, result: null, dependencies: [] },
        { kind: "calc", left: { category: "MapLocalVariable", index: 0 }, operator: "←",
          right: { kind: "immediate", value: first ? 1 : 2 } },
        { kind: "exit" },
      ]);
      map.scriptPuppetContexts!["authored-initialize"] = {
        ...map.scriptPuppetContexts!["authored-initialize"]!, scriptHash: await contentDigest(map.scripts["authored-initialize"]!),
      };
      if (options.uiMedia) {
        map.map!.textures = { controlled: first ? mediaFiles.initialMap : mediaFiles.nextMap };
        map.scripts["release-talk"] = script("release-talk", [
          { kind: "message", key: `AUTHORED_RELEASE_${label.toUpperCase()}`, speaker: "Guide",
            text: `Authored ${label} release dialogue.` },
          { kind: "inventory", command: { kind: "grant-item", id: 701, count: grant }, result: null, dependencies: [] },
          { kind: "exit" },
        ]);
        map.scriptPuppetContexts!["release-talk"] = {
          ...map.scriptPuppetContexts!["authored-initialize"]!, scriptHash: await contentDigest(map.scripts["release-talk"]!),
        };
      }
      return sealBatchContent(map);
    }
    const initialMap = await mapDefinition(initialMapId), nextMap = await mapDefinition(nextMapId);
    const world = structuredClone(base.world);
    if (options.uiMedia) for (const character of Object.values(world.characters))
      for (const sprite of Object.values(character.sprites)) {
        sprite.file = mediaFiles.character; sprite.sha256 = options.uiMedia[label];
      }
    world.transportation = structuredClone(battle.gameState.sourceNewGame!.transportation);
    world.maps = Object.fromEntries([initialMap, nextMap].map(map => [map.mapId, {
      contentHash: map.contentHash, url: urls.map(map.mapId), name: map.name, areaId: map.areaId,
      geometryReady: true, defaultGroupReady: true, blockers: [],
    }]));
    const sealedWorld = sealBatchContent(world);
    const content = await compileFrameworkNewGame({ sourceEntry: base.sourceEntry, sourceBattle: base.sourceBattle,
      sourceMap: base.sourceMap, world: sealedWorld, map: initialMap, battle: sealedBattle,
      entrance: initialMap.partyEntry!.pointIns[0]!.id });
    const refs: GameContentRefsV2 = { kind: "game-content-refs-v2", profile: "framework", source: null, development: null,
      initialized: { entry: { url: urls.entry, contentHash: content.contentHash },
        battle: { url: urls.battle, contentHash: sealedBattle.contentHash } },
      world: { url: urls.world, contentHash: sealedWorld.contentHash } };
    const files = new Map<string, { contentHash: string }>([
      [urls.entry, content], [urls.battle, sealedBattle], [urls.world, sealedWorld],
      [urls.map(initialMapId), initialMap], [urls.map(nextMapId), nextMap],
    ]);
    const bindings = Object.fromEntries([...files].map(([url, value]) => [url, value.contentHash]));
    const mediaBindings = options.uiMedia ? Object.fromEntries(Object.values(mediaFiles)
      .map(file => [file, { sha256: options.uiMedia![label], extension: "png" as const }])) : {};
    const release: GameContentRelease = { id: await contentDigest({ packageId, refs, bindings,
      ...(options.uiMedia ? { mediaBindings } : {}) }),
      sourceSetHash: content.parentSourceSetHash, refs, bindings, mediaBindings };
    return { release, refs, files, content, battle: sealedBattle, world: sealedWorld, initialMap, nextMap, grant, gil };
  }

  const old = await version("old", 1, 7), current = await version("current", 3, 19);
  const index: GameContentReleaseIndex = sealBatchContent({ kind: "game-content-release-index-v1" as const,
    contentHash: "", packageId, profile: "framework" as const, currentReleaseId: current.release.id,
    objectRoot: "/content-releases" as const, releases: [old.release, current.release] });
  const indexUrl = `/content-releases/packages/${packageId}.json`;
  const files = new Map<string, unknown>(current.files), reads: string[] = [];
  files.set(indexUrl, index);
  for (const release of [old, current]) for (const value of release.files.values())
    files.set(`/content-releases/objects/${value.contentHash}.json`, value);
  const read = async (url: string): Promise<unknown> => {
    reads.push(url);
    if (!files.has(url)) throw new Error(`Controlled release file is unavailable: ${url}`);
    return structuredClone(files.get(url));
  };
  const repository = new GameContentRepository(read, "framework", current.refs);
  const oldRepository = new GameContentRepository(async url => {
    if (!old.files.has(url)) throw new Error(`Controlled old release file is unavailable: ${url}`);
    return structuredClone(old.files.get(url));
  }, "framework", old.refs);
  return { packageId, urls, old, current, index, indexUrl, files, reads, read, repository, oldRepository,
    initialMapId, nextMapId, encounterId: base.encounterId, playerIds: base.playerIds, mediaFiles };
}
