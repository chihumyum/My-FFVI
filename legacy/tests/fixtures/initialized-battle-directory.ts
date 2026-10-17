import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { hash } from "../../src/compiler/content.js";
import { compileBattleEncounterRuntime } from "../../src/compiler/battle-encounter-runtime.js";
import type { SourceBattleRequests } from "../../src/compiler/source-battle-requests.js";
import { analyzeBatchEncounters } from "../../src/compiler/content-batch-battle.js";
import type { BattleCatalog } from "../../src/core/battle-content.js";
import { encounterRuntimeFixture } from "./battle-encounter-runtime.js";
import { sourceNewGameFixture } from "./source-new-game.js";
function seal<T extends { contentHash?: string }>(value: T): T & { contentHash: string } {
  const { contentHash: _, ...body } = value; return { ...value, contentHash: hash(body) };
}
export function directoryAnalysis(catalog: BattleCatalog, ids: number[]) {
  const result = analyzeBatchEncounters(catalog, ids);
  return { ready: result.encounters.filter(entry => entry.status === "ready").length,
    conditional: result.encounters.filter(entry => entry.status === "conditional").length,
    blocked: result.encounters.filter(entry => entry.status === "blocked").length, entries: result.encounters };
}

/** Reuse the existing enemy compiler and source-shaped owner. Only request
 * provenance is authored; no test supplies a hand-written ready certificate. */
export async function initializedBattleDirectoryFixture(options: { newGame?: boolean; supportedAI?: boolean } = {}) {
  const native = sourceNewGameFixture(), f = encounterRuntimeFixture();
  if(options.newGame){
    f.aiIdentity.sourceSetHash='c'.repeat(64);
    for(const encounter of f.input.encounters)for(const enemy of encounter.enemies)enemy.ai.source.sourceSetHash=f.aiIdentity.sourceSetHash;
    native.world.sourceSetHash='d'.repeat(64);native.map.sourceSetHash=native.world.sourceSetHash;
    native.world.maps[native.map.mapId]!.url='/world/maps/'+native.map.mapId+'.json';
    const source={file:'authored-directory-caller',assetPath:'tests/fixtures/initialized-battle-directory'};
    native.map.scripts['directory-fight']=[{kind:'encounter',party:9201,continuation:'directory-return',script:'directory-fight',index:0,source}];
    native.map.scripts['directory-return']=[{kind:'exit',script:'directory-return',index:0,source}];
    for(const name of ['directory-fight','directory-return']){
      native.map.scriptPuppetContexts![name]={...structuredClone(native.map.scriptPuppetContexts!.reserved!),scriptHash:hash(native.map.scripts[name])};
      (native.map.scriptSystemFlags??={})[name]={keepBadStatusVisual:false};
    }

  }

  f.tables["monster_party.csv"] = f.input.encounters.map(entry => ({ id: String(entry.partyId),
    battle_background_asset_id: String(entry.metadata.backgroundId), battle_bgm_asset_id: String(entry.metadata.bgmId),
    appearance_production: String(entry.metadata.appearanceProduction), not_escape: String(entry.metadata.notEscape) }));
  f.tables["battle_background_asset.csv"] = [{ id: "1", asset_name: "controlled-background" }];
  f.input.handoff = { policy: { kind: "framework-battle-handoff-v1", id: "controlled-directory",
    audio: "retain-field", introduction: "omit" } };
  f.input.encounters[1]!.patterns = [0, 0, 0, 0, 0, 1];
  if(!options.supportedAI){
  f.input.abilities[13]!.plan = null;
  f.input.abilities[13]!.blockers = ["Controlled unimplemented effect on a conditional AI action"];
  }
  const rawBase = native.battle;
  rawBase.encounters = {};
  rawBase.common.abilities = structuredClone(f.input.abilities);
  rawBase.common.sprites = structuredClone(f.input.sprites);
  rawBase.common.drops = { kind: "battle-drops-v1", weights: [100, 0, 0, 0, 0, 0, 0, 0], monsters: [], contents: [] };
  f.input.conditions = rawBase.common.conditions;
  const sourceBattle = seal(rawBase);
  native.world.parentSourceSetHash = f.aiIdentity.sourceSetHash;
  if(options.newGame)native.map.parentSourceSetHash=f.aiIdentity.sourceSetHash;
  native.world.maps[String(native.map.mapId)]!.contentHash = seal(native.map).contentHash;
  const sourceWorld = seal(native.world);
  const runtime = compileBattleEncounterRuntime(f.reader(), f.input);
  const producer = await import(pathToFileURL(resolve("scripts/source-battle-directory.mjs")).href);
  const composed = await producer.composeFrameworkBattleDirectory({ compiledDir: resolve(import.meta.dirname, "../.."),
    baseCatalog: sourceBattle, runtime }) as { catalog: BattleCatalog };
  const catalog = composed.catalog, requestedPartyIds = [9201, 9202];
  const rawRequests: SourceBattleRequests = {
    kind: "source-battle-requests-v1", contentHash: "", sourceSetHash: sourceWorld.sourceSetHash,
    parentSourceSetHash: sourceWorld.parentSourceSetHash, worldCatalogHash: sourceWorld.contentHash,
    mapBindings: [{ mapId: native.map.mapId, contentHash: sourceWorld.maps[String(native.map.mapId)]!.contentHash }],
    requestedPartyIds,
    requests: requestedPartyIds.map(partyId => ({ partyId, onlyBlockedCandidates: false, sites: [{
      kind: "typed-field-encounter", partyId, mapId: native.map.mapId, script: "controlled", index: partyId - 9201,
      slot: null, source: { ...f.aiIdentity, pointer: "/controlled-encounters/" + partyId }, rawPartyId: partyId,
      rawRate: null, rawInstruction: { mnemonic: "Encount", operands: { iValues: [partyId] } },
    }] })), diagnostics: [], runtimeAdmission: "unassessed",
  };
  const requests = seal({ kind: "source-battle-directory-requests-v1", contentHash: "",
    sourceSetHash: sourceWorld.sourceSetHash, parentSourceSetHash: sourceWorld.parentSourceSetHash,
    sourceRequests: seal(rawRequests), retainedBase: { catalogHash: sourceBattle.contentHash, partyIds: [] as number[] },
    requestedPartyIds });
  const report = seal({ kind: "source-battle-directory-build-v1", contentHash: "",
    sourceSetHash: sourceWorld.sourceSetHash, parentSourceSetHash: sourceWorld.parentSourceSetHash,
    battleSourceSetHash: f.aiIdentity.battleSourceSetHash, baselineHash: sourceBattle.contentHash,
    frameworkCatalogHash: catalog.contentHash, strictCatalogHash: hash({ controlled: "strict directory omitted from this input" }),
    requestsHash: requests.contentHash, requestedPartyIds,
    framework: { ...catalog.encounterReport!, analysis: directoryAnalysis(catalog, requestedPartyIds) },
    diagnostics: { requests: requests.sourceRequests.diagnostics, framework: catalog.encounterDiagnostics!, strict: [] },
  });
  return { selection: "shared-framework-directory-v1" as const, sourceBattle, sourceWorld,
    directory: { frameworkCatalog: catalog, requests, report }, native:structuredClone(native) };
}
