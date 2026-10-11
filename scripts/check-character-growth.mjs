// Controlled source mechanisms and owned-state integration, not story coverage.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = process.argv.includes("--dist") ? process.argv[process.argv.indexOf("--dist") + 1] : "dist";
const module = (path) => import(new URL(`${outDir}/src/${path}.js`, "file://" + root));
const { loadCorpus } = await module("compiler/corpus");
const { battleTableIndex } = await module("compiler/battle");
const { readSnapshot, snapshotFile } = await module("compiler/integrity");
const { compileOwnedCharacterInitialization } = await module("compiler/owned-character");
const { compileCharacterGrowth } = await module("compiler/character-growth");
const { createOwnedCharacter } = await module("core/owned-character");
const { initialCharacterGrowth, growCharacter, expectedOwnedGrowth, validateCharacterGrowth, validateObservedLearning, firstJoinLevelAdjustments } = await module("core/character-growth");
const { projectEquipmentParameters } = await module("core/equipment");
const { recoverJoinedCharacter } = await module("core/character-recovery");
const { BattleConditions } = await module("core/battle-conditions");
const { GameState } = await module("core/game-state");
const { hash } = await module("compiler/content");
const corpus = await loadCorpus(root);
const battle = JSON.parse(snapshotFile(await readSnapshot(root + "build/battle"), "battle.json"));
const field = JSON.parse(snapshotFile(await readSnapshot(root + "build/field"), "field.json"));
const catalog = JSON.parse(await readFile(root + "build/game/opening-playable.json", "utf8"));
const native = JSON.parse(await readFile(root + "build/reports/character-growth-native-check.json", "utf8"));
const { contentHash, ...catalogInput } = catalog;
assert.equal(hash(catalogInput), contentHash);
assert.equal(native.semanticsVerified, false);
assert.equal(native.methods.length, 37);
assert.deepEqual(native.correction.values, firstJoinLevelAdjustments);
assert.ok(corpus.manifest.sources.some((s) => s.file === "GameAssembly.dll" && s.sha256 === native.nativeSha256));
const name = (key) => {
  const text = field.messages.system_zhc[key];
  assert.equal(typeof text, "string", "Missing exact source name: " + key);
  return text;
};
const reader = () => battleTableIndex(corpus.tables, battle.tableSources);
const decoded = [], blocked = [], templates = new Map(), plans = new Map();
for (const character of corpus.tables["character_status.csv"]) {
  const sourceId = Number(character.id);
  let stage = "initialization";
  try {
    const { template } = compileOwnedCharacterInitialization(reader(), corpus.tables, sourceId, name);
    stage = "growth";
    const { plan, sources } = compileCharacterGrowth(reader(), corpus.tables, template);
    templates.set(sourceId, template); plans.set(sourceId, plan);
    decoded.push({ sourceId, jobId: plan.jobId, baseExp: plan.baseExp, initialLevel: plan.initialLevel, naturalLearningRows: plan.learning.length, sources });
  } catch (error) { blocked.push({ sourceId, stage, reason: error.message }); }
}
assert.equal(decoded.length, 18);
assert.equal(blocked.length, 16);
assert.ok(blocked.every((b) => b.stage === "initialization"));
assert.equal(Object.keys(catalog.gameState.characterGrowth).length, decoded.length);
const conditionRules = new BattleConditions(catalog.common.conditions);
const equipment = catalog.gameState.equipmentSystem;
const project = (sourceId) => (member, progress) => {
  const template = templates.get(sourceId), context = structuredClone(template.parameterContext);
  for (const key of ["hp", "mp", "magic", "vitality", "agility"]) context.parameters.additional[key] += progress.additional[key];
  context.physical.strength.additional += progress.additional.strength;
  const confirmed = projectEquipmentParameters(equipment.catalog, member.equipment, context, template.limits).parameters;
  return { maxHp: confirmed.hp, maxMp: confirmed.mp };
};
let levelProbes = 0, correctionProbes = 0, naturalGrants = 0;
const battleLearningBlockers = [], projections = [];
for (const [sourceId, plan] of plans) {
  const template = templates.get(sourceId);
  const entry = Object.entries(catalog.gameState.characterInitializations).find(([, t]) => t.initial.sourceId === sourceId);
  assert.ok(entry);
  const [id, published] = entry;
  assert.deepEqual(published, template);
  assert.deepEqual(catalog.gameState.characterGrowth[id], plan);
  const initialized = createOwnedCharacter(template, { id, ownedId: 1, releasedJobIds: [], learnedAbilityIds: [] });
  let member = initialized.member, progress = initialCharacterGrowth();
  const origin = structuredClone(member), originProgress = structuredClone(progress);
  assert.deepEqual(expectedOwnedGrowth(plan, progress).abilities, member.abilities);
  try {
    growCharacter(plan, member, progress, { kind: "add-experience", amount: 0, context: "battle", observedAbilityIds: [] }, project(sourceId));
  } catch (error) {
    assert.match(error.message, /battle background|observed-ability/);
    battleLearningBlockers.push({ sourceId, reason: error.message });
  }
  validateObservedLearning(plan, member, []);
  for (let level = plan.initialLevel + 1; level <= plan.maxLevel; level++) {
    const totalExp = plan.experience.find((r) => r.level === level).totalExp;
    const next = growCharacter(plan, member, progress,
      { kind: "add-experience", amount: totalExp - member.exp, context: "field" }, project(sourceId));
    assert.equal(next.member.level, level);
    assert.equal(next.member.exp, totalExp);
    assert.equal(next.progress.additionalExp, totalExp - plan.baseExp);
    const nativeRows = corpus.tables["growth_curve.csv"].filter((r) => Number(r.group_id) === 1 && Number(r.lv) > plan.initialLevel && Number(r.lv) <= level);
    assert.equal(next.progress.additional.hp, nativeRows.reduce((n, r) => n + Number(r.hp_value1), 0));
    assert.equal(next.progress.additional.mp, nativeRows.reduce((n, r) => n + Number(r.mp_value1), 0));
    assert.equal(next.member.hp, origin.hp);
    assert.equal(next.member.mp, origin.mp);
    assert.deepEqual(next.learnedAbilityIdsToAppend, []);
    const sourceLearned = corpus.tables["learning.csv"].filter((r) => Number(r.type_id) === 1 && Number(r.job_id) === plan.jobId && Number(r.value1) === level);
    const learnedIds = sourceLearned.map((r) => Number(corpus.tables["content.csv"].find((c) => c.id === r.content_id).type_value));
    assert.deepEqual(next.steps.flatMap((s) => s.learnedAbilityIds), learnedIds);
    for (const abilityId of learnedIds) assert.equal(next.member.abilities.owned.find((a) => a.abilityId === abilityId).skillLevel, 100);
    naturalGrants += learnedIds.length;
    member = next.member; progress = next.progress;
    validateCharacterGrowth(plan, JSON.parse(JSON.stringify(member)), JSON.parse(JSON.stringify(progress)));
    levelProbes++;
  }
  const bulk = growCharacter(plan, origin, originProgress,
    { kind: "add-experience", amount: member.exp - origin.exp, context: "field" }, project(sourceId));
  assert.deepEqual(bulk.member, member);
  assert.deepEqual(bulk.progress, progress);
  for (const targetLevel of [...new Set([plan.initialLevel + 1, 6, 99])]) {
    const corrected = growCharacter(plan, origin, originProgress, { kind: "correct-level", targetLevel }, project(sourceId));
    assert.equal(corrected.progress.additionalExp, Number(corpus.tables["exp_table.csv"].find((r) => Number(r.id) === targetLevel).total_exp));
    assert.equal(corrected.member.exp, Math.min(plan.maxExp, plan.baseExp + corrected.progress.additionalExp));
    correctionProbes++;
  }
  projections.push({ sourceId, maxLevel: member.level, maxHp: member.maxHp, maxMp: member.maxMp,
    additional: progress.additional, ownedAbilities: member.abilities.owned.length });
}
const make = () => new GameState(catalog.gameState, catalog.common.players, contentHash, catalog.common.conditions);
const owned = make(), before = owned.snapshot();
assert.equal(before.formatVersion, 6);
assert.deepEqual(catalog.gameState.rosterLifecycle.firstJoinLevelAdjustments, firstJoinLevelAdjustments);
// Public victory integration verifies independently recomputed source additions.
const lease = owned.openBattle(1), players = owned.battlePlayers(lease);
const progression = owned.battleProgression(lease);
assert.equal(typeof progression, "function");
const awards = players.map((player) => ({ id: player.id, amount: 2000 }));
const results = players.map((player) => {
  const projected = progression(player, 2000, []);
  return { ...player, ...projected, conditionIds: conditionRules.updateDying(player.hp, projected.maxHp, player.conditionIds) };
});
const commit = owned.prepareVictory(lease, { players: results, gil: 0, consumedItems: [], awardedExperience: awards, observedAbilityIds: [] });
assert.deepEqual(owned.snapshot(), before, "victory preparation is detached");
commit();
const grown = owned.snapshot();
assert.deepEqual(grown.learnedAbilityIds, before.learnedAbilityIds);
assert.deepEqual(grown.equipmentStock, before.equipmentStock);
assert.deepEqual(grown.characterNames, before.characterNames);
assert.ok(grown.roster[0].abilities.owned.some((a) => a.skillLevel === 100 && before.roster[0].abilities.owned.find((b) => b.abilityId === a.abilityId)?.skillLevel === 0));
const restored = make(); restored.restore(JSON.parse(JSON.stringify(grown)));
assert.deepEqual(restored.snapshot(), grown);
// Nonrecipients keep growth intact but still run native ExecutionLearning.
const fallen = make(), fallenState = fallen.snapshot();
const fallenSource = fallenState.roster.find((member) => member.sourceId === 1);
assert.ok(fallenSource.abilities.owned.some((ability) => ability.abilityId === 74 && ability.skillLevel === 0));
fallenSource.hp = 0;
fallenSource.conditionIds = [catalog.common.conditions.hpZeroConditionId];
fallen.restore(fallenState);
const fallenBefore = fallen.snapshot(), fallenLease = fallen.openBattle(1);
const fallenResult = { players: fallen.battlePlayers(fallenLease), gil: 0, consumedItems: [],
  awardedExperience: fallen.battlePlayers(fallenLease).map((player) => ({ id: player.id, amount: 0 })),
  observedAbilityIds: [] };
const invalidAward = structuredClone(fallenResult);
invalidAward.awardedExperience.find((award) => award.id === fallenSource.id).amount = 1;
assert.throws(() => fallen.prepareVictory(fallenLease, invalidAward), /nonrecipient/);
assert.deepEqual(fallen.snapshot(), fallenBefore);
const observedSpecial = structuredClone(fallenResult);
observedSpecial.observedAbilityIds = [catalog.gameState.characterGrowth[fallenSource.id].observedLearningAbilityIds[0]];
assert.throws(() => fallen.prepareVictory(fallenLease, observedSpecial), /observed-ability/);
assert.deepEqual(fallen.snapshot(), fallenBefore);
fallen.prepareVictory(fallenLease, fallenResult)();
const fallenAfter = fallen.snapshot();
assert.deepEqual(fallenAfter.roster.find((member) => member.id === fallenSource.id), fallenBefore.roster.find((member) => member.id === fallenSource.id));
assert.deepEqual(fallenAfter.learnedAbilityIds, fallenBefore.learnedAbilityIds);
const fallenRestore = make(); fallenRestore.restore(JSON.parse(JSON.stringify(fallenAfter)));
assert.deepEqual(fallenRestore.snapshot(), fallenAfter);
const invalidSaves = [];
for (const [label, mutate] of Object.entries({
  "additional-exp": (s) => s.roster[0].growth.additionalExp++,
  "additional-hp": (s) => s.roster[0].growth.additional.hp++,
  "additional-strength": (s) => s.roster[0].growth.additional.strength++,
  "learned-flag": (s) => s.roster[0].abilities.owned[0].skillLevel--,
  "owned-order": (s) => s.roster[0].abilities.owned.reverse(),
  "learning-order": (s) => s.roster[0].abilities.additionOrder.reverse(),
  "max-hp": (s) => s.roster[0].maxHp++,
  "global-history": (s) => s.learnedAbilityIds.push(99999),
})) {
  const invalid = structuredClone(grown); mutate(invalid);
  assert.throws(() => restored.restore(invalid), label);
  assert.deepEqual(restored.snapshot(), grown, label + " must not publish");
  invalidSaves.push(label);
}
// The owned-state portion of a real source join shares correction and recovery.
// Field presentation preparation is a separate host acceptance lane.
const joining = make(), joinBefore = joining.snapshot();
const transaction = joining.fieldRoster.prepare({ kind: "join", sourceId: 2, position: null, row: "front",
  recovery: true, refitEquipment: false, refreshActors: false });
assert.deepEqual(joining.snapshot(), joinBefore);
transaction.commit();
const joined = joining.snapshot(), newOwner = joined.roster.find((m) => m.sourceId === 2);
assert.equal(newOwner.ownedId, 4); assert.equal(newOwner.level, 5); assert.equal(newOwner.exp, 400);
assert.equal(newOwner.hp, newOwner.maxHp); assert.equal(newOwner.mp, newOwner.maxMp);
assert.deepEqual(newOwner.conditionIds, []);
assert.deepEqual(joined.learnedAbilityIds, [...joinBefore.learnedAbilityIds, 229]);
const joinedRestore = make(); joinedRestore.restore(JSON.parse(JSON.stringify(joined)));
assert.deepEqual(joinedRestore.snapshot(), joined);
// Source admitted death/poison/silence/dying are cleared; unknown mechanics fail.
let recoveryProbes = 0;
for (const behavior of catalog.common.conditions.behaviors) {
  const damaged = { ...structuredClone(newOwner), hp: behavior.kind === "unable-fight" ? 0 : 1, mp: 0, conditionIds: [behavior.id] };
  const healed = recoverJoinedCharacter(damaged, conditionRules);
  assert.equal(healed.hp, healed.maxHp); assert.equal(healed.mp, healed.maxMp);
  assert.deepEqual(healed.conditionIds, []); assert.deepEqual(damaged.conditionIds, [behavior.id]);
  recoveryProbes++;
}
const report = { lane: "controlled-source-character-growth-and-owned-integration", sourceSetHash: corpus.sourceSetHash,
  catalogHash: contentHash, nativeSha256: native.nativeSha256, decoded, blocked, battleLearningBlockers, projections, invalidSaves,
  newOwner: { sourceId: 2, ownedId: newOwner.ownedId, level: newOwner.level, exp: newOwner.exp, hp: newOwner.hp, mp: newOwner.mp, growth: newOwner.growth },
  acceptance: { sourcePlans: decoded.length, sourceInitializationBlockers: blocked.length, levelProbes, correctionProbes, naturalGrants,
    battleLearningBlockers: battleLearningBlockers.length, recoveryProbes, invalidSavesRejected: invalidSaves.length,
    sourceCatalogMatches: true, sourceVictoryAtomic: true, sourceJoinAtomic: true, jsonRoundTrip: true,
    sourceNonrecipientGrowthPreserved: true, sourceNonrecipientObservationGuard: true,
    originalRuntimeOracle: false, newStoryMaps: 0, newCharacterBattleDefinitions: 0 } };
await writeFile(root + "build/reports/character-growth-check.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ ...report.acceptance, reportHash: hash(report) }, null, 2));
