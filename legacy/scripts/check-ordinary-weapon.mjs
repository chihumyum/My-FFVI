// Source-bound equipment admission and controlled Web execution. No native oracle.
import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { exportedOrdinaryWeaponEffects } from "./lib/ordinary-weapon-source.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const option = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const module = (name) => import(pathToFileURL(resolve(root, option("--dist", "dist"), "src", name + ".js")));
const sourceOnly = process.argv.includes("--source-only");
const output = root + `build/reports/ordinary-weapon-${sourceOnly ? "source-" : ""}check.json`;
await rm(output, { force: true });
const { loadCorpus } = await module("compiler/corpus");
const { readSnapshot, snapshotFile } = await module("compiler/integrity");
const { battleTableIndex } = await module("compiler/battle");
const { compileEquipmentCatalog } = await module("compiler/equipment");
const { compileOrdinaryWeaponEffects } = await module("compiler/ordinary-weapon");
const { compileBattleRowCatalog } = await module("compiler/battle-row");
const { equipmentAttackArm, equipmentSlotAllowed, validateEquipmentBattleRows } = await module("core/equipment");
const { projectPhysicalRows } = await module("core/battle-row");
const { calculatePhysical } = await module("core/physical");
const { GameState } = await module("core/game-state");
const { BattleGame } = await module("core/battle");
const { encounterContent } = await module("core/battle-content");
const { projectBattleFieldState } = await module("core/field-battle-entry");
const { hash } = await module("compiler/content");

const native = JSON.parse(await readFile(root + "build/reports/ordinary-weapon-native-check.json", "utf8"));
assert.equal(native.methods.length, 14); assert.equal(native.rawRanges.length, 6);
assert.equal(native.semanticsVerified, false); assert.equal(native.originalGameExecuted, false);
const corpus = await loadCorpus(root);
assert.ok(corpus.manifest.sources.some((entry) => entry.file === "GameAssembly.dll" && entry.sha256 === native.nativeSha256));
const exported = JSON.parse(snapshotFile(await readSnapshot(root + "build/battle"), "battle.json"));
assert.equal(exported.parentSourceSetHash, corpus.manifest.parentSourceSetHash);
assert.equal(hash(exported.sources), exported.sourceSetHash);
const reader = battleTableIndex(corpus.tables, exported.tableSources);
const effects = exportedOrdinaryWeaponEffects(exported, reader, compileOrdinaryWeaponEffects);
const published = JSON.parse(await readFile(resolve(root, option("--catalog", "build/game/opening-playable.json")), "utf8"));
const source = JSON.parse(await readFile(root + "build/game/opening-battle.json", "utf8"));
for (const document of [source, published]) { const { contentHash, ...body } = document; assert.equal(hash(body), contentHash); }
const templates = Object.values(source.ownedInitializations);
const equipmentStateKind = published.gameState.equipmentSystem.catalog.kind;
assert.ok(["equipment-development-v1", "source-equipment-state-v2"].includes(equipmentStateKind));
assert.equal(templates.length, equipmentStateKind === "source-equipment-state-v2" ? 27 : 18);
const providers = Object.fromEntries(templates.map((template) => [template.initial.sourceId, {
  hasTwoSwordStyle: template.equipmentCharacter.hasTwoSwordStyle,
  hasTwoHand: template.equipmentCharacter.hasTwoHand,
  equipAnyJob: template.equipmentCharacter.equipAnyJob,
}]));
const names = new Map(Object.values(published.gameState.equipmentSystem.catalog.definitions).map((item) =>
  [reader.row("content.csv", item.id).values.mes_id_name, item.name]));
const contentIds = corpus.tables["content.csv"].filter((row) => ["2", "3"].includes(row.type_id)).map((row) => Number(row.id));
const compiled = compileEquipmentCatalog(reader, contentIds, templates.map((template) => template.initial.sourceId),
  (key) => { assert.ok(names.has(key)); return names.get(key); }, providers, effects.catalog, equipmentStateKind);
const equipment = compiled.catalog, rows = compileBattleRowCatalog(reader, corpus.tables).catalog;
const definitions = Object.values(equipment.definitions), admitted = definitions.filter((item) => !item.blockers.length);
assert.equal(definitions.length, 223); assert.equal(admitted.length, 129);
const ranged = definitions.filter((item) => item.kind === "weapon" &&
  reader.row("weapon.csv", item.equipmentId).values.back_flag === "1");
assert.equal(ranged.length, 18);
const rangedAdmitted = ranged.filter((item) => !item.blockers.length);
const rangedEquip = rangedAdmitted.filter((item) => item.jobIds.length);
const noJob = rangedAdmitted.filter((item) => !item.jobIds.length);
assert.deepEqual(rangedEquip.map((item) => item.id), [162, 163, 164, 165, 166, 171, 172]);
assert.deepEqual(noJob.map((item) => item.id), [159, 160, 161]);
assert.equal(rangedAdmitted.length, 10);
assert.equal(effects.catalog.additionalAbilities.length, 19);
assert.equal(effects.sources.length, 38);
for (const item of definitions.filter((item) => item.kind === "weapon")) {
  const sourceRow = reader.row("weapon.csv", item.equipmentId).values;
  if (!item.blockers.length) {
    assert.deepEqual(item.ordinaryWeapon, { kind: "ordinary-weapon-v1", contentId: item.id,
      weaponId: item.equipmentId, typeId: Number(sourceRow.type_id), backFlag: Number(sourceRow.back_flag) });
    assert.equal(effects.catalog.additionalAbilities.some((entry) => entry.weaponId === item.equipmentId), false);
  }
}
for (const id of [103, 122]) {
  const item = equipment.definitions[id];
  assert.equal(reader.row("weapon.csv", item.equipmentId).values.process_prog, "None");
  assert.equal(item.ordinaryWeapon, null);
  assert.ok(item.blockers.some((blocker) => blocker.includes("special physical weapon provider=")));
}
for (const entry of effects.catalog.additionalAbilities) {
  const items = definitions.filter((item) => item.kind === "weapon" && item.equipmentId === entry.weaponId);
  assert.equal(items.length, 1);
  assert.equal(items[0].ordinaryWeapon, null);
  assert.ok(items[0].blockers.some((blocker) => blocker.includes(`additional ability provider=${entry.abilityId}`)));
}

let metadataProbes = definitions.length + effects.catalog.additionalAbilities.length + 2;
let rowProbes = 0, damageProbes = 0, runtimeBattles = 0, ownershipScenarios = 0, rejectionScenarios = 0;
const numeric = [], runtime = [];
for (const item of rangedEquip) {
  const owner = Object.values(equipment.characters).find((character) => item.jobIds.includes(character.jobId) &&
    !character.accessoriesOnly && equipmentSlotAllowed(item, 1, character));
  assert.ok(owner);
  const loadout = { id: "controlled:" + owner.sourceId, sourceId: owner.sourceId,
    equipment: owner.emptySlots.map((id, index) => index === 0 ? item.id : id) };
  validateEquipmentBattleRows(equipment, loadout, rows);
  const amounts = [];
  for (const actorRow of ["front", "back"]) for (const targetRow of ["front", "back"]) {
    const context = projectPhysicalRows(rows, { abilityId: 1,
      actor: { side: "player", row: actorRow, conditionTypes: [], equipment: loadout.equipment }, targetRow });
    assert.equal(context.ignoreActorPenalty, true); assert.equal(context.ignoreTargetPenalty, true); rowProbes++;
    const draws = [31, 0, 99];
    const result = calculatePhysical({ rows: context, power: 0, targetCount: 1,
      rules: { normalAttack: true, multiplyPercent: null, contentFlags: [] },
      actor: { side: "player", level: 10, attack: item.parameter.values.attack, strength: 30,
        accuracy: item.accuracy, criticalRate: item.criticalRate, attackElements: item.attackElements, conditionTypes: [] },
      target: { side: "enemy", defense: 64, evasion: 0, elementResistances: {}, conditionTypes: [] },
    }, () => draws.shift());
    assert.equal(draws.length, 0); assert.equal(result.missed, false);
    amounts.push(result.amount); damageProbes++;
  }
  assert.ok(amounts[0] > 0); assert.deepEqual(amounts, Array(4).fill(amounts[0]));
  numeric.push({ contentId: item.id, sourceId: owner.sourceId, amounts });
}

if (!sourceOnly) {
  assert.equal(published.common.profile, "narshe-playability-v35");
  assert.equal(published.common.sourceContentHash, source.contentHash);
  assert.equal(source.nativeProfile.sha256, native.nativeSha256);
  assert.deepEqual(source.ordinaryWeaponEffects, effects);
  assert.deepEqual(published.gameState.equipmentSystem.catalog, equipment);
  assert.deepEqual(published.common.battleRows, rows);
  for (const row of [...compiled.sources, ...effects.sources]) {
    const table = row.assetPath.split("/").at(-1);
    assert.deepEqual(source.tables[table][row.rowId].source, row);
  }
  const make = () => new GameState(published.gameState, published.common.players, published.contentHash, published.common.conditions);
  const bootstrap = make().snapshot();
  // CreateItems (aac310) gives five copies of each source TypeId 2 empty
  // weapon/armor. AddFromMaster (328110) adds two empty accessories for each
  // of the three initial owners. These Counts share the ordinary stock owner.
  assert.deepEqual(bootstrap.equipmentStock, [
    { id: 93, count: 5 }, { id: 95, count: 1 }, { id: 104, count: 2 },
    { id: 197, count: 5 }, { id: 198, count: 5 }, { id: 199, count: 5 }, { id: 200, count: 11 },
    { id: 201, count: 3 }, { id: 216, count: 3 }, { id: 244, count: 3 },
  ]);
  const content = encounterContent(published, Number(Object.keys(published.encounters)[0])); assert.ok(content);
  const exclusions = projectBattleFieldState(content.battleEntry,
    { mapId: 3, transportationId: 6, isSavePoint: null, beastFieldController: null, footAttributeType: null },
    published.gameState.fieldConditions.transportations);
  assert.deepEqual(exclusions.blockers, []);
  content.qualificationContext = { ...content.qualificationContext, invalidContentIds: exclusions.invalidContentIds };
  let qualifyingPairs = 0;
  for (const item of rangedEquip) for (const initialOwner of bootstrap.roster) {
    const character = equipment.characters[initialOwner.sourceId];
    if (!item.jobIds.includes(character.jobId)) continue;
    qualifyingPairs++;
    for (const arm of [1, 2]) {
      assert.equal(equipmentSlotAllowed(item, arm, character), true);
      const state = make();
      // The source ID is granted only to this isolated test owner. The official
      // bootstrap above is rechecked at the end and is never rewritten.
      state.fieldInventory.prepare({ kind: "grant-equipment", id: item.id, count: 1 }).commit();
      const stock = state.snapshot().equipmentStock;
      assert.equal(state.changeEquipment(initialOwner.id, arm, item.id), true);
      assert.deepEqual(state.snapshot().equipmentStock, stock);
      const owner = state.snapshot().roster.find((member) => member.id === initialOwner.id);
      assert.equal(equipmentAttackArm(equipment, owner.sourceId, owner.equipment), arm);
      validateEquipmentBattleRows(equipment, owner, rows);
      const save = JSON.parse(JSON.stringify(state.snapshot())), restored = make();
      restored.restore(save); assert.deepEqual(restored.snapshot(), save);
      assert.deepEqual(restored.partyPlayers(), state.partyPlayers());
      const invalid = structuredClone(save); invalid.equipmentStock.find((entry) => entry.id === item.id).count = 0;
      assert.throws(() => restored.restore(invalid), /owned count/); assert.deepEqual(restored.snapshot(), save);
      ownershipScenarios++;
      const results = [];
      for (const actorRow of ["front", "back"]) for (const targetRow of ["front", "back"]) {
        const owned = make(), input = structuredClone(save);
        const actor = input.roster.find((member) => member.id === initialOwner.id);
        actor.conditionIds = actor.conditionIds.filter((id) => id !== 53);
        const target = input.roster.find((member) => member.id !== actor.id);
        const cells = input.party.slots[input.party.selectedSlot];
        cells.find((cell) => cell.id === actor.id).row = actorRow;
        cells.find((cell) => cell.id === target.id).row = targetRow;
        owned.restore(input);
        const before = owned.snapshot(), lease = owned.openBattle(content.encounterId, content.rewardPolicy);
        const inventory = owned.battleInventory(lease), players = owned.battlePlayers(lease);
        assert.equal(inventory.qualification.members.find((member) => member.id === actor.id).equipment[arm - 1], item.id);
        const battle = new BattleGame(content, 1951, players, inventory);
        battle.combatants.forEach((unit) => { unit.atb = 0; });
        battle.players.find((member) => member.id === actor.id).atb = 100;
        assert.equal(battle.command(actor.id, 1, target.id, 1), true);
        for (let step = 0; step < 1000 && !battle.action?.resolved; step++) battle.advance(10);
        assert.equal(battle.action?.resolved, true); assert.equal(battle.action.actor, actor.id);
        const result = battle.action.results[0].effects[0];
        assert.equal(result.resource, "hp"); assert.equal(result.missed, false);
        results.push({ actorRow, targetRow, amount: result.amount });
        owned.cancelBattle(lease); assert.deepEqual(owned.snapshot(), before);
        runtimeBattles++;
      }
      assert.ok(results[0].amount > 0); assert.deepEqual(results.map((result) => result.amount), Array(4).fill(results[0].amount));
      runtime.push({ contentId: item.id, sourceId: initialOwner.sourceId, arm, results });
    }
  }
  assert.equal(qualifyingPairs, 16); assert.equal(ownershipScenarios, 32); assert.equal(runtimeBattles, 128);
  for (const id of [...noJob.map((item) => item.id), ...ranged.filter((item) => item.blockers.length).map((item) => item.id), 103, 122]) {
    const state = make(); state.fieldInventory.prepare({ kind: "grant-equipment", id, count: 1 }).commit();
    const before = state.snapshot();
    assert.throws(() => state.changeEquipment(bootstrap.roster[0].id, 1, id), /job mismatch|Unimplemented equipment effects/);
    assert.deepEqual(state.snapshot(), before); rejectionScenarios++;
  }
  assert.deepEqual(make().snapshot(), bootstrap);
}

const report = {
  lane: "source-ordinary-weapon-equipment-and-row-runtime", sourceOnly,
  sourceSetHash: corpus.manifest.sourceSetHash, nativeEvidenceHash: hash(native),
  ...(sourceOnly ? {} : { contentHash: published.contentHash, sourceContentHash: source.contentHash }),
  equipmentCatalogHash: hash(equipment), weaponEffects: effects,
  counts: { identities: definitions.length, admitted: admitted.length, blocked: definitions.length - admitted.length,
    rangedIdentities: ranged.length, ordinaryRanged: rangedAdmitted.length, equippableRanged: rangedEquip.length,
    rangedWithoutJob: noJob.length, rangedBlocked: ranged.length - rangedAdmitted.length,
    metadataProbes, rowProbes, damageProbes, ownershipScenarios, runtimeBattles, rejectionScenarios },
  ranged: ranged.map((item) => ({ contentId: item.id, weaponId: item.equipmentId,
    jobIds: item.jobIds, ordinaryWeapon: item.ordinaryWeapon, blockers: item.blockers })),
  specialPhysicalBlocked: [103, 122], numeric, runtime,
  originalGameExecuted: false, semanticsVerified: false,
  doesNotEstablish: ["source-story-acquisition", "Throw", "dual-wield-or-two-hand", "Rampage-Sketch-Throw-weapon-override",
    "additional-attack-procs", "special-weapon-formulas", "complete-weapon-media-or-animation", "original-game-dynamic-parity"],
};
await mkdir(root + "build/reports", { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ sourceOnly, ...report.counts, reportSha256: hash(report), originalGameExecuted: false }, null, 2));
