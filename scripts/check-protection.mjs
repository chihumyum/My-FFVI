// Source tables and controlled Web projections, not original-game execution.
import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
const root = fileURLToPath(new URL("..", import.meta.url));
const option = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const module = (name) => import(pathToFileURL(resolve(root, option("--dist", "dist"), "src", name + ".js")));
const sourceOnly = process.argv.includes("--source-only");
const outputPath = root + `build/reports/protection-${sourceOnly ? "source-" : ""}check.json`;
await rm(outputPath, { force: true });
const { loadCorpus } = await module("compiler/corpus");
const { readSnapshot, snapshotFile } = await module("compiler/integrity");
const { hash } = await module("compiler/content");
const { battleTableIndex } = await module("compiler/battle");
const { compileBattleConditionCatalog } = await module("compiler/conditions");
const { compileFieldConditionCatalog } = await module("compiler/field-conditions");
const { hasProtectionBehavior } = await module("compiler/protection");
const { compileDevelopmentAbility, compileAbilityProgram } = await module("compiler/ability");
const { BattleConditions } = await module("core/battle-conditions");
const { FieldConditions } = await module("core/field-conditions");
const { projectActionTarget } = await module("core/action-effects");
const { calculatePhysical } = await module("core/physical");
const { calculateMagic } = await module("core/magic");
const native = JSON.parse(await readFile(root + "build/reports/protection-native-check.json", "utf8"));
assert.equal(native.methods.length, 21); assert.equal(native.rawRanges.length, 5); assert.equal(native.semanticsVerified, false);
const corpus = await loadCorpus(root);
assert.ok(corpus.manifest.sources.some((s) => s.file === "GameAssembly.dll" && s.sha256 === native.nativeSha256));
const exported = JSON.parse(snapshotFile(await readSnapshot(root + "build/battle"), "battle.json"));
const reader = battleTableIndex(corpus.tables, exported.tableSources);
const rows = corpus.tables["condition.csv"].filter((r) => [19, 412].includes(Number(r.condition_type)));
assert.deepEqual(rows.map((r) => Number(r.id)), [22, 23, 93, 94]);
const admittedRows = rows.filter((values) => hasProtectionBehavior({ values }));
assert.deepEqual(admittedRows.map((r) => Number(r.id)), [22, 23]);
const { catalog } = compileBattleConditionCatalog(reader, corpus.tables["condition.csv"].map((r) => Number(r.id)), (key) => key);
const conditions = new BattleConditions(catalog);
assert.deepEqual(catalog.behaviors.filter((b) => b.kind.endsWith("-protection")).map(({ id, kind, untilType }) => ({ id, kind, untilType })), [
  { id: 22, kind: "magic-protection", untilType: 2 }, { id: 23, kind: "physical-protection", untilType: 2 },
]);
const ordinaryHit = { accuracy: 100, magicEvasion: 0, fixed: false };
const noRng = () => assert.fail("Unexpected protection random draw");
let lifecycleProbes = 0, abilityProbes = 0, damageProbes = 0, publishedProbes = 0;
for (const id of [22, 23]) {
  const before = [53];
  const first = conditions.add(before, {}, id, ordinaryHit, () => 0);
  assert.deepEqual(first.currentIds, [53, id]); lifecycleProbes++;
  assert.equal(conditions.add(first.currentIds, {}, id, ordinaryHit, noRng).missed, true); lifecycleProbes++;
  assert.equal(conditions.add(before, { [id]: 0 }, id, ordinaryHit, noRng).missed, true); lifecycleProbes++;
  assert.deepEqual(conditions.recover(first.currentIds, [id]).currentIds, before); lifecycleProbes++;
  assert.deepEqual(conditions.settleLife(0, first.currentIds, false).conditionIds, [53, 5]); lifecycleProbes++;
  assert.deepEqual(conditions.battleEnd(first.currentIds), before); lifecycleProbes++;
  assert.deepEqual(before, [53]); lifecycleProbes++;
}
assert.deepEqual(conditions.admitAtbAction([53, 22, 23, 1], [{ id: 1, type: 4 }]), [53, 22, 23]); lifecycleProbes++;
const field = compileFieldConditionCatalog(reader, catalog, [6]).catalog;
const fieldConditions = new FieldConditions(field);
for (const id of [22, 23, 93, 94]) {
  assert.throws(() => fieldConditions.validateActive([id]), /Unimplemented active field/); lifecycleProbes++;
}
for (const id of [93, 94]) { assert.throws(() => conditions.validateActive([id]), /Unimplemented active battle/); lifecycleProbes++; }
const functions = new Set(corpus.tables["function.csv"].filter((r) => r.type_id === "9").map((r) => r.id));
const groups = corpus.tables["function_group.csv"].filter((r) => [1, 2, 3].some((slot) =>
  functions.has(r[`function${slot}_id`]) && ["22", "23", "93", "94"].includes(r[`function${slot}_value1`])));
const groupIds = new Set(groups.map((r) => r.id));
const candidates = corpus.tables["ability.csv"].filter((r) => groupIds.has(r.battle_function_group_id));
assert.deepEqual(candidates.map((r) => Number(r.id)), [68, 77, 101, 242, 243, 534, 1160, 1161, 1168, 1304, 1432]);
const definitions = candidates.map((r) => compileDevelopmentAbility(reader, Number(r.id), "source-" + r.id));
const admitted = definitions.filter((d) => d.plan), blocked = definitions.filter((d) => !d.plan);
assert.deepEqual(admitted.map((d) => d.id), [68, 77, 534, 1160, 1161, 1304, 1432]);
assert.deepEqual(blocked.map((d) => d.id), [101, 242, 243, 1168]);
const participant = { id: "controlled-caster", side: "player", level: 10, attack: 0, magic: 20,
  attackElements: [], defense: 64, magicDefense: 64, evasion: 0, magicEvasion: 255,
  hp: 1000, maxHp: 1000, mp: 200, maxMp: 200, conditionIds: [53], conditionResistances: {}, elementResistances: {} };
for (const d of admitted) {
  const effect = d.plan.effects[0], flag1 = d.program.contentFlags.includes(1);
  assert.equal(effect.fixedHit, false); assert.equal(effect.accuracy, flag1 ? 255 : d.program.rules.accuracy_rate);
  const target = { ...participant, id: d.plan.targeting.relation === "self" ? participant.id : "controlled-target", magicEvasion: flag1 ? 255 : 0 };
  const before = structuredClone(target);
  const result = projectActionTarget(d.plan, d.power, participant, target, conditions, flag1 ? noRng : () => 0, 1, d.cost);
  assert.deepEqual(result.state.conditionIds, [53, effect.conditionId]); abilityProbes++;
  assert.equal(projectActionTarget(d.plan, d.power, participant, { ...target, conditionResistances: { [effect.conditionId]: 0 } }, conditions, noRng, 1).effects[0].missed, true); abilityProbes++;
  assert.equal(projectActionTarget(d.plan, d.power, participant, { ...target, conditionIds: result.state.conditionIds }, conditions, noRng, 1).effects[0].missed, true); abilityProbes++;
  assert.deepEqual(target, before); abilityProbes++;
}
for (const defense of [0, 64, 255]) for (const critical of [false, true]) for (const defended of [false, true]) {
  const input = { rows: { actor: "front", target: "front", ignoreActorPenalty: false, ignoreTargetPenalty: false }, rules: { normalAttack: true, multiplyPercent: null, contentFlags: [] }, power: 0,
    actor: { side: "player", level: 10, attackElements: [], conditionTypes: [], attack: 40, strength: 30, accuracy: 100, criticalRate: 3 },
    target: { side: "enemy", defense, evasion: 0, elementResistances: {}, conditionTypes: defended ? [19, 1] : [19] }, targetCount: 1 };
  const random = [31, 0, critical ? 0 : 99];
  let expected = Math.trunc(((255 - defense) * 64) / 256) + 1;
  if (defended) expected = Math.trunc(expected / 2);
  if (critical) expected *= 2;
  assert.equal(calculatePhysical(input, () => random.shift()).amount, expected);
  assert.equal(random.length, 0); damageProbes++;
}
for (const defense of [0, 64, 255]) for (const recovery of [false, true]) for (const forceDefense of [false, true]) {
  const input = { rules: { accuracy: 100, contentFlags: [], elements: [], forceDefense }, power: 30,
    actor: { side: "player", level: 10, magic: 20 },
    target: { side: "enemy", magicDefense: defense, magicEvasion: 0, elementResistances: {}, conditionTypes: [412] },
    recovery, targetCount: 1 };
  const expected = recovery && !forceDefense ? 306 : Math.trunc((Math.trunc(((255 - defense) * 306) / 256) + 1) * 170 / 256) + 1;
  const random = [0, 31]; assert.equal(calculateMagic(input, () => random.shift()).amount, expected);
  assert.equal(random.length, 0); damageProbes++;
}
const report = {
  lane: "source-protection-compiler-lifecycle-and-controlled-action-projection", nativeEvidenceHash: hash(native),
  sourceSetHash: corpus.manifest.sourceSetHash,
  conditions: rows.map((r) => ({ id: Number(r.id), type: Number(r.condition_type), untilType: Number(r.until_type),
    conditionGroup: Number(r.condition_group_id), effectAssetId: Number(r.battle_effect_asset_id), admitted: admittedRows.includes(r) })),
  sources: [...rows.map((r) => reader.row("condition.csv", r.id)), ...candidates.flatMap((r) => compileAbilityProgram(reader, Number(r.id)).sources)],
  admittedAbilities: admitted.map((d) => d.id), blockedAbilities: blocked.map((d) => ({ id: d.id, blockers: d.blockers })),
  lifecycleProbes, abilityProbes, damageProbes, publishedProbes,
  originalGameExecuted: false, semanticsVerified: false,
  blockers: ["special protection providers93/94", "equipment/permanent protection providers", "original condition particle effects327/328",
    "source summon/automatic/composite action providers", "original-game-dynamic-oracle"],
};
if (!sourceOnly) {
  const published = JSON.parse(await readFile(resolve(root, option("--catalog", "build/game/opening-playable.json")), "utf8"));
  const source = JSON.parse(await readFile(root + "build/game/opening-battle.json", "utf8"));
  for (const doc of [source, published]) { const { contentHash, ...body } = doc; assert.equal(hash(body), contentHash); }
  assert.equal(published.common.sourceContentHash, source.contentHash);
  assert.equal(published.common.qualificationContext.mode, "source");
  assert.equal(source.nativeProfile.sha256, native.nativeSha256);
  for (const row of report.sources) {
    const table = row.source.assetPath.split("/").at(-1);
    assert.deepEqual(source.tables[table][row.source.rowId], row);
  }
  for (const definition of definitions) {
    assert.deepEqual(published.common.abilities[definition.id].plan, definition.plan);
    assert.deepEqual(published.common.abilities[definition.id].blockers, definition.blockers); publishedProbes++;
  }
  const runtime = new BattleConditions(published.common.conditions);
  assert.deepEqual(runtime.types([22, 23]), [412, 19]); publishedProbes++;
  assert.deepEqual(runtime.battleEnd([53, 22, 23]), [53]); publishedProbes++;
  const persistent = new FieldConditions(published.gameState.fieldConditions);
  for (const id of [22, 23]) { assert.throws(() => persistent.validateActive([id]), /Unimplemented active field/); publishedProbes++; }
  report.contentHash = published.contentHash; report.sourceContentHash = source.contentHash; report.publishedProbes = publishedProbes;
}
await mkdir(root + "build/reports", { recursive: true });
await writeFile(outputPath, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ sourceOnly, admittedConditions: admittedRows.length, blockedConditions: rows.length - admittedRows.length,
  admittedAbilities: admitted.length, blockedAbilities: blocked.length, lifecycleProbes, abilityProbes, damageProbes, publishedProbes,
  blockers: report.blockers.length, reportSha256: hash(report), originalGameExecuted: false }, null, 2));
