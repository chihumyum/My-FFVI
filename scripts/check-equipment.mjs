// Local source tests never grant equipment to the published game bootstrap.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { exportedOrdinaryWeaponEffects } from "./lib/ordinary-weapon-source.mjs";
const root = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const outDirFlag = process.argv.includes("--compiled-dir") ? "--compiled-dir" : "--dist";
const outDirIndex = process.argv.indexOf(outDirFlag);
const outDir = outDirIndex < 0 ? "dist" : process.argv[outDirIndex + 1];
if (!outDir || outDir.startsWith("--")) throw new Error("Missing compiled output directory");
const module = (path) => import(pathToFileURL(resolve(root, outDir, "src", path + ".js")).href);
const { readSnapshot, snapshotFile } = await module("compiler/integrity");
const { battleTableIndex } = await module("compiler/battle");
const { compileEquipmentCatalog, compileEquipmentParameterContext } = await module("compiler/equipment");
const { compileOrdinaryWeaponEffects } = await module("compiler/ordinary-weapon");
const { equipmentSlotAllowed, previewEquipmentChange, projectEquipmentParameters } = await module("core/equipment");
const { GameState } = await module("core/game-state");
const { hash } = await module("compiler/content");

const imported = await readSnapshot(root + "/build/import");
const battle = JSON.parse(
  snapshotFile(await readSnapshot(root + "/build/battle"), "battle.json"),
);
const tables = JSON.parse(snapshotFile(imported, "tables.json"));
const reader = battleTableIndex(tables, battle.tableSources);
const weaponEffects = exportedOrdinaryWeaponEffects(battle, reader, compileOrdinaryWeaponEffects).catalog;
const catalogIndex = process.argv.indexOf("--catalog");
const catalogPath = catalogIndex < 0 ? "build/game/opening-playable.json" : process.argv[catalogIndex + 1];
if (!catalogPath || catalogPath.startsWith("--")) throw new Error("Missing catalog path");
const catalog = JSON.parse(await readFile(resolve(root, catalogPath), "utf8"));
const { contentHash, ...catalogInput } = catalog;
assert.equal(hash(catalogInput), contentHash);
const system = catalog.gameState.equipmentSystem;
assert.ok(system);
const contentIds = tables["content.csv"]
  .filter((r) => ["2", "3"].includes(r.type_id))
  .map((r) => Number(r.id));
const characterIds = Object.values(catalog.gameState.characterInitializations).map((t) => t.initial.sourceId);
assert.equal(characterIds.length, 18);
const providers = Object.fromEntries(
  characterIds.map((id) => [
    id,
    { hasTwoSwordStyle: false, hasTwoHand: false, equipAnyJob: false },
  ]),
);
const names = new Map(
  Object.values(system.catalog.definitions).map((d) => [
    reader.row("content.csv", d.id).values.mes_id_name,
    d.name,
  ]),
);
const decoded = compileEquipmentCatalog(
  reader,
  contentIds,
  characterIds,
  (key) => {
    assert.ok(names.has(key));
    return names.get(key);
  },
  providers,
  weaponEffects,
);
assert.equal(contentIds.length, 223);
assert.deepEqual(system.catalog, decoded.catalog);
const contextChecks = [];
for (const player of catalog.common.players) {
  const context = system.contexts[player.id];
  const compiled = compileEquipmentParameterContext(
    reader,
    player.sourceId,
    {
      additional: context.parameters.additional,
      correction: context.parameters.correction,
      temporary: context.parameters.temporary,
      passive: context.parameters.passive,
      condition601: context.parameters.condition601,
      twoHandMultiplier: context.parameters.twoHandMultiplier,
    },
    {
      additionalStrength: context.physical.strength.additional,
      correctionStrength: context.physical.strength.correction,
      temporary: context.physical.temporary,
    },
  );
  assert.deepEqual(compiled.context, context);
  assert.deepEqual(compiled.limits, system.limits);
  const slots = system.catalog.characters[player.sourceId].initialSlots;
  const projected = projectEquipmentParameters(
    system.catalog,
    slots,
    context,
    system.limits,
  );
  contextChecks.push({
    playerId: player.id,
    context,
    sources: compiled.sources,
    projection: projected,
  });
}
const make = () =>
  new GameState(
    catalog.gameState,
    catalog.common.players,
    catalog.contentHash,
    catalog.common.conditions,
  );
const owned = make(),
  initial = owned.snapshot();
assert.equal(initial.formatVersion, 10);
assert.deepEqual(initial.equipmentStock, [
  { id: 93, count: 5 },
  { id: 95, count: 1 },
  { id: 104, count: 2 },
  { id: 197, count: 5 },
  { id: 198, count: 5 },
  { id: 199, count: 5 },
  { id: 200, count: 11 },
  { id: 201, count: 3 },
  { id: 216, count: 3 },
  { id: 244, count: 3 },
]);
assert.ok(owned.equipmentInventory.every((s) => s.available === 0));
assert.deepEqual(owned.partyPlayers()[0].physical, {
  attack: 42,
  strength: 31,
  accuracy: 100,
  criticalRate: 3,
});
assert.throws(() => owned.changeEquipment("player:1", 1, 104), /No available/);
assert.deepEqual(owned.snapshot(), initial);
const slotChecks = [];
for (const player of initial.roster) {
  const owner = system.catalog.characters[player.sourceId];
  assert.deepEqual(owner.emptySlots, [93, 93, 198, 199, 200, 200]);
  for (let slot = 1; slot <= 6; slot++) {
    const original = player.equipment[slot - 1],
      empty = owner.emptySlots[slot - 1];
    assert.equal(
      owned.changeEquipment(player.id, slot, empty),
      original !== empty,
    );
    assert.deepEqual(owned.snapshot().equipmentStock, initial.equipmentStock);
    const projection = owned.partyPlayers().find((p) => p.id === player.id);
    assert.equal(
      owned.changeEquipment(player.id, slot, original),
      original !== empty,
    );
    assert.deepEqual(owned.snapshot(), initial);
    slotChecks.push({ playerId: player.id, slot, original, empty, projection });
  }
}
// Real starting copies only: release Terra's weapon, move it left, then use a
// soldier's released sword. The second real weapon removes the opposite hand.
owned.changeEquipment("player:1", 1, 93);
owned.changeEquipment("player:1", 2, 95);
assert.deepEqual(owned.snapshot().roster[0].equipment.slice(0, 2), [93, 95]);
assert.deepEqual(owned.partyPlayers()[0].physical, {
  attack: 42,
  strength: 31,
  accuracy: 100,
  criticalRate: 3,
});
owned.changeEquipment("player:31", 1, 93);
owned.changeEquipment("player:1", 1, 104);
assert.deepEqual(owned.snapshot().roster[0].equipment.slice(0, 2), [104, 93]);
assert.deepEqual(owned.partyPlayers()[0].physical, {
  attack: 50,
  strength: 31,
  accuracy: 100,
  criticalRate: 3,
});
assert.equal(owned.equipmentInventory.find((s) => s.id === 95).available, 1);
assert.deepEqual(owned.snapshot().equipmentStock, initial.equipmentStock);
const transferred = owned.snapshot();
const restored = make();
restored.restore(JSON.parse(JSON.stringify(transferred)));
assert.deepEqual(restored.snapshot(), transferred);
assert.deepEqual(restored.partyPlayers(), owned.partyPlayers());
const forged = structuredClone(transferred);
forged.equipmentStock.find((s) => s.id === 104).count = 1;
assert.throws(() => restored.restore(forged), /exceeds owned count/);
assert.deepEqual(restored.snapshot(), transferred);
const lease = owned.openBattle(3),
  beforeBattle = owned.snapshot();
assert.throws(() => owned.changeEquipment("player:1", 1, 93), /reserved/);
assert.deepEqual(owned.snapshot(), beforeBattle);
const battlePlayers = owned.battlePlayers(lease);
const grown = battlePlayers[0];
const growthPlan = catalog.gameState.characterGrowth[grown.id];
const targetLevel = grown.level + 2;
const awarded = growthPlan.experience.find((row) => row.level === targetLevel).totalExp - grown.exp;
assert.ok(awarded > 0);
const progression = owned.battleProgression(lease);
const growthProjection = progression(grown, awarded, []);
Object.assign(grown, growthProjection);
for (const player of battlePlayers.slice(1)) Object.assign(player, progression(player, 0, []));
assert.equal(grown.level, targetLevel);
const growthGroup = catalog.common.players[0].growthGroup;
const increments = system.growth[growthGroup].filter(
  (g) => g.level > initial.roster[0].level && g.level <= grown.level,
);
assert.equal(increments.length, 2);
assert.equal(
  growthProjection.maxHp,
  initial.roster[0].maxHp + increments.reduce((n, g) => n + g.hp, 0),
);
assert.equal(
  growthProjection.maxMp,
  initial.roster[0].maxMp + increments.reduce((n, g) => n + g.mp, 0),
);
assert.deepEqual(owned.snapshot(), beforeBattle, "growth projection must not mutate the owner");
const result = {
  players: battlePlayers,
  gil: 0,
  consumedItems: [],
  awardedExperience: battlePlayers.map((player) => ({ id: player.id, amount: player.id === grown.id ? awarded : 0 })),
  observedAbilityIds: [],
};
const { awardedExperience, ...withoutAwards } = result;
assert.throws(() => owned.prepareVictory(lease, withoutAwards), /experience award/);
const { observedAbilityIds, ...withoutObservations } = result;
assert.throws(() => owned.prepareVictory(lease, withoutObservations), /ability observations/);
const wrongGrowth = structuredClone(result);
wrongGrowth.players[0].level++;
assert.throws(() => owned.prepareVictory(lease, wrongGrowth), /growth projection/);
assert.deepEqual(owned.snapshot(), beforeBattle);
const commitVictory = owned.prepareVictory(lease, result);
assert.deepEqual(owned.snapshot(), beforeBattle, "victory preparation keeps EXP, gear and receipts private");
commitVictory();
const grownSave = owned.snapshot();
assert.equal(grownSave.roster[0].growth.additionalExp, beforeBattle.roster[0].growth.additionalExp + awarded);
assert.equal(grownSave.roster[0].level, targetLevel);
assert.equal(grownSave.roster[0].exp, grown.exp);
assert.equal(grownSave.roster[0].hp, beforeBattle.roster[0].hp);
assert.equal(grownSave.roster[0].mp, beforeBattle.roster[0].mp);
assert.deepEqual(grownSave.equipmentStock, beforeBattle.equipmentStock);
assert.deepEqual(grownSave.learnedAbilityIds, beforeBattle.learnedAbilityIds);
assert.deepEqual(grownSave.completedBattles, [...beforeBattle.completedBattles, { ...lease }]);
assert.throws(commitVictory, /Stale victory/);
assert.deepEqual(owned.snapshot(), grownSave, "a repeated reward cannot award EXP twice");
restored.restore(JSON.parse(JSON.stringify(grownSave)));
assert.deepEqual(restored.snapshot(), grownSave);
assert.deepEqual(restored.partyPlayers(), owned.partyPlayers());
owned.changeEquipment("player:1", 1, 93);
owned.changeEquipment("player:1", 1, 104);
assert.deepEqual(owned.snapshot(), grownSave);
const wrongMaximum = structuredClone(grownSave);
wrongMaximum.roster[0].maxHp++;
assert.throws(() => owned.restore(wrongMaximum), /maximum disagrees/);
assert.deepEqual(owned.snapshot(), grownSave);

// Additional copies exist only in these isolated previews. This establishes
// reusable slot/job/transaction admission, never story acquisition or grants.
const controlledPreviews = [];
for (const definition of Object.values(system.catalog.definitions)) {
  if (definition.empty || definition.blockers.length) continue;
  for (const player of initial.roster) {
    const owner = system.catalog.characters[player.sourceId];
    if (!definition.jobIds.includes(owner.jobId)) continue;
    for (let slot = 1; slot <= 6; slot++) {
      if (!equipmentSlotAllowed(definition, slot, owner)) continue;
      const stock = structuredClone(initial.equipmentStock),
        existing = stock.find((s) => s.id === definition.id);
      if (existing) existing.count++;
      else stock.push({ id: definition.id, count: 1 });
      const preview = previewEquipmentChange(
        system.catalog,
        initial.roster,
        stock,
        player.id,
        slot,
        definition.id,
      );
      assert.deepEqual(preview.stock, stock);
      const loadout = preview.roster.find((p) => p.id === player.id);
      const projection = projectEquipmentParameters(
        system.catalog,
        loadout.equipment,
        system.contexts[player.id],
        system.limits,
      );
      controlledPreviews.push({
        id: definition.id,
        playerId: player.id,
        slot,
        changes: preview.changes,
        projection,
      });
    }
  }
}
const definitions = Object.values(system.catalog.definitions);
const report = {
  lane: "source-equipment-and-shared-state-projections",
  profile: catalog.common.profile,
  fieldSourceSetHash: catalog.common.fieldSourceSetHash,
  battleSourceContentHash: catalog.common.sourceContentHash,
  catalogHash: catalog.contentHash,
  counts: {
    identities: definitions.length,
    executable: definitions.filter((d) => !d.blockers.length).length,
    blocked: definitions.filter((d) => d.blockers.length).length,
    empty: definitions.filter((d) => d.empty).length,
    controlledPreviews: controlledPreviews.length,
    sourceSlots: slotChecks.length,
  },
  sources: decoded.sources,
  initial,
  contextChecks,
  slotChecks,
  transferred,
  growthProjection,
  growthTransaction: { awardedExperience, observedAbilityIds, levels: 2, after: grownSave,
    prepareAtomic: true, rejectedUnboundAwards: true, rejectedUnboundObservations: true,
    duplicateCommitRejected: true, restoredEquipmentProjection: true },
  controlledPreviews,
  blocked: definitions
    .filter((d) => d.blockers.length)
    .map((d) => ({
      id: d.id,
      equipmentId: d.equipmentId,
      kind: d.kind,
      blockers: d.blockers,
    })),
  snapshotRoundtrip: true,
  tamperedSnapshotAtomicRejection: true,
  battleIsolation: true,
  doesNotEstablish: [
    "original-game-parity",
    "full-growth-providers",
    "story-acquisition",
    "dual-wield-or-two-hand",
    "wear-passives-and-status-effects",
    "unique-action-arm-overrides",
    "equipment-drops-or-shops",
    "full-game-playability",
  ],
};
await writeFile(
  root + "/build/reports/equipment-check.json",
  JSON.stringify({ ...report, contentHash: hash(report) }, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    ...report.counts,
    contentHash: hash(report),
    runtimeTransferScenarios: 2,
    growthLevels: 2,
    snapshotRoundtrip: true,
  }),
);
