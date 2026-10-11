// Actual source tables + controlled contexts + current owned-state integration.
// Supplying condition 53 here is a mechanism probe, not evidence that battle
// entry created that condition. The published profile keeps that gap explicit.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
const root = fileURLToPath(new URL("..", import.meta.url));
const option = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const outDir = option("--dist", "dist"), catalogPath = option("--catalog", "build/game/opening-playable.json");
const module = (path) => import(pathToFileURL(resolve(root, outDir, "src", path + ".js")));
const { loadCorpus } = await module("compiler/corpus");
const { readSnapshot, snapshotFile } = await module("compiler/integrity");
const { battleTableIndex } = await module("compiler/battle");
const { compileBattleAbilityCatalog } = await module("compiler/battle-abilities");
const { projectBattleAbilities } = await module("core/battle-abilities");
const { growCharacter, initialCharacterGrowth } = await module("core/character-growth");
const { createOwnedCharacter } = await module("core/owned-character");
const { projectEquipmentParameters } = await module("core/equipment");
const { GameState } = await module("core/game-state");
const { BattleGame } = await module("core/battle");
const { encounterContent } = await module("core/battle-content");
const { hash } = await module("compiler/content");
const corpus = await loadCorpus(root);
const battleSource = JSON.parse(snapshotFile(await readSnapshot(root + "build/battle"), "battle.json"));
const published = JSON.parse(await readFile(resolve(root, catalogPath), "utf8"));
const { contentHash, ...input } = published;
assert.equal(hash(input), contentHash);
const native = JSON.parse(await readFile(root + "build/reports/battle-abilities-native-check.json", "utf8"));
assert.equal(native.methods.length, 24);
assert.equal(native.rawRanges.length, 13);
assert.equal(native.semanticsVerified, false);
assert.ok(corpus.manifest.sources.some((s) => s.file === "GameAssembly.dll" && s.sha256 === native.nativeSha256));
const templates = Object.entries(published.gameState.characterInitializations);
assert.equal(templates.length, 18);
const compiled = compileBattleAbilityCatalog(battleTableIndex(corpus.tables, battleSource.tableSources), corpus.tables,
  templates.map(([, t]) => t.initial.sourceId).sort((a, b) => a - b));
assert.deepEqual(published.common.battleAbilities, compiled.catalog);
assert.deepEqual(published.common.qualificationContext, {
  mode: "development-static", conditionContext: "unknown", battleType: 0,
  magicLearningValue: null, invalidContentIds: null, itemMenuAvailable: null,
});
const context = { conditionIds: [], battleType: 0, magicLearningValue: null, invalidContentIds: [], itemMenuAvailable: true, partySize: 3 };
const member = (template) => ({ sourceId: template.initial.sourceId, jobId: template.initial.jobId,
  magicStoneId: template.initial.magicStoneId, abilities: template.initial.abilities });
const sourceProjections = [];
let projections = 0;
for (const [, template] of templates) {
  const before = structuredClone(template);
  for (const conditionIds of [[], [53], null]) {
    const result = projectBattleAbilities(compiled.catalog, member(template), { ...context, conditionIds });
    const ids = new Set(result.entries.map((e) => e.commandId));
    assert.ok(template.initial.abilities.commandIds.every((id) => ids.has(id)), "No source command disappears from the projection");
    for (const entry of result.entries) {
      if (entry.kind !== "ability-list") continue;
      for (const id of entry.abilityIds) {
        const owned = template.initial.abilities.owned.find((a) => a.abilityId === id);
        assert.equal(owned.skillLevel, 100, `unlearned source ability ${id}`);
      }
    }
    const magitek = result.entries.find((c) => c.commandId === 26);
    if (magitek) assert.equal(magitek.released, conditionIds === null ? null : conditionIds.includes(53));
    if (template.initial.sourceId === 13) assert.match(result.blockers.join(), /Gogo/);
    sourceProjections.push({ sourceId: template.initial.sourceId, conditionIds,
      qualifiedAbilityIds: result.abilityIds, blockedCommands: result.entries.filter((c) => c.blockers.length).map((c) => ({ id: c.commandId, blockers: c.blockers })) });
    projections++;
  }
  assert.deepEqual(template, before);
}
const template = (sourceId) => templates.find(([, t]) => t.initial.sourceId === sourceId)[1];
for (const sourceId of [31, 32]) {
  const result = projectBattleAbilities(compiled.catalog, member(template(sourceId)), { ...context, conditionIds: [53] });
  assert.deepEqual(result.entries.find((c) => c.commandId === 26).abilityIds, [218, 219, 220, 222]);
}
const tina = template(1), tinaEntry = templates.find(([, t]) => t === tina);
const initialProjection = projectBattleAbilities(compiled.catalog, member(tina), context);
assert.deepEqual(initialProjection.entries.find((c) => c.commandId === 7).abilityIds, [31, 40]);
assert.equal(tina.initial.abilities.owned.find((a) => a.abilityId === 32).skillLevel, 0);
assert.equal(initialProjection.abilityIds.includes(32), false);
const plan = published.gameState.characterGrowth[tinaEntry[0]];
const learning = plan.learning.find((row) => row.level > plan.initialLevel && row.abilityId === 32);
assert.ok(learning);
const initialized = createOwnedCharacter(tina, { id: tinaEntry[0], ownedId: 1, releasedJobIds: [], learnedAbilityIds: [] });
const exp = plan.experience.find((e) => e.level === learning.level).totalExp;
const grown = growCharacter(plan, initialized.member, initialCharacterGrowth(),
  { kind: "add-experience", amount: exp - initialized.member.exp, context: "field" },
  (owner, progress) => {
    const parameters = structuredClone(tina.parameterContext);
    for (const key of ["hp", "mp", "magic", "vitality", "agility"]) parameters.parameters.additional[key] += progress.additional[key];
    parameters.physical.strength.additional += progress.additional.strength;
    const result = projectEquipmentParameters(published.gameState.equipmentSystem.catalog, owner.equipment, parameters, tina.limits).parameters;
    return { maxHp: result.hp, maxMp: result.mp };
  });
const grownProjection = projectBattleAbilities(compiled.catalog, grown.member, context);
assert.ok(grownProjection.entries.find((c) => c.commandId === 7).abilityIds.includes(32));
assert.deepEqual(grown.learnedAbilityIdsToAppend, [], "learning qualification does not rewrite global history");
const state = new GameState(published.gameState, published.common.players, contentHash, published.common.conditions);
const snapshot = state.snapshot();
const players = state.partyPlayers();
for (const player of players) {
  const owner = snapshot.roster.find((o) => o.id === player.id);
  assert.deepEqual(player.ownedAbilities, { sourceId: owner.sourceId, jobId: owner.jobId, magicStoneId: owner.magicStoneId, abilities: owner.abilities });
}
const content = encounterContent(published, Number(Object.keys(published.encounters)[0]));
const battle = new BattleGame(content, 71, players);
for (const player of battle.players) {
  const result = battle.commandQualification(player.id);
  assert.ok(result);
  assert.equal(result.entries.find((c) => c.commandId === 26).released, null);
  assert.match(result.blockers.join(), /Unknown battle condition context/);
  assert.match(result.blockers.join(), /Unknown battle content exclusion/);
  assert.deepEqual(battle.commandMenu(player.id).map((c) => c.id), player.commands);
}
assert.deepEqual(state.snapshot(), snapshot, "inspection and battle copies cannot mutate shared owner state");
const report = {
  lane: "source-controlled-owned-battle-qualification", contentHash, nativeReportSha256: hash(native),
  templates: templates.length, commands: compiled.catalog.commands.length, projections,
  sourceRows: compiled.sources.length, sourceProjections,
  sourceLearning: { sourceId: 1, level: learning.level, abilityId: 32 }, sharedPlayers: players.length,
  runtimeMode: published.common.qualificationContext.mode,
  blockers: ["battle-entry-condition-53", "currently-invalid-content-context", "special-command-providers", "full-ability-effect-coverage"],
  originalGameExecution: false, playableCoverage: false,
};
await mkdir(root + "build/reports", { recursive: true });
await writeFile(root + "build/reports/battle-abilities-check.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ templates: report.templates, commands: report.commands, projections, sourceRows: report.sourceRows,
  sourceLearning: report.sourceLearning, sharedPlayers: players.length, runtimeMode: report.runtimeMode, blockers: report.blockers }, null, 2));
