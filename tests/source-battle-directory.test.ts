import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { hash, canonical } from "../src/compiler/content.js";
import { compileBattleEncounterRuntime } from "../src/compiler/battle-encounter-runtime.js";
import { assertSourceGameCatalog } from "../src/core/source-catalog.js";
import { encounterRuntimeFixture } from "./fixtures/battle-encounter-runtime.js";
import { sourceNewGameFixture } from "./fixtures/source-new-game.js";

const producer = () => import(pathToFileURL(resolve("scripts/source-battle-directory.mjs")).href);
const compiledDir = resolve(import.meta.dirname, "..");
const handoff = { kind: "framework-battle-handoff-v1" as const, id: "controlled-directory",
  audio: "retain-field" as const, introduction: "omit" as const };
const policy = () => ({ kind: "framework-battle-batch-entry-v1", id: "controlled-directory",
  formations: { kind: "framework-battle-formations-v1", id: "controlled-normal", weights: [1, 0, 0, 0, 0, 0] },
  scripts: [] as { id: number; sourceHash: string; reason: string }[], flagGroups: [] });

function fixture() {
  const f = encounterRuntimeFixture();
  f.tables["monster_party.csv"] = f.input.encounters.map(encounter => ({ id: String(encounter.partyId),
    battle_background_asset_id: String(encounter.metadata.backgroundId), battle_bgm_asset_id: String(encounter.metadata.bgmId),
    appearance_production: String(encounter.metadata.appearanceProduction), not_escape: String(encounter.metadata.notEscape) }));
  f.tables["battle_background_asset.csv"] = [{ id: "1", asset_name: "controlled-background" }];
  f.input.handoff = { policy: handoff };
  const rawBase = sourceNewGameFixture().battle;
  rawBase.encounters = {}; rawBase.common.drops = { kind: "battle-drops-v1", weights: [100, 0, 0, 0, 0, 0, 0, 0], monsters: [], contents: [] };
  const { contentHash: _, ...body } = rawBase;
  const base = { ...body, contentHash: hash(body) };
  assertSourceGameCatalog(base);
  return { ...f, base };
}

test("directory entry binding does not turn one unsupported formation into an all-or-none build", async () => {
  const f = fixture(), api = await producer();
  f.input.encounters[1]!.patterns = [0, 0, 0, 0, 0, 1];
  f.input.development = await api.compileSourceBattleDirectoryEntryPolicy({ compiledDir, policy: policy(), encounters: f.input.encounters });
  const runtime = compileBattleEncounterRuntime(f.reader(), f.input);
  assert.ok(runtime.encounters[9201]); assert.equal(runtime.encounters[9202], undefined);
  assert.ok(runtime.diagnostics.some(d => d.partyId === 9202 && d.kind === "blocked" && d.code === "formation-selection"));
  const before = canonical(f.base), result = await api.composeFrameworkBattleDirectory({ compiledDir, baseCatalog: f.base, runtime });
  assert.ok(result.catalog.encounters[9201]); assert.equal(result.catalog.encounters[9202], undefined);
  assert.deepEqual(result.catalog.encounterReport.entries.map((entry: { partyId: number }) => entry.partyId), [9201, 9202]);
  assert.equal(canonical(result.catalog.gameState), canonical(f.base.gameState));
  const { drops: _beforeDrops, ...beforeCommon } = f.base.common;
  const { drops: _afterDrops, ...afterCommon } = result.catalog.common;
  assert.equal(canonical(beforeCommon), canonical(afterCommon)); assert.equal(canonical(f.base), before);
  assertSourceGameCatalog(result.catalog, "framework");
  assert.throws(() => assertSourceGameCatalog(result.catalog), /development omission/);
});

test("directory keeps conditional AI/effect gaps and never claims them as ordinary ready content", async () => {
  const f = fixture(), api = await producer();
  f.input.abilities = structuredClone(f.input.abilities);
  f.input.abilities[13]!.plan = null; f.input.abilities[13]!.blockers = ["Controlled unsupported ability"];
  const runtime = compileBattleEncounterRuntime(f.reader(), f.input);
  const result = await api.composeFrameworkBattleDirectory({ compiledDir, baseCatalog: f.base, runtime });
  assert.equal(result.catalog.encounterReport.entries.length, 2);
  assert.ok(result.catalog.encounterDiagnostics.some((d: { kind: string; code: string }) => d.kind === "runtime-dependency" && d.code === "ability-plan"));
  assert.equal(canonical(result.catalog.gameState), canonical(f.base.gameState));
});

test("exact source-bound omissions reject changed or unused script declarations", async () => {
  const f = fixture(), api = await producer(), declaration = policy();
  const script = { data: { Name: "Controlled shared entry", Mnemonics: [] }, source: structuredClone(f.aiIdentity) };
  f.input.encounters[0]!.metadata.scriptId = 8010; f.input.encounters[0]!.script = script;
  declaration.scripts = [{ id: 8010, sourceHash: hash(script), reason: "Explicit controlled Web entry" }];
  const bound = await api.compileSourceBattleDirectoryEntryPolicy({ compiledDir, policy: declaration, encounters: f.input.encounters });
  assert.deepEqual(bound.scripts[0].source, script.source);
  script.data.Name = "Changed";
  await assert.rejects(api.compileSourceBattleDirectoryEntryPolicy({ compiledDir, policy: declaration, encounters: f.input.encounters }), /changed or conflicting/);
  f.input.encounters[0]!.metadata.scriptId = 0; f.input.encounters[0]!.script = null;
  await assert.rejects(api.compileSourceBattleDirectoryEntryPolicy({ compiledDir, policy: declaration, encounters: f.input.encounters }), /Missing/);
});

test("new missing owned drop definitions block affected parties without changing the source owner", async () => {
  const f = fixture(), api = await producer(), runtime = compileBattleEncounterRuntime(f.reader(), f.input);
  runtime.drops.monsters[0]!.rate = 100; runtime.drops.monsters[0]!.slots[0] = { contentId: 999999, count: 1 };
  runtime.drops.contents.push({ id: 999999, kind: "item" });
  const result = await api.composeFrameworkBattleDirectory({ compiledDir, baseCatalog: f.base, runtime });
  assert.equal(result.catalog.encounters[9201], undefined); assert.ok(result.catalog.encounters[9202]);
  assert.ok(result.catalog.encounterDiagnostics.some((d: { code: string }) => d.code === "directory-owned-drop-content"));
  assert.equal(canonical(result.catalog.gameState), canonical(f.base.gameState));
  assert.equal(result.catalog.common.drops.contents.some((item: { id: number }) => item.id === 999999), false);
});
