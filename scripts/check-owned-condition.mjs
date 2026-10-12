// All source callsites are decoded; admitted ones execute against controlled
// shared ownership. This is not whole-script execution or a native oracle.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
const root = fileURLToPath(new URL("..", import.meta.url));
const option = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const outDir = option("--dist", "dist");
const module = (path) => import(pathToFileURL(resolve(root, outDir, "src", path + ".js")));
const { loadCorpus } = await module("compiler/corpus");
const { readSnapshot, snapshotFile } = await module("compiler/integrity");
const { battleTableIndex } = await module("compiler/battle");
const { compileBattleConditionCatalog } = await module("compiler/conditions");
const { compileFieldConditionCatalog } = await module("compiler/field-conditions");
const { compileOwnedConditionInstruction } = await module("compiler/owned-condition");
const { executeOwnedConditionEvent } = await module("core/owned-condition");
const { GameState } = await module("core/game-state");
const { hash } = await module("compiler/content");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const reportPath = root + "build/reports/owned-condition-check.json";
await rm(reportPath, { force: true });
const corpus = await loadCorpus(root);
const battleExport = JSON.parse(snapshotFile(await readSnapshot(root + "build/battle"), "battle.json"));
const published = JSON.parse(await readFile(resolve(root, option("--catalog", "build/game/opening-playable.json")), "utf8"));
const { contentHash, ...input } = published;
assert.equal(hash(input), contentHash);
const nativeBytes = await readFile(root + "build/reports/owned-condition-native-check.json");
const native = JSON.parse(nativeBytes);
assert.equal(native.methods.length, 15);
assert.equal(native.rawRanges.length, 9);
assert.equal(native.semanticsVerified, false);
assert.ok(corpus.manifest.sources.some((source) => source.file === "GameAssembly.dll" && source.sha256 === native.nativeSha256));
const reader = battleTableIndex(corpus.tables, battleExport.tableSources);
const battle = compileBattleConditionCatalog(reader, corpus.tables["condition.csv"].map((row) => Number(row.id)), (key) => key);
const field = compileFieldConditionCatalog(reader, battle.catalog, corpus.tables["transportation.csv"].map((row) => Number(row.id)));
const magitek = battle.catalog.rules.definitions.filter((condition) => condition.type === 607);
assert.equal(magitek.length, 1);
const rowId = magitek[0].id;
assert.equal(rowId, 53);
assert.equal(battle.catalog.behaviors.find((behavior) => behavior.id === rowId)?.kind, "magitek");
assert.deepEqual(field.catalog.behaviors.find((behavior) => behavior.id === rowId), { id: rowId, kind: "none" });
const controlledStateContent = { ...structuredClone(published.gameState), fieldConditions: field.catalog };
const make = () => new GameState(controlledStateContent, published.common.players, published.contentHash, battle.catalog);
const sourceSites = [], admitted = [], blocked = [];
for (const asset of corpus.assets.filter((asset) => asset.kind === "script")) {
  asset.data.Mnemonics.forEach((raw, index) => {
    if (!["AddCondition", "RemoveCondition"].includes(raw.mnemonic)) return;
    const site = { asset: asset.id, source: asset.source, index, mnemonic: raw.mnemonic, type: raw.operands.iValues[0], target: raw.operands.iValues[1] };
    sourceSites.push(site);
    try { admitted.push({ ...site, op: compileOwnedConditionInstruction(raw, corpus.tables) }); }
    catch (error) { blocked.push({ ...site, reason: error.message }); }
  });
}
assert.equal(sourceSites.length, 210);
assert.equal(sourceSites.filter((site) => site.mnemonic === "AddCondition").length, 10);
assert.equal(sourceSites.filter((site) => site.mnemonic === "RemoveCondition").length, 200);
assert.equal(admitted.length, 8);
assert.equal(blocked.length, 202);
assert.ok(admitted.every((site) => site.type === 607 && [0, 1].includes(site.target)));
assert.equal(admitted.filter((site) => site.mnemonic === "AddCondition").length, 4);
assert.equal(admitted.filter((site) => site.mnemonic === "RemoveCondition").length, 4);
const calls = [];
for (const site of admitted) {
  const state = make(), initial = state.snapshot();
  const adding = site.op.command.kind === "add-condition";
  // Explicit controlled precondition: original source owners/HP/equipment, but
  // either no status or a previously acquired Magitek status for removal.
  for (const owner of initial.roster) owner.conditionIds = adding ? [] : [rowId];
  state.restore(initial);
  const targetIds = site.target === 0
    ? initial.party.slots[initial.party.selectedSlot].flatMap((cell) => cell.id ? [cell.id] : [])
    : initial.roster.filter((owner) => owner.sourceId === site.target).map((owner) => owner.id);
  assert.equal(targetIds.length, site.target === 0 ? 3 : 1);
  let publications = 0;
  const expected = structuredClone(initial);
  const preparedSteps = [];
  executeOwnedConditionEvent(site.op, state.fieldOwnedConditions, (steps) => {
    assert.deepEqual(state.snapshot(), initial);
    assert.deepEqual(steps.map((step) => step.targetId), targetIds);
    for (const step of steps) {
      const member = expected.roster.find((owner) => owner.id === step.targetId);
      member.conditionIds = adding ? [rowId] : [];
      assert.equal(step.setDummy, false);
      assert.equal(step.affectLeader, true);
      for (const visible of step.appearance.activeMembers)
        assert.deepEqual(visible.conditionIds, expected.roster.find((owner) => owner.id === visible.id).conditionIds);
      preparedSteps.push(structuredClone(step));
    }
    return () => { publications++; assert.deepEqual(state.snapshot(), expected); };
  });
  assert.equal(publications, 1);
  const stable = state.snapshot();
  // Already-added and already-removed instructions still have source effects.
  executeOwnedConditionEvent(site.op, state.fieldOwnedConditions, (steps) => {
    assert.equal(steps.length, targetIds.length);
    return () => { publications++; };
  });
  assert.equal(publications, 2);
  assert.deepEqual(state.snapshot(), stable);
  const restored = make(); restored.restore(JSON.parse(JSON.stringify(stable)));
  assert.deepEqual(restored.snapshot(), stable);
  const lease = restored.openBattle(1, published.encounters[1].rewardPolicy), players = restored.battlePlayers(lease);
  for (const player of players)
    assert.deepEqual(player.conditionIds, stable.roster.find((owner) => owner.id === player.id).conditionIds);
  const qualification = restored.battleInventory(lease).qualification;
  assert.ok(qualification);
  assert.deepEqual(qualification.members.map((member) => member.id), players.map((player) => player.id));
  restored.cancelBattle(lease);
  const step = restored.fieldSteps.prepareStep(1);
  assert.deepEqual(step.result.damage, []); assert.equal(step.result.soundId, null);
  step.commit(); assert.deepEqual(restored.snapshot(), stable);
  calls.push({ ...site, targetIds, preparedSteps, finalConditions: stable.roster.map(({ id, conditionIds }) => ({ id, conditionIds })),
    publications, savedAndBattleProjected: true, ordinaryFootStepUnchanged: true });
}

// Independent selector behavior on real source-owned character identities.
const selectorState = make(), selectorBefore = selectorState.snapshot();
selectorBefore.roster.forEach((owner) => { owner.conditionIds = []; });
selectorBefore.roster[0].enabled = false;
selectorBefore.party.slots[selectorBefore.party.selectedSlot][2].id = null;
selectorState.restore(selectorBefore);
const currentIds = selectorBefore.party.slots[selectorBefore.party.selectedSlot].flatMap((cell) => cell.id ? [cell.id] : []);
const current = selectorState.fieldOwnedConditions.prepare({ kind: "add-condition", conditionType: 607, target: 0 });
assert.deepEqual(current.targets, currentIds); current.commit();
const entireEnabled = selectorState.fieldOwnedConditions.prepare({ kind: "add-condition", conditionType: 607, target: -1 });
assert.deepEqual(entireEnabled.targets, selectorBefore.roster.filter((owner) => owner.enabled).map((owner) => owner.id));
entireEnabled.commit();
const disabledSource = selectorBefore.roster[0].sourceId;
const selectedDisabled = selectorState.fieldOwnedConditions.prepare({ kind: "remove-condition", conditionType: 607, target: disabledSource });
assert.deepEqual(selectedDisabled.targets, [selectorBefore.roster[0].id]); selectedDisabled.commit();
const absentSource = corpus.tables["character_status.csv"].map((row) => Number(row.id))
  .find((id) => !selectorBefore.roster.some((owner) => owner.sourceId === id));
assert.ok(absentSource);
assert.throws(() => selectorState.fieldOwnedConditions.prepare({ kind: "add-condition", conditionType: 607, target: absentSource }), /Unknown owned character status/);

const report = {
  lane: "source-field-owned-condition-calls-and-controlled-shared-state",
  parentSourceSetHash: corpus.manifest.parentSourceSetHash, sourceSetHash: corpus.manifest.sourceSetHash,
  playableContentHash: published.contentHash, nativeReportSha256: digest(nativeBytes),
  battleConditionCatalogHash: hash(battle.catalog), fieldConditionCatalogHash: hash(field.catalog),
  totalSites: sourceSites.length, admittedSites: admitted.length, blockedSites: blocked.length,
  controlledChecks: { sourceEventExecutions: calls.length * 2, saveBattleRoundTrips: calls.length,
    completedFieldSteps: calls.length, selectorCases: 4 },
  calls, blocked,
  sourceProviders: ["type607 storage", "per-target Refresh(false) and AffectLeader request", "field zero damage", "battle lease condition projection"],
  presentationScope: "These probes validate ordered host requests and atomic state; FieldGame/actor-host tests validate rendering admission separately.",
  nativeSemanticsVerified: false, originalGameExecuted: false,
  limitations: ["Only type607; type0 removal hooks, HP/death and other families remain blocked.",
    "KeepBadStatusVisual=true/unknown remains blocked by the field host.",
    "Controlled callsites are not complete scripts, story reachability, map coverage or native parity."],
};
await mkdir(root + "build/reports", { recursive: true });
const output = JSON.stringify(report, null, 2) + "\n";
await writeFile(reportPath, output);
console.log(JSON.stringify({ totalSites: report.totalSites, admittedSites: report.admittedSites, blockedSites: report.blockedSites,
  controlledChecks: report.controlledChecks, reportSha256: digest(output), nativeSemanticsVerified: false }, null, 2));
