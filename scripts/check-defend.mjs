// Source-table binding and controlled Web execution; never original-game parity.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
const root = fileURLToPath(new URL("..", import.meta.url));
const option = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const module = (name) => import(pathToFileURL(resolve(root, option("--dist", "dist"), "src", name + ".js")));
const { loadCorpus } = await module("compiler/corpus");
const { readSnapshot, snapshotFile } = await module("compiler/integrity");
const { hash } = await module("compiler/content");
const { battleTableIndex } = await module("compiler/battle");
const { compileAbilityProgram, compileDevelopmentAbility } = await module("compiler/ability");
const { compileDefendEffect } = await module("compiler/defend");
const { compileConditionCatalog } = await module("compiler/conditions");
const { ConditionRules } = await module("core/conditions");
const { applyDefend, clearDefendOnAdmission } = await module("core/defend");
const { BattleConditions } = await module("core/battle-conditions");
const { GameState } = await module("core/game-state");
const { BattleGame } = await module("core/battle");
const { encounterContent } = await module("core/battle-content");
const { projectBattleFieldState } = await module("core/field-battle-entry");
const corpus = await loadCorpus(root);
const exported = JSON.parse(snapshotFile(await readSnapshot(root + "build/battle"), "battle.json"));
const reader = battleTableIndex(corpus.tables, exported.tableSources);
const native = JSON.parse(await readFile(root + "build/reports/defend-native-check.json", "utf8"));
assert.equal(native.methods.length, 26); assert.equal(native.rawRanges.length, 12);
assert.equal(native.semanticsVerified, false);
assert.ok(corpus.manifest.sources.some((s) => s.file === "GameAssembly.dll" && s.sha256 === native.nativeSha256));
const sourceAbilities = corpus.tables["ability.csv"].filter((r) => r.type_id === "5");
assert.deepEqual(sourceAbilities.map((r) => Number(r.id)), [2]);
const sourceFunctions = corpus.tables["function.csv"].filter((r) => r.type_id === "15");
assert.deepEqual(sourceFunctions.map((r) => Number(r.id)), [15]);
const sourceGroups = corpus.tables["function_group.csv"].filter((r) => [1, 2, 3].some((slot) => Number(r[`function${slot}_id`]) === 15));
assert.deepEqual(sourceGroups.map((r) => Number(r.id)), [401]);
const command = corpus.tables["command.csv"].find((r) => r.id === "2");
assert.ok(command); assert.equal(command.ability_id, "2");
const { program } = compileAbilityProgram(reader, 2);
const compiled = compileDefendEffect(reader, program);
assert.deepEqual(compiled.catalog, { conditionId: 1, conditionType: 1, untilType: 1 });
assert.deepEqual(compiled.effect, { kind: "defend", slot: 1, conditionId: 1 });
const conditionCatalog = compileConditionCatalog(reader, corpus.tables["condition.csv"].map((row) => Number(row.id))).catalog;
const rules = new ConditionRules(conditionCatalog), original = [53, 1];
const ordinary = { route: "atb", abilities: [{ id: 218, type: 604 }], nativeChain: "empty" };
let pureProbes = 0;
assert.deepEqual(applyDefend(compiled.catalog, rules, original, "actor", "actor"), {
  currentIds: [53, 1], added: [1], removed: [1], missed: false,
}); pureProbes++;
assert.throws(() => applyDefend(compiled.catalog, rules, original, "actor", "other"), /self target/); pureProbes++;
for (const abilities of [ordinary.abilities, [{ id: 2, type: 5 }], []]) {
  assert.deepEqual(clearDefendOnAdmission(compiled.catalog, rules, original, { ...ordinary, abilities }).currentIds, [53]); pureProbes++;
}
assert.deepEqual(clearDefendOnAdmission(compiled.catalog, rules, original, { ...ordinary, route: "direct", nativeChain: "unresolved" }).currentIds, original); pureProbes++;
for (const abilities of [[{ id: 17, type: 4 }], [{ id: 83, type: 4 }], ...[8, 40, 41].map((type) => [{ id: 2, type }])]) {
  assert.throws(() => clearDefendOnAdmission(compiled.catalog, rules, original, { ...ordinary, abilities }), /chain\/selection/); pureProbes++;
}
assert.throws(() => clearDefendOnAdmission(compiled.catalog, rules, original, { ...ordinary, nativeChain: "unresolved" }), /chain\/selection/); pureProbes++;
assert.deepEqual(rules.resolveConflict({ currentIds: [53, 1, 5], equipmentIds: [], incomingId: 5 }).currentIds, [53, 5]); pureProbes++;
assert.deepEqual(original, [53, 1]); pureProbes++;
const definition = compileDevelopmentAbility(reader, 2, "source Defend");
assert.deepEqual(definition.blockers, []);
assert.deepEqual(definition.plan.effects, [compiled.effect]);
assert.equal(definition.plan.targeting.relation, "self");
assert.equal(definition.cost, 0); pureProbes++;
const report = {
  lane: "source-defend-compiler-and-controlled-web-runtime", nativeEvidenceHash: hash(native),
  sourceIdentity: { commandId: 2, abilityId: 2, abilityType: 5, functionGroupId: 401, functionId: 15, functionType: 15, conditionId: 1, conditionType: 1, untilType: 1 },
  sources: compiled.sources, pureProbes, runtimeProbes: 0, players: [],
  originalGameExecuted: false, semanticsVerified: false,
  blockers: ["native-special-chain-selection-exceptions", "complete-shield-staging-animation-scheduler", "original-game-dynamic-oracle"],
};
const sourceOnly = process.argv.includes("--source-only");
if (!sourceOnly) {
  const published = JSON.parse(await readFile(resolve(root, option("--catalog", "build/game/opening-playable.json")), "utf8"));
  const source = JSON.parse(await readFile(root + "build/game/opening-battle.json", "utf8"));
  for (const document of [source, published]) {
    const { contentHash, ...input } = document; assert.equal(hash(input), contentHash);
  }
  assert.equal(published.common.profile, "narshe-playability-v30");
  assert.equal(published.common.sourceContentHash, source.contentHash);
  assert.equal(source.nativeProfile.sha256, native.nativeSha256);
  assert.equal(published.common.qualificationContext.mode, "source");
  assert.deepEqual(published.common.abilities[2].plan, definition.plan);
  for (const row of compiled.sources) {
    const table = row.source.assetPath.split("/").at(-1);
    assert.deepEqual(source.tables[table][row.source.rowId], row);
  }
  assert.deepEqual(published.common.battleAppearance.aliases.ready.body, ["Ready_00"]);
  assert.deepEqual(published.common.battleAppearance.aliases.ready.armor, ["WalkL_01"]);
  const conditions = new BattleConditions(published.common.conditions);
  assert.deepEqual(conditions.battleEnd([53, 1]), [53]); report.runtimeProbes++;
  const content = encounterContent(published, Number(Object.keys(published.encounters)[0]));
  const exclusions = projectBattleFieldState(content.battleEntry,
    { mapId: 3, transportationId: 6, isSavePoint: null, beastFieldController: null, footAttributeType: null },
    published.gameState.fieldConditions.transportations);
  assert.deepEqual(exclusions.blockers, []);
  content.qualificationContext = { ...content.qualificationContext, invalidContentIds: exclusions.invalidContentIds };
  for (const player of content.players) {
    const owned = new GameState(published.gameState, published.common.players, published.contentHash, content.conditions);
    const before = owned.snapshot(), lease = owned.openBattle(content.encounterId);
    const battle = new BattleGame(content, 1741, owned.battlePlayers(lease), owned.battleInventory(lease));
    battle.combatants.forEach((unit) => { unit.atb = 0; });
    const actor = battle.players.find((p) => p.id === player.id), resources = [actor.hp, actor.mp]; actor.atb = 100;
    assert.equal(battle.commandMenu(actor.id).find((entry) => entry.id === 2).available, true);
    assert.equal(battle.command(actor.id, 2, actor.id, 2), true);
    assert.deepEqual(actor.conditionIds, [53]);
    battle.advance(410);
    assert.deepEqual(actor.conditionIds, [53, 1]);
    assert.deepEqual([actor.hp, actor.mp], resources);
    const frame = battle.appearanceFrame(actor.id, { key: "ready", bodyFrame: 0, armorFrame: 0 });
    assert.equal(frame.body.sprite, actor.appearance.bodySprites.Ready_00);
    assert.ok(frame.armor);
    battle.advance(500); assert.ok(actor.conditionIds.includes(1)); actor.atb = 100;
    assert.equal(battle.command(actor.id, 218, "missing", 26), false);
    assert.ok(actor.conditionIds.includes(1));
    assert.equal(battle.command(actor.id, 218, battle.enemies[0].id, 26), true);
    assert.deepEqual(actor.conditionIds, [53]);
    owned.cancelBattle(lease); assert.deepEqual(owned.snapshot(), before);
    report.players.push({ id: actor.id, sourceId: actor.sourceId, defendAvailable: true,
      transientOwnedWrite: false, readyBody: frame.body.sprite, readyArmor: frame.armor.sprite });
    report.runtimeProbes += 9;
  }
  report.contentHash = published.contentHash; report.sourceContentHash = source.contentHash;
}
await mkdir(root + "build/reports", { recursive: true });
const path = root + `build/reports/defend-${sourceOnly ? "source-" : ""}check.json`;
await writeFile(path, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ sourceOnly, pureProbes, runtimeProbes: report.runtimeProbes,
  players: report.players.length, blockers: report.blockers.length, reportSha256: hash(report), originalGameExecuted: false }, null, 2));
