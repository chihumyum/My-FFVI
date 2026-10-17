import { compileFieldActorFactory } from "../../src/compiler/field-actor-factory.js";
import { compileFieldActorView } from "../../src/compiler/field-actor-view.js";
import { compileNewGame } from "../../src/compiler/new-game.js";
import { createNewGame } from "../../src/core/new-game.js";
import { createFreshFieldPartyActorCheckpoint } from "../../src/core/field-actor-factory.js";
import { prepareMapPartyEntry, type MapPartyEntryDefinition } from "../../src/core/map-party-entry.js";
import { projectFieldActorView } from "../../src/core/field-actor-view.js";
import type { PartyAppearanceCandidate } from "../../src/core/party.js";
import type { Character } from "../../src/field/types.js";
import { newGameFixture } from "./new-game.js";
import { actorCatalog } from "./party-actors.js";

export function fieldActorFactoryFixture() {
  const f = newGameFixture(), fresh = createNewGame(compileNewGame(f.reader(), f.tables, (key) => key,
    { kind: "ordinary-weapon-effects-v1", additionalAbilities: [] }).definition);
  const sources = [
    { file: "GameAssembly.dll", sha256: "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc" },
    { file: "FINAL FANTASY VI_Data/StreamingAssets/aa/StandaloneWindows64/chara_field_assets_all_9e395e2f928b4e4c1168ce78cb733ac7.bundle",
      sha256: "82befd5fd3adeed5c8055c90a9aa3b8a09837be9094f9677d33ead3cbf3a0daa" },
    { file: "synthetic-map.bundle", sha256: "a".repeat(64) },
  ];
  const factory = compileFieldActorFactory(sources), partyCatalog = actorCatalog();
  partyCatalog.characterAssets.push({ id: 91, sourceId: 2, jobId: fresh.owned.roster[0]!.jobId, fieldAssetId: 2 });
  partyCatalog.viewpointOffsets = [];
  const parties = fresh.owned.party.slots.map((slot) => slot.flatMap((cell, index) => {
    if (cell.id === null) return [];
    const r = fresh.owned.roster.find((r) => r.id === cell.id)!;
    return [{ id: r.id, sourceId: r.sourceId, jobId: r.jobId, index: index as 0 | 1 | 2 | 3, row: cell.row, enabled: r.enabled, conditionIds: [...r.conditionIds] }];
  }));
  const party: PartyAppearanceCandidate = { parties, activeMembers: parties[0]! };
  const source = { file: "synthetic-map.bundle", assetPath: "Root/Map/tilemap.json", objectId: "9223372036854775807", sha256: "a".repeat(64) };
  const map: MapPartyEntryDefinition = { formatVersion: 1, kind: "map-party-entry", mapId: 901,
    width: 20, height: 16, mapRange: { x: 0, y: 0, width: 20, height: 16 }, loopType: 0,
    pointIns: [{ id: 7, x: 3, y: 4, layer: 0, direction: "up", linkObject: 0, source }], conditionColliders: [] };
  const tilemap = { source, data: { tilewidth: 16, tileheight: 16, width: 20, height: 16, orientation: "orthogonal",
    layers: [{ type: "group", name: "TileGroup", layers: [{ type: "tilelayer", name: "BottomLayer" }] }] } };
  const mapPackage = { source: { ...source, assetPath: "Root/package.json", objectId: "-9007199254740999" },
    data: { map: [{ tilemap: "Map/tilemap" }], texture: [{ name: "plain", asset: "plain" }] } };
  const view = compileFieldActorView(sources, tilemap, mapPackage, { width: 20, height: 16 });
  const initial = createFreshFieldPartyActorCheckpoint({ factory, catalog: partyCatalog, fresh, party, map, playerId: "-1001" });
  const entry = prepareMapPartyEntry(partyCatalog, { definition: map, entrance: 7, mapViewType: 0,
    prior: initial, playerVisible: true, party, transportation: fresh.entry.transportation, canPartySwitching: false });
  const characters: Record<string, Character> = Object.fromEntries(Object.values(partyCatalog.assets).map((a) => [a.asset, {
    source, sprites: { body: { file: "synthetic.png", width: 16, height: 24, pivot: [0.5, 0], sha256: "0".repeat(64), source } },
    animations: Object.fromEntries(["Default", "WalkB", "WalkL", "WalkR", "wave"].map((key) => [key, {
      duration: 0.5, mode: 0, flip: false, next: "", frames: [{ sprite: "body", x: 0, y: 0, alpha: 1, flip: false }],
    }])),
  }]));
  const providers = { mapRenderContext: view.contextId, transportationType: 1 as const,
    footAttribute: () => 0, upperTexture: null, ceilTexture: null,
    applyViewProperties: (layer: number) => projectFieldActorView(view, layer) };
  const input = { factory, partyCatalog, checkpoint: entry.checkpoint, characters,
    player: { position: { x: -104, y: 72, z: -2 }, layer: 9, direction: "up" as const, visible: true },
    camera: { id: "camera:0", position: { x: 4, y: 8, z: 0 }, layer: 0 }, providers };
  return { sources, fresh, factory, partyCatalog, party, map, tilemap, mapPackage, view, initial, entry, characters, input };
}
