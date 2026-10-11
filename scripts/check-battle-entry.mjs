// Real source compilation plus controlled provider probes. The source-bound
// prelude checkpoint is not execution of that prelude or a new formal save.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
const root = fileURLToPath(new URL("..", import.meta.url));
const option = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const outDir = option("--dist", "dist");
const module = (path) => import(pathToFileURL(resolve(root, outDir, "src", path + ".js")));
const { loadCorpus } = await module("compiler/corpus");
const { readSnapshot, snapshotFile } = await module("compiler/integrity");
const { battleTableIndex } = await module("compiler/battle");
const { compileBattleEntryCatalog, compileNarsheOwnedConditionCheckpoint } = await module("compiler/battle-entry");
const { projectFieldInvalidContents, projectBeastField, projectBattleItemMenu, battleUseInvalidContents, appendSelectedPartyCondition } = await module("core/battle-entry");
const { projectBattleAbilities } = await module("core/battle-abilities");
const { equipmentAvailability } = await module("core/equipment");
const { GameState } = await module("core/game-state");
const { hash } = await module("compiler/content");
const corpus = await loadCorpus(root);
const battleExport = JSON.parse(snapshotFile(await readSnapshot(root + "build/battle"), "battle.json"));
const published = JSON.parse(await readFile(resolve(root, option("--catalog", "build/game/opening-playable.json")), "utf8"));
const source = JSON.parse(await readFile(resolve(root, option("--source", "build/game/opening-battle.json")), "utf8"));
for (const document of [source, published]) {
  const { contentHash, ...input } = document;
  assert.equal(hash(input), contentHash);
}
const native = JSON.parse(await readFile(root + "build/reports/battle-entry-native-check.json", "utf8"));
assert.equal(native.methods.length, 43);
assert.equal(native.rawRanges.length, 15);
assert.equal(native.semanticsVerified, false);
assert.ok(corpus.manifest.sources.some((s) => s.file === "GameAssembly.dll" && s.sha256 === native.nativeSha256));
assert.equal(source.parentSourceSetHash, corpus.manifest.parentSourceSetHash);
const reader = battleTableIndex(corpus.tables, battleExport.tableSources);
const misc = corpus.assets.filter((a) => a.source.assetPath === "Assets/GameAssets/Serial/Data/Misc/serial_misc_assets.json");
assert.equal(misc.length, 1);
const compiled = compileBattleEntryCatalog(reader, corpus.tables, misc[0]);
const checkpoint = compileNarsheOwnedConditionCheckpoint(reader, corpus.tables, corpus.assets);
assert.deepEqual(source.entryProviders, { ...compiled, ownedConditionCheckpoint: checkpoint });
assert.equal(checkpoint.conditionType, 607);
assert.equal(checkpoint.conditionId, 53);
assert.equal(checkpoint.target, "selected-party");
assert.deepEqual(checkpoint.selectedSourceIds, [1, 31, 32]);
assert.equal(checkpoint.scripts.length, 6);
assert.equal(checkpoint.requiresBattleBehavior, "magitek-armor-and-character-size");

const { catalog } = compiled;
const transport = source.transportations.definitions.find((row) => row.id === 6);
assert.ok(transport);
const field = { mapId: 3, transportation: { id: transport.id, type: transport.type }, isSavePoint: false,
  beastField: projectBeastField({ controllerPresent: null, footAttributeType: null, transportationId: 6 }) };
const opening = projectFieldInvalidContents(catalog, field);
assert.deepEqual(opening, { invalidContentIds: [16, 17, 23, 412, 1309], blockers: [] });
assert.deepEqual(battleUseInvalidContents(opening.invalidContentIds), [16, 17, 1309]);
assert.deepEqual(projectFieldInvalidContents(catalog, { ...field, transportation: { id: 1, type: 1 } }).invalidContentIds, [16, 17, 1309]);
assert.deepEqual(projectFieldInvalidContents(catalog, { ...field, transportation: { id: 1, type: 1 }, isSavePoint: true }).invalidContentIds, [1309]);
assert.equal(projectFieldInvalidContents(catalog, { ...field, beastField: null }).invalidContentIds, null);

const state = new GameState(published.gameState, published.common.players, published.contentHash, published.common.conditions);
const snapshot = state.snapshot();
const equipment = published.gameState.equipmentSystem.catalog;
const inventory = [
  ...snapshot.items.map((row) => ({ id: row.id, count: row.count, equipped: 0 })),
  ...equipmentAvailability(equipment, snapshot.roster.filter((owner) => owner.enabled), snapshot.equipmentStock)
    .map(({ id, count, equipped }) => ({ id, count, equipped })),
];
const players = [];
for (const owner of snapshot.roster) {
  const result = projectBattleItemMenu(catalog, { sourceId: owner.sourceId, equipment: owner.equipment, inventory }, equipment);
  assert.equal(result.available, true);
  assert.equal(result.canChangeEquipment, true);
  players.push({ sourceId: owner.sourceId, ...result });
}
const selected = checkpoint.selectedSourceIds.map((sourceId) => snapshot.roster.find((owner) => owner.sourceId === sourceId).id);
const controlled = appendSelectedPartyCondition(snapshot.roster, selected, checkpoint.conditionId);
assert.deepEqual(controlled.map((owner) => owner.conditionIds), [[53], [53], [53]]);
assert.deepEqual(state.snapshot(), snapshot, "Research projection never changes the formal checkpoint");
assert.equal(published.common.qualificationContext.mode, "development-static");
assert.equal(published.common.qualificationContext.conditionContext, "unknown");

const qualified = [];
for (const owner of controlled) {
  const result = projectBattleAbilities(published.common.battleAbilities, owner, {
    conditionIds: owner.conditionIds, battleType: 0, magicLearningValue: null,
    invalidContentIds: opening.invalidContentIds, itemMenuAvailable: true, partySize: controlled.length,
  });
  const magitek = result.entries.find((entry) => entry.commandId === 26);
  assert.equal(magitek.released, true); assert.equal(magitek.available, true);
  assert.equal(result.entries.find((entry) => entry.commandId === 1).released, false);
  assert.equal(result.entries.find((entry) => entry.commandId === 3).available, true);
  qualified.push({ sourceId: owner.sourceId, magitekAbilityIds: magitek.abilityIds });
}
assert.deepEqual(qualified.filter((p) => p.sourceId !== 1).map((p) => p.magitekAbilityIds), [[218, 219, 220, 222], [218, 219, 220, 222]]);

const itemCandidates = [];
const owner = snapshot.roster[0];
const emptyEquipment = equipment.characters[owner.sourceId].emptySlots;
for (const item of catalog.items.filter((item) => item.type === 1)) {
  const result = projectBattleItemMenu(catalog, { sourceId: owner.sourceId, equipment: emptyEquipment,
    inventory: [{ id: item.id, count: 1, equipped: 0 }] }, equipment);
  assert.equal(result.canChangeEquipment, false);
  itemCandidates.push(...result.usableItemIds);
}
assert.deepEqual(itemCandidates, [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 18, 19, 20, 21, 22, 23, 24, 31, 32, 33, 34, 35, 36, 37, 38]);
// Admitted menu candidates are not grants and do not make Tools effects executable.
assert.deepEqual(state.snapshot(), snapshot);

const modifiedScripts = structuredClone(corpus.assets);
const first = modifiedScripts.find((a) => a.source.assetPath === checkpoint.scripts[0].source.assetPath);
first.data.Mnemonics[18].operands.iValues[0] = 0;
assert.throws(() => compileNarsheOwnedConditionCheckpoint(reader, corpus.tables, modifiedScripts), /needs review/);
const invalidCounts = structuredClone(inventory);
invalidCounts.push({ id: 2, count: 0, equipped: 1 });
assert.throws(() => projectBattleItemMenu(catalog, { sourceId: owner.sourceId, equipment: owner.equipment, inventory: invalidCounts }, equipment));
assert.deepEqual(state.snapshot(), snapshot);

const report = {
  lane: "source-bound-entry-providers-and-controlled-owned-condition-projection",
  sourceContentHash: source.contentHash, playableContentHash: published.contentHash,
  nativeEvidenceHash: hash(native), catalogHash: hash(catalog), checkpointHash: hash(checkpoint),
  maps: catalog.maps.length, inventoryDefinitions: catalog.items.length,
  sourceRows: compiled.sources.length, checkpointSourceRows: checkpoint.sources.length, checkpointScripts: checkpoint.scripts.length,
  sourceItemProbes: catalog.items.filter((item) => item.type === 1).length, ordinaryItemCandidates: itemCandidates,
  openingInvalidContentIds: opening.invalidContentIds, players, controlledQualification: qualified,
  formalMode: "development-static", formalOwnedCondition607: false,
  originalGameExecuted: false, semanticsVerified: false,
  blockers: ["Madou character-size and armor presentation not integrated", "general field AddCondition transaction not implemented"],
};
await mkdir(root + "build/reports", { recursive: true });
await writeFile(root + "build/reports/battle-entry-check.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ maps: report.maps, inventoryDefinitions: report.inventoryDefinitions,
  sourceItemProbes: report.sourceItemProbes, checkpointScripts: report.checkpointScripts, controlledPlayers: players.length,
  blockers: report.blockers.length, reportSha256: hash(report), originalGameExecuted: false }, null, 2));
