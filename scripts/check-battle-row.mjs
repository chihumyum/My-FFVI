// Source tables plus controlled Web calculations/execution. No original-game oracle.
import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
const root = fileURLToPath(new URL("..", import.meta.url));
const option = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const module = (name) => import(pathToFileURL(resolve(root, option("--dist", "dist"), "src", name + ".js")));
const sourceOnly = process.argv.includes("--source-only");
const output = root + `build/reports/battle-row-${sourceOnly ? "source-" : ""}check.json`;
await rm(output, { force: true });
const { loadCorpus } = await module("compiler/corpus");
const { readSnapshot, snapshotFile } = await module("compiler/integrity");
const { battleTableIndex } = await module("compiler/battle");
const { compileBattleRowCatalog } = await module("compiler/battle-row");
const { projectPhysicalRows } = await module("core/battle-row");
const { calculatePhysical } = await module("core/physical");
const { hash } = await module("compiler/content");
const { BattleGame } = await module("core/battle");
const { GameState } = await module("core/game-state");
const { encounterContent } = await module("core/battle-content");
const { projectBattleFieldState } = await module("core/field-battle-entry");
const native = JSON.parse(await readFile(root + "build/reports/battle-row-native-check.json", "utf8"));
assert.equal(native.methods.length, 9); assert.equal(native.rawRanges.length, 6);
assert.equal(native.semanticsVerified, false); assert.equal(native.originalGameExecuted, false);
const corpus = await loadCorpus(root);
assert.ok(corpus.manifest.sources.some((s) => s.file === "GameAssembly.dll" && s.sha256 === native.nativeSha256));
const exported = JSON.parse(snapshotFile(await readSnapshot(root + "build/battle"), "battle.json"));
const reader = battleTableIndex(corpus.tables, exported.tableSources);
const { catalog, sources } = compileBattleRowCatalog(reader, corpus.tables);
assert.equal(catalog.abilities.length, 1530); assert.equal(catalog.equipment.length, 223);
assert.deepEqual(catalog.abilities.filter((a) => a.ignoreRearguardAttack).map((a) => a.id), [124, 127, 130]);
const emptyWeapon = catalog.equipment.filter((entry) => entry.weapon?.typeId === 2);
assert.equal(emptyWeapon.length, 1);
const emptyId = emptyWeapon[0].contentId;
let metadataProbes = 0, providerProbes = 0, damageProbes = 0, runtimeProbes = 0;
for (const ability of catalog.abilities) {
  const source = reader.row("ability.csv", ability.id).values;
  assert.equal(ability.typeId, Number(source.type_id)); metadataProbes++;
}
for (const gear of catalog.equipment) {
  const content = reader.row("content.csv", gear.contentId).values;
  if (content.type_id === "3") assert.equal(gear.weapon, null);
  else {
    assert.equal(content.type_id, "2");
    const weapon = reader.row("weapon.csv", content.type_value).values;
    assert.deepEqual(gear.weapon, { typeId: Number(weapon.type_id), backFlag: Number(weapon.back_flag) });
  }
  metadataProbes++;
  // Pure provider matrix, not an equipment grant: only hand slots participate.
  const input = { abilityId: 1, actor: { side: "player", row: "back", conditionTypes: [],
    equipment: [gear.contentId, emptyId, emptyId, emptyId, emptyId, emptyId] }, targetRow: "back" };
  const ignores = gear.weapon !== null && gear.weapon.typeId !== 2 && gear.weapon.backFlag === 1;
  assert.deepEqual(projectPhysicalRows(catalog, input), { actor: "back", target: "back",
    ignoreActorPenalty: ignores, ignoreTargetPenalty: ignores }); providerProbes++;
}
const players = [1, 31, 32].map((sourceId) => {
  const values = reader.row("character_status.csv", sourceId).values;
  return { sourceId, equipment: Array.from({ length: 6 }, (_, n) => Number(values[`content_id${n + 1}`])) };
});
for (const player of players) {
  for (const abilityId of [1, 124, 127, 130]) {
    const request = { abilityId, actor: { side: "player", row: "back", equipment: player.equipment, conditionTypes: [607] }, targetRow: "back" };
    assert.deepEqual(projectPhysicalRows(catalog, request), { actor: "back", target: "back",
      ignoreActorPenalty: abilityId !== 1, ignoreTargetPenalty: false }); providerProbes++;
  }
  for (const actor of ["front", "back"]) for (const target of ["front", "back"]) {
    const rows = projectPhysicalRows(catalog, { abilityId: 1,
      actor: { side: "player", row: actor, equipment: player.equipment, conditionTypes: [607] }, targetRow: target });
    const input = { rows, power: 0, rules: { normalAttack: true, multiplyPercent: null, contentFlags: [] },
      actor: { side: "player", level: 10, attack: 40, strength: 30, accuracy: 100, criticalRate: 3, attackElements: [], conditionTypes: [607] },
      target: { side: "enemy", defense: 64, evasion: 0, elementResistances: {}, conditionTypes: [] }, targetCount: 1 };
    const draws = [31, 0, 99], result = calculatePhysical(input, () => draws.shift());
    const expected = actor === "front" ? (target === "front" ? 73 : 36) : (target === "front" ? 36 : 18);
    assert.equal(result.amount, expected); assert.equal(draws.length, 0); damageProbes++;
  }
}
const rangedEquipment = catalog.equipment.filter((entry) => entry.weapon?.backFlag === 1).map((entry) => entry.contentId);
assert.equal(rangedEquipment.length, 18);
const report = {
  lane: "source-front-back-row-compiler-and-owned-battle-runtime", nativeEvidenceHash: hash(native),
  sourceSetHash: corpus.manifest.sourceSetHash, catalogHash: hash(catalog), sources,
  abilities: catalog.abilities.length, equipment: catalog.equipment.length, metadataProbes, providerProbes, damageProbes,
  runtimeProbes, players, rangedEquipment, runtime: [],
  originalGameExecuted: false, semanticsVerified: false,
  blockers: ["special-ranged-equipment-and-dual-wield-admission", "machine-physical-item-provider", "Jump-and-special-action-execution",
    "change-row-command", "back-pincer-side-formations", "original-game-dynamic-oracle"],
};
if (!sourceOnly) {
  const published = JSON.parse(await readFile(resolve(root, option("--catalog", "build/game/opening-playable.json")), "utf8"));
  const source = JSON.parse(await readFile(root + "build/game/opening-battle.json", "utf8"));
  for (const document of [source, published]) { const { contentHash, ...body } = document; assert.equal(hash(body), contentHash); }
  assert.equal(published.common.profile, "narshe-playability-v26");
  assert.equal(published.common.sourceContentHash, source.contentHash);
  assert.equal(source.nativeProfile.sha256, native.nativeSha256);
  assert.deepEqual(published.common.battleRows, catalog);
  for (const row of sources) {
    const table = row.assetPath.split("/").at(-1);
    assert.deepEqual(source.tables[table][row.rowId].source, row);
  }
  const rangedDefinitions = rangedEquipment.map((id) => published.gameState.equipmentSystem.catalog.definitions[id]);
  const ordinary = rangedDefinitions.filter((item) => !item.blockers.length);
  assert.deepEqual(ordinary.map((item) => item.id), [159, 160, 161, 162, 163, 164, 165, 166, 171, 172]);
  for (const item of ordinary) {
    assert.equal(item.ordinaryWeapon.backFlag, 1);
    assert.equal(item.ordinaryWeapon.contentId, item.id);
    assert.equal(item.ordinaryWeapon.weaponId, item.equipmentId);
  }
  const withoutJob = ordinary.filter((item) => !item.jobIds.length);
  assert.deepEqual(withoutJob.map((item) => item.id), [159, 160, 161]);
  const blocked = rangedDefinitions.filter((item) => item.blockers.length);
  assert.equal(blocked.length, 8);
  assert.ok(blocked.every((item) => item.ordinaryWeapon === null));
  report.rangedAdmission = { ordinary: ordinary.length, equippable: ordinary.length - withoutJob.length,
    withoutJob: withoutJob.length, blocked: blocked.length };
  const content = encounterContent(published, Number(Object.keys(published.encounters)[0]));
  const exclusions = projectBattleFieldState(content.battleEntry,
    { mapId: 3, transportationId: 6, isSavePoint: null, beastFieldController: null, footAttributeType: null },
    published.gameState.fieldConditions.transportations);
  assert.deepEqual(exclusions.blockers, []);
  content.qualificationContext = { ...content.qualificationContext, invalidContentIds: exclusions.invalidContentIds };
  for (const player of players) {
    const results = [];
    for (const row of ["front", "back"]) {
      const owned = new GameState(published.gameState, published.common.players, published.contentHash, content.conditions);
      const snapshot = owned.snapshot();
      const cell = snapshot.party.slots[snapshot.party.selectedSlot].find((entry) => entry.id &&
        snapshot.roster.find((member) => member.id === entry.id).sourceId === player.sourceId);
      assert.ok(cell); cell.row = row;
      // Controlled ordinary battle context: remove the source-owned Magitek row
      // through a validated snapshot, never grant an ability or equipment item.
      const owner = snapshot.roster.find((member) => member.sourceId === player.sourceId);
      owner.conditionIds = owner.conditionIds.filter((id) => id !== 53);
      owned.restore(snapshot);
      assert.equal(owned.activeParty.find((member) => member.id === owner.id).row, row);
      const before = owned.snapshot(), lease = owned.openBattle(content.encounterId);
      const battle = new BattleGame(content, 1951, owned.battlePlayers(lease), owned.battleInventory(lease));
      battle.combatants.forEach((unit) => { unit.atb = 0; });
      const actor = battle.players.find((member) => member.id === owner.id); actor.atb = 100;
      assert.equal(actor.row, row);
      assert.equal(battle.canUse(actor.id, 1, 1), true);
      assert.equal(battle.command(actor.id, 1, battle.enemies[0].id, 1), true);
      // Retain source chanting (Attack has a nonzero wait); stop on the exact
      // logical frame that commits this action, before its presentation ends.
      for (let step = 0; step < 1000 && !battle.action?.resolved; step++) battle.advance(10);
      assert.equal(battle.action?.resolved, true);
      assert.equal(battle.action.actor, actor.id);
      const effect = battle.action.results[0].effects[0];
      assert.equal(effect.resource, "hp"); assert.equal(effect.missed, false);
      results.push({ row, amount: effect.amount });
      owned.cancelBattle(lease); assert.deepEqual(owned.snapshot(), before);
      runtimeProbes += 7;
    }
    assert.ok(results[0].amount > results[1].amount);
    report.runtime.push({ sourceId: player.sourceId, context: "controlled-ordinary-with-source-equipment-and-owned-abilities", results });
    runtimeProbes++;
  }
  report.contentHash = published.contentHash; report.sourceContentHash = source.contentHash;
  report.runtimeProbes = runtimeProbes;
}
await mkdir(root + "build/reports", { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ sourceOnly, abilities: catalog.abilities.length, equipment: catalog.equipment.length,
  metadataProbes, providerProbes, damageProbes, runtimeProbes, rangedEquipmentMetadata: rangedEquipment.length,
  ...(report.rangedAdmission ? { rangedAdmission: report.rangedAdmission } : {}),
  blockers: report.blockers.length, reportSha256: hash(report), originalGameExecuted: false }, null, 2));
