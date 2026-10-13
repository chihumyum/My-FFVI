// Source-table, shared-owner and transaction checks, not native dynamic parity.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
assert.ok(args.length === 0 || args.length === 2 && args[0] === "--compiled-dir",
  "Use --compiled-dir <directory>");
const compiledDir = resolve(root, args[1] ?? "dist");
const module = (name) => import(pathToFileURL(resolve(compiledDir, "src", name + ".js")).href);
const { readSnapshot, snapshotFile } = await module("compiler/integrity");
const { loadCorpus } = await module("compiler/corpus");
const { battleTableIndex } = await module("compiler/battle");
const { compileNewGame } = await module("compiler/new-game");
const { compileOrdinaryWeaponEffects } = await module("compiler/ordinary-weapon");
const { createNewGame } = await module("core/new-game");
const { GameState } = await module("core/game-state");
const { equipmentAvailability, equipmentRegistrations, initialEquipmentStock,
  previewEquipmentChange, selectEmptyEquipment, validateEquipmentState } = await module("core/equipment");
const { hash } = await module("compiler/content");
const sha = (data) => createHash("sha256").update(data).digest("hex");
const reportPath = root + "build/reports/empty-equipment-check.json";
await mkdir(root + "build/reports", { recursive: true });
await rm(reportPath, { force: true });
execFileSync(process.execPath, [root + "scripts/check-empty-equipment-native.mjs"], { cwd: root, stdio: "pipe" });
const nativeBytes = await readFile(root + "build/reports/empty-equipment-native-check.json");
const native = JSON.parse(nativeBytes);
const imported = await readSnapshot(root + "build/import");
const project = JSON.parse(snapshotFile(imported, "project.json"));
const battle = JSON.parse(snapshotFile(await readSnapshot(root + "build/battle"), "battle.json"));
const field = JSON.parse(snapshotFile(await readSnapshot(root + "build/field"), "field.json"));
const corpus = await loadCorpus(root);
assert.equal(corpus.manifest.parentSourceSetHash, project.sourceSetHash);
assert.equal(battle.parentSourceSetHash, project.sourceSetHash);
assert.equal(corpus.manifest.sources.find((s) => s.file === "GameAssembly.dll")?.sha256, native.nativeSha256);
const reader = () => battleTableIndex(corpus.tables, battle.tableSources);
const extra = corpus.assets.filter((asset) => asset.source.assetPath ===
  "Assets/GameAssets/Serial/Data/BattleExtraData/battle_extra_data.json");
assert.equal(extra.length, 1);
const effects = compileOrdinaryWeaponEffects(reader(), extra[0].data).catalog;
const name = (key) => {
  const value = field.messages.system_zhc[key];
  assert.equal(typeof value, "string", "Missing exact source name: " + key);
  return value;
};
const beforeSource = hash(corpus.tables);
const initialization = compileNewGame(reader(), corpus.tables, name, effects);
const plan = createNewGame(initialization.definition);
const catalog = JSON.parse(await readFile(root + "build/game/opening-playable.json", "utf8"));
const { contentHash, ...content } = catalog;
assert.equal(hash(content), contentHash);
assert.equal(catalog.common.profile, "narshe-playability-v35");
const system = catalog.gameState.equipmentSystem;
assert.ok(system);
const emptyIds = [93, 197, 198, 199, 200];
const emptyStock = [{ id: 93, count: 5 }, { id: 197, count: 5 }, { id: 198, count: 5 },
  { id: 199, count: 5 }, { id: 200, count: 11 }];
const empty = (stock) => stock.filter((s) => system.catalog.definitions[s.id]?.empty);
const make = () => GameState.createNewGame(catalog.gameState, catalog.common.players,
  catalog.contentHash, catalog.common.conditions);
const checks = [];
const check = (name, run) => { run(); checks.push({ name, pass: true }); };

check("five real empty identities are exactly Weapon/Armor.TypeId2", () => {
  const found = corpus.tables["content.csv"].filter((c) => ["2", "3"].includes(c.type_id))
    .filter((c) => reader().row(c.type_id === "2" ? "weapon.csv" : "armor.csv", c.type_value).values.type_id === "2")
    .map((c) => Number(c.id));
  assert.deepEqual(found, emptyIds);
  assert.deepEqual(Object.values(system.catalog.definitions).filter((d) => d.empty).map((d) => d.id), emptyIds);
  for (const id of emptyIds) assert.equal(system.catalog.definitions[id].blockers.length, 0);
});
check("CreateItems gives five each and AddFromMaster adds every initial slot including two empty accessories", () => {
  assert.deepEqual(initialization.definition.emptyEquipmentGrants, emptyIds.map((id) => ({ id, count: 5 })));
  const expected = initialEquipmentStock(initialization.definition.equipment, plan.owned.roster,
    [...initialization.definition.inventory.filter((g) => g.kind === "equipment").map(({ id, count }) => ({ id, count })),
      ...initialization.definition.emptyEquipmentGrants]);
  assert.deepEqual(plan.owned.equipmentStock, expected);
  assert.deepEqual(empty(plan.owned.equipmentStock), emptyStock);
  assert.ok(!Object.hasOwn(plan.nativeInitialization, "emptyEquipmentStocks"), "No second empty owner");
});
check("published shared owner is bound to the same source initialization and complete stock", () => {
  assert.deepEqual(catalog.gameState.sourceNewGame, initialization.definition);
  assert.deepEqual(system.initialStock, plan.owned.equipmentStock);
  const fresh = make().snapshot();
  assert.equal(fresh.formatVersion, 14);
  assert.deepEqual(fresh.equipmentStock, plan.owned.equipmentStock);
  assert.ok(fresh.roster.every((p) => p.conditionIds.length === 0), "Fresh source state does not borrow checkpoint conditions");
});
check("source empty registrations include six worn accessories while material UI excludes all empties", () => {
  const owner = make(), snapshot = owner.snapshot();
  const registered = equipmentRegistrations(system.catalog, snapshot.roster.filter((p) => p.enabled), snapshot.equipmentStock);
  assert.equal(registered.find((s) => s.id === 200).equipped, 6);
  assert.equal(registered.find((s) => s.id === 200).count, 11);
  assert.deepEqual(owner.equipmentInventory, equipmentAvailability(system.catalog, snapshot.roster, snapshot.equipmentStock));
  assert.ok(owner.equipmentInventory.every((s) => !emptyIds.includes(s.id)));
  const normal = owner.fieldTreasure.read().normalOwnedItems;
  assert.deepEqual(empty(normal), emptyStock);
});
const defaults = [];
for (const character of Object.values(system.catalog.characters)) {
  check(`source default selection has six unambiguous slots for character ${character.sourceId}`, () => {
    const selected = Array.from({ length: 6 }, (_, i) => selectEmptyEquipment(system.catalog, system.initialStock, character.sourceId, i + 1));
    assert.deepEqual(selected, [93, 93, 198, 199, 200, 200]);
    defaults.push({ sourceId: character.sourceId, slots: selected });
  });
}
check("bare-hand Count0 chooses owned empty armor; all empty hand stock0 returns null", () => {
  const stock = structuredClone(system.initialStock);
  stock.find((s) => s.id === 93).count = 0;
  assert.equal(selectEmptyEquipment(system.catalog, stock, 1, 1), 197);
  assert.equal(selectEmptyEquipment(system.catalog, stock, 1, 2), 197);
  stock.find((s) => s.id === 197).count = 0;
  assert.equal(selectEmptyEquipment(system.catalog, stock, 1, 1), null);
  assert.equal(selectEmptyEquipment(system.catalog, stock, 1, 2), null);
});
check("already worn empty Count0 survives JSON restore and remains absent from new default choices", () => {
  const owner = make(), zero = owner.snapshot();
  zero.equipmentStock.find((s) => s.id === 200).count = 0;
  owner.restore(JSON.parse(JSON.stringify(zero)));
  assert.deepEqual(owner.snapshot(), zero);
  assert.equal(selectEmptyEquipment(system.catalog, zero.equipmentStock, 1, 5), null);
  assert.equal(equipmentRegistrations(system.catalog, zero.roster, zero.equipmentStock).find((s) => s.id === 200).equipped, 6);
});
const swaps = [];
for (const initial of plan.owned.roster) {
  for (let slot = 1; slot <= 6; slot++) {
    check(`source owner ${initial.id} slot ${slot} SetEquip preserves all Count and round-trips`, () => {
      const owner = make(), before = owner.snapshot(), source = before.roster.find((p) => p.id === initial.id);
      const old = source.equipment[slot - 1];
      const id = selectEmptyEquipment(system.catalog, before.equipmentStock, source.sourceId, slot);
      assert.notEqual(id, null);
      const changed = owner.changeEquipment(source.id, slot, id);
      assert.equal(changed, old !== id);
      assert.deepEqual(owner.snapshot().equipmentStock, before.equipmentStock);
      const saved = JSON.parse(JSON.stringify(owner.snapshot()));
      const restored = make();
      restored.restore(saved);
      assert.deepEqual(restored.snapshot(), saved);
      restored.changeEquipment(source.id, slot, old);
      assert.deepEqual(restored.snapshot(), before);
      swaps.push({ ownerId: source.id, slot, from: old, to: id });
    });
  }
}
check("missing all hand defaults rejects automatic hand conflict without publishing partial equipment", () => {
  const owner = make(), stock = owner.snapshot();
  for (const id of [93, 197]) stock.equipmentStock.find((s) => s.id === id).count = 0;
  // Release one existing soldier sword, without granting any new gear.
  const soldier = stock.roster.find((p) => p.sourceId === 31);
  soldier.equipment[0] = 93;
  validateEquipmentState(system.catalog, stock.roster, stock.equipmentStock);
  const before = structuredClone(stock);
  assert.throws(() => previewEquipmentChange(system.catalog, stock.roster, stock.equipmentStock, "player:1", 2, 104), /No owned empty/);
  assert.deepEqual(stock, before);
});
check("ordinary battle inventory uses the same material projection while owner stock keeps empty Count", () => {
  const owner = make(), before = owner.snapshot();
  const lease = owner.openBattle(3, catalog.encounters[3].rewardPolicy);
  try {
    const inventory = owner.battleInventory(lease);
    assert.ok(inventory.qualification);
    assert.ok(inventory.qualification.equipmentStock.every((s) => !emptyIds.includes(s.id)));
    assert.deepEqual(owner.snapshot(), before);
  } finally { owner.cancelBattle(lease); }
});
check("real shield re-equip clears the opposite empty Armor to the current owned default", () => {
  const owner = make(), before = owner.snapshot();
  owner.changeEquipment("player:1", 1, 197);
  owner.changeEquipment("player:1", 2, 93);
  assert.deepEqual(owner.snapshot().roster[0].equipment.slice(0, 2), [197, 93]);
  owner.changeEquipment("player:1", 2, 201);
  assert.deepEqual(owner.snapshot().roster[0].equipment.slice(0, 2), [93, 201]);
  assert.deepEqual(owner.snapshot().equipmentStock, before.equipmentStock);
});
check("new source owner AddFromMaster adds all six counts including empty slots in one shared-owner candidate", () => {
  const owner = make(), before = owner.snapshot();
  const template = Object.values(catalog.gameState.characterInitializations).find((t) => t.initial.sourceId === 2);
  assert.ok(template);
  const expected = new Map(before.equipmentStock.map(({ id, count }) => [id, count]));
  for (const id of template.initial.equipment)
    expected.set(id, Math.min(system.catalog.limit, (expected.get(id) ?? 0) + 1));
  const transaction = owner.fieldRoster.prepare({ kind: "unlock", sourceId: 2, refreshActors: false });
  assert.deepEqual(owner.snapshot(), before, "Preparation is not publication");
  transaction.commit();
  assert.deepEqual(owner.snapshot().equipmentStock,
    [...expected].map(([id, count]) => ({ id, count })).sort((a, b) => a.id - b.id));
  assert.equal(owner.snapshot().equipmentStock.find((s) => s.id === 200).count, 13);
  const restored = make();
  restored.restore(JSON.parse(JSON.stringify(owner.snapshot())));
  assert.deepEqual(restored.snapshot(), owner.snapshot());
});
check("existing source owner secede and refit rejoin exclude empty counts and restore material copies", () => {
  const owner = make(), before = owner.snapshot();
  const remove = owner.fieldRoster.prepare({ kind: "secede", sourceId: 1, removeEquipment: true, refreshActors: true });
  assert.deepEqual(owner.snapshot(), before);
  remove.commit(); // Shared-owner transaction only; this does not execute the field actor host.
  assert.deepEqual(empty(owner.snapshot().equipmentStock), emptyStock);
  assert.equal(owner.snapshot().roster.find((p) => p.sourceId === 1).enabled, false);
  const join = owner.fieldRoster.prepare({ kind: "join", sourceId: 1, position: 0, row: "front",
    refreshActors: false, recovery: false, refitEquipment: true });
  join.commit();
  const after = owner.snapshot();
  assert.deepEqual(after.equipmentStock, before.equipmentStock);
  assert.deepEqual(after.party, before.party);
  assert.deepEqual(after.roster.map((p) => ({ id: p.id, enabled: p.enabled, equipment: p.equipment })),
    before.roster.map((p) => ({ id: p.id, enabled: p.enabled, equipment: p.equipment })));
  // Join releases the joining source job to every owner; initial Create does
  // not. The shared owner's complete state is not expected to be identical.
  const jobId = before.roster.find((p) => p.sourceId === 1).jobId;
  assert.ok(after.releasedJobIds.includes(jobId));
  assert.ok(after.roster.every((p) => p.ownedJobs.some((job) => job.id === jobId)));
  const restored = make();
  restored.restore(JSON.parse(JSON.stringify(after)));
  assert.deepEqual(restored.snapshot(), after);
});
assert.equal(hash(corpus.tables), beforeSource);
const report = {
  lane: "empty-equipment-shared-owner-source-check", parentSourceSetHash: project.sourceSetHash,
  sourceContentHash: battle.contentHash, catalogHash: catalog.contentHash,
  nativeReportSha256: sha(nativeBytes), nativeMethods: native.methods.length, nativeRawRanges: native.rawRanges.length,
  sourceDependencies: initialization.sources, initialEmptyStock: emptyStock, defaults, swaps,
  checks, passCount: checks.length, failedCount: 0,
  originalGameExecuted: false, semanticsVerified: false,
  blockers: ["same-type-tie-original-owned-order", "missing-default-null-slot-host", "unknown-hand-providers", "arbitrary-field-empty-grants"],
};
await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ checks: checks.length, defaultSlots: defaults.length * 6, sourceSwaps: swaps.length,
  nativeMethods: native.methods.length, nativeRawRanges: native.rawRanges.length, catalogHash: catalog.contentHash,
  originalGameExecuted: false }));
