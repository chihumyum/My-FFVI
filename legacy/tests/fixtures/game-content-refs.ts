import { contentDigest } from "../../src/core/content-integrity.js";
import type { GameContentProfile, GameContentRefs } from "../../src/core/game-content-refs.js";
import type { DevelopmentProfile } from "../../src/core/development-profile.js";
import { checkpointFixture } from "./checkpoint-game.js";
import { sourceNewGameFixture } from "./source-new-game.js";

export async function sealGameContentRefsFixture<T extends { contentHash: string }>(value: T): Promise<T> {
  const { contentHash: _, ...payload } = structuredClone(value);
  return { ...payload, contentHash: await contentDigest(payload) } as T;
}

function frameworkProfile(sourceContentHash: string): DevelopmentProfile {
  return { kind: "framework-development-v1", policy: "omit-anonymous-environment-particles-v1",
    sourceContentHash, omissions: [], transportation: "walking-magitek-framework-v1" };
}

/** A declared synthetic source entry, not a source story/region reconstruction.
 * Custom roots and actual native field owners expose startup, map and restore
 * binding failures without changing the maintained legacy fixtures. */
export async function sourceGameContentRefsFixture(profile: GameContentProfile = "source", prefix = "/packages/source") {
  const f = sourceNewGameFixture();
  // Explicit authored media for the fixture's existing synthetic combatant.
  f.battle.common.sprites.synthetic = { file: "/synthetic/player.png", width: 16, height: 16 };
  const battle = await sealGameContentRefsFixture(f.battle);
  const initial = await sealGameContentRefsFixture(f.map);
  const map = profile === "framework" ? await sealGameContentRefsFixture({ ...initial,
    developmentProfile: frameworkProfile(initial.contentHash) }) : initial;
  let destination = structuredClone(initial);
  destination.mapId = map.mapId === 902 ? 903 : 902;
  destination.map!.identity!.mapId = destination.mapId;
  destination.map!.entryContext!.mapId = destination.mapId;
  destination.partyEntry!.mapId = destination.mapId;
  destination.actorView!.contextId = "e".repeat(64);
  destination = await sealGameContentRefsFixture(destination);
  if (profile === "framework") destination = await sealGameContentRefsFixture({ ...destination,
    developmentProfile: frameworkProfile(destination.contentHash) });
  const worldDraft = structuredClone(f.world);
  worldDraft.transportation = structuredClone(battle.gameState.sourceNewGame!.transportation);
  worldDraft.maps = {
    [map.mapId]: { ...worldDraft.maps[String(f.map.mapId)]!, contentHash: map.contentHash,
      url: `${prefix}/maps/${map.mapId}.json` },
    [destination.mapId]: { ...worldDraft.maps[String(f.map.mapId)]!, contentHash: destination.contentHash,
      url: `${prefix}/maps/${destination.mapId}.json` },
  };
  let catalog = await sealGameContentRefsFixture(worldDraft);
  if (profile === "framework") catalog = await sealGameContentRefsFixture({ ...catalog,
    developmentProfile: frameworkProfile(catalog.contentHash) });
  let content = await sealGameContentRefsFixture({ ...f.content, battleCatalogHash: battle.contentHash,
    worldCatalogHash: catalog.contentHash, mapContentHash: map.contentHash });
  if (profile === "framework") content = await sealGameContentRefsFixture({ ...content,
    developmentProfile: frameworkProfile(content.contentHash) });
  const refs: GameContentRefs = { kind: "game-content-refs-v1", profile,
    world: { url: `${prefix}/world.json`, contentHash: catalog.contentHash },
    source: { entry: { url: `${prefix}/entry.json`, contentHash: content.contentHash },
      battle: { url: `${prefix}/battle.json`, contentHash: battle.contentHash } }, development: null };
  const files = new Map<string, unknown>([
    [refs.world.url, catalog], [refs.source!.entry.url, content], [refs.source!.battle.url, battle],
    [catalog.maps[String(map.mapId)]!.url, map], [catalog.maps[String(destination.mapId)]!.url, destination],
  ]);
  return { refs, files, content, catalog, map, destination, battle, presentation: f.presentation, fade: f.fade };
}

/** A distinct development checkpoint and a real second-map dependency. The
 * fixture declares its profile; source-new-game is deliberately unavailable. */
export async function developmentGameContentRefsFixture(profile: GameContentProfile = "source", prefix = "/packages/development") {
  const f = checkpointFixture();
  // The authored destination flips this flag. Its initial value is declared by
  // this development entry, rather than interpreting unknown source state as 0.
  f.field.entry.initialEventValues = [{ ref: { category: "ScenarioFlag1", index: 8 }, value: 0 }];
  f.battle.common.sprites.synthetic = { file: "/synthetic/player.png", width: 16, height: 16 };
  let field = await sealGameContentRefsFixture(f.field), map = await sealGameContentRefsFixture(f.target);
  const battle = await sealGameContentRefsFixture(f.battle);
  if (profile === "framework") {
    field = await sealGameContentRefsFixture({ ...field, developmentProfile: frameworkProfile(field.contentHash) });
    map = await sealGameContentRefsFixture({ ...map, developmentProfile: frameworkProfile(map.contentHash) });
  }
  const worldDraft = structuredClone(f.world);
  worldDraft.maps[String(map.mapId)]!.contentHash = map.contentHash;
  worldDraft.maps[String(map.mapId)]!.url = `${prefix}/maps/${map.mapId}.json`;
  let catalog = await sealGameContentRefsFixture(worldDraft);
  if (profile === "framework") catalog = await sealGameContentRefsFixture({ ...catalog,
    developmentProfile: frameworkProfile(catalog.contentHash) });
  const refs: GameContentRefs = { kind: "game-content-refs-v1", profile,
    world: { url: `${prefix}/world.json`, contentHash: catalog.contentHash }, source: null,
    development: { entry: { url: `${prefix}/entry.json`, contentHash: field.contentHash },
      battle: { url: `${prefix}/battle.json`, contentHash: battle.contentHash } } };
  const files = new Map<string, unknown>([
    [refs.world.url, catalog], [refs.development!.entry.url, field], [refs.development!.battle.url, battle],
    [catalog.maps[String(map.mapId)]!.url, map],
  ]);
  return { refs, files, field, catalog, map, battle };
}
