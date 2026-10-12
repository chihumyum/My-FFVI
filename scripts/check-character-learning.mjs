// Source catalog/owner probes. A controlled source8 starting roster and qualified
// action logs are mechanism inputs, not a claim that opening story grants them.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const option = process.argv.indexOf("--compiled-dir");
const out = option >= 0 ? process.argv[option + 1] : "dist";
if (!out) throw new Error("Missing compiled directory");
const module = (path) => import(new URL(`${out}/src/${path}.js`, "file://" + root));
const { loadCorpus } = await module("compiler/corpus");
const { battleTableIndex } = await module("compiler/battle");
const { readSnapshot, snapshotFile } = await module("compiler/integrity");
const { hash } = await module("compiler/content");
const { compileObservedLearning } = await module("compiler/character-learning");
const { observeLearningAction, applyObservedLearning } = await module("core/character-learning");
const { GameState } = await module("core/game-state");
const { createNewGame } = await module("core/new-game");
const { projectCharacterMenu } = await module("core/character-menu");
const { equipmentOwnedAbilities } = await module("core/equipment");
const { BattleGame } = await module("core/battle");
const { encounterContent } = await module("core/battle-content");
const corpus = await loadCorpus(root);
const battle = JSON.parse(snapshotFile(await readSnapshot(root + "build/battle"), "battle.json"));
const source = JSON.parse(await readFile(root + "build/game/opening-battle.json", "utf8"));
const published = JSON.parse(await readFile(root + "build/game/opening-playable.json", "utf8"));
for (const content of [source, published]) {
  const { contentHash, ...input } = content; assert.equal(hash(input), contentHash);
}
const native = JSON.parse(await readFile(root + "build/reports/character-learning-native-check.json", "utf8"));
assert.equal(native.semanticsVerified, false); assert.equal(native.methods.length, 12);
assert.ok(corpus.manifest.sources.some((s) => s.file === "GameAssembly.dll" && s.sha256 === native.nativeSha256));
const misc = Object.values(battle.assets).filter((a) => a.source.assetPath.endsWith("/serial_misc_assets.json"));
assert.equal(misc.length, 1);
for (const key of ["assetPath", "objectId", "serializedFile", "file"])
  assert.equal(source.reactionSource[key], misc[0].source[key]);
const containers = battle.sources.filter((s) => s.file === misc[0].source.file || s.file.endsWith("/" + misc[0].source.file));
assert.equal(containers.length, 1);
assert.equal(source.reactionSource.sha256, containers[0].sha256);
assert.equal(source.reactionSource.battleSourceSetHash, battle.sourceSetHash);
assert.equal(source.reactionSource.sourceSetHash, battle.parentSourceSetHash);
const compiled = compileObservedLearning(battleTableIndex(corpus.tables, battle.tableSources), corpus.tables, misc[0].data);
assert.deepEqual(compiled.catalog, source.observedLearning);
assert.deepEqual(compiled.catalog, published.common.observedLearning);
assert.deepEqual(compiled.catalog.forbiddenConditionTypes, native.forbidden.values);
assert.equal(compiled.catalog.candidates.length, 28);
assert.deepEqual(compiled.catalog.candidates.find((r) => r.observedAbilityId === 1350),
  { observedAbilityId: 1350, abilityId: 160, contentId: 490, typeId: 504, groupId: 5 });
const supported = compiled.catalog.candidates.filter((r) => published.common.abilities[r.observedAbilityId]?.plan)
  .map((r) => r.observedAbilityId);
assert.deepEqual(supported, [142,161,162]);
for (const id of supported) {
  const ability = published.common.abilities[id];
  assert.equal(ability.program.rules.type_id, 504);
  assert.deepEqual(ability.plan.effects.map((e) => e.kind), ["magic"]);
}
const id = "player:8", template = published.gameState.characterInitializations[id], plan = published.gameState.characterGrowth[id];
assert.equal(template.initial.sourceId, 8); assert.deepEqual(plan.observedLearning, compiled.catalog);
const beforeAbilities = structuredClone(template.initial.abilities);
const observer = { sourceId: 8, conditionTypes: [], abilities: beforeAbilities };
const observation = [], alreadyLearned = [];
let forbiddenProbes = 0;
for (const row of compiled.catalog.candidates) {
  const ability = { id: row.observedAbilityId, typeId: 504 };
  const ids = observeLearningAction(compiled.catalog, ability, [observer]);
  if (ids.length) observation.push(...ids); else alreadyLearned.push(row.observedAbilityId);
  for (const type of compiled.catalog.forbiddenConditionTypes) {
    assert.deepEqual(observeLearningAction(compiled.catalog, ability, [{ ...observer, conditionTypes: [type] }]), []);
    forbiddenProbes++;
  }
}
assert.deepEqual(alreadyLearned, [143,147,160,1350]);
assert.equal(observation.length, 24);
const learned = applyObservedLearning(compiled.catalog, beforeAbilities, [...observation].reverse());
assert.deepEqual(learned.ownedMagicToAppend, compiled.catalog.candidates.filter((r) => observation.includes(r.observedAbilityId)).map((r) => r.contentId));
assert.deepEqual(learned.abilities.additionOrder, beforeAbilities.additionOrder);
assert.deepEqual(learned.abilities.sortOrder, beforeAbilities.sortOrder);
assert.deepEqual(template.initial.abilities, beforeAbilities);

// Explicit controlled roster recipe: reuse the exact source8 initializer and
// full source equipment catalog; do not rewrite any ability/effect or fabricate
// NativeState. createNewGame derives every owned/native seed from this recipe.
const owned = structuredClone(published.gameState), definition = owned.sourceNewGame;
definition.characters = [{ id, template: structuredClone(template) }];
definition.equipment = structuredClone(owned.equipmentSystem.catalog);
definition.party.slots = definition.party.slots.map((slot, slotIndex) => slot.map((cell, index) =>
  ({ ...cell, id: slotIndex === 0 && index === 0 ? id : null })));
const initial = createNewGame(definition), member = initial.owned.roster[0];
owned.initialParty = structuredClone(initial.owned.party); owned.initialOwnedConditions = [];
owned.equipmentSystem.initialStock = structuredClone(initial.owned.equipmentStock);
owned.equipmentSystem.contexts[id] = structuredClone(template.parameterContext);
owned.equipment[id] = [...template.initial.equipment];
owned.rosterLifecycle.initial = { [id]: { ownedId: member.ownedId, jobId: member.jobId,
  additionalLevel: member.additionalLevel, magicStoneId: member.magicStoneId, ownedJobs: structuredClone(member.ownedJobs) } };
const definitions = [owned.battleDefinitions.find((d) => d.sourceId === 8)];
const binding = hash({ parent: published.contentHash, probe: "controlled-source8-observed-learning", owned });
const make = () => GameState.createNewGame(owned, definitions, binding, published.common.conditions);
const state = make(), initialSnapshot = state.snapshot(), lease = state.openBattle(1, published.encounters[1].rewardPolicy);
const players = state.battlePlayers(lease), progression = state.battleProgression(lease, published.common.experience);
const magicPoints = published.encounters[1].rewardPolicy.magicPoints;
Object.assign(players[0], progression(players[0], 0, [162,142,161], magicPoints));
const result = { players, gil: 0, magicPoints, consumedItems: [], dropGrants: [], observedAbilityIds: [162,142,161],
  awardedExperience: [{ id, amount: 0 }] };
const commit = state.prepareVictory(lease, result);
assert.deepEqual(state.snapshot(), initialSnapshot); commit();
const snapshot = state.snapshot();
assert.deepEqual(snapshot.nativeState.ownedMagic, [472,491,492]);
assert.deepEqual(snapshot.learnedAbilityIds, initialSnapshot.learnedAbilityIds);
assert.deepEqual(snapshot.roster[0].growth.observedLearning, [{ battleSerial: 0, participantIndex: 0,
  level: template.initial.level, observedAbilityIds: [142,161,162] }]);
const menu = projectCharacterMenu(snapshot.roster[0], { growth: plan, developmentExperience: published.common.experience,
  abilities: published.common.abilities, commands: published.common.commands,
  equipmentAbilities: equipmentOwnedAbilities(owned.equipmentSystem.catalog, snapshot.roster[0]) });
for (const abilityId of supported) {
  const item = menu.abilities.find((a) => a.id === abilityId);
  assert.equal(item.skillLevel, 100); assert.equal(item.effectSupport, "implemented");
}
const restored = make(); restored.restore(JSON.parse(JSON.stringify(snapshot)));
assert.deepEqual(restored.snapshot(), snapshot);
let rejected = 0;
for (const change of [
  (s) => { s.nativeState.ownedMagic = []; },
  (s) => { s.nativeState.ownedMagic.reverse(); },
  (s) => { s.roster[0].growth.observedLearning[0].observedAbilityIds.reverse(); },
  (s) => { s.roster[0].growth.observedLearning[0].observedAbilityIds = [999]; },
  (s) => { s.roster[0].growth.observedLearning[0].battleSerial = 1; },
  (s) => { s.roster[0].abilities.owned.find((a) => a.abilityId === 142).skillLevel = 0; },
]) {
  const invalid = structuredClone(snapshot); change(invalid);
  assert.throws(() => restored.restore(invalid)); assert.deepEqual(restored.snapshot(), snapshot); rejected++;
}
const encounterId = Number(Object.keys(published.encounters)[0]);
const content = encounterContent(published, encounterId);
// These field exclusions are explicit mechanism inputs. Actual map/transport
// resolution remains the GameSession entry provider's responsibility.
content.qualificationContext.invalidContentIds = [];
const nextLease = restored.openBattle(encounterId, content.rewardPolicy);
const next = new BattleGame(content, 1234, restored.battlePlayers(nextLease), restored.battleInventory(nextLease),
  restored.battleProgression(nextLease, content.experience));
const command = next.commandMenu(id).find((c) => c.id === 17);
assert.ok(command);
for (const abilityId of supported) assert.ok(command.abilityIds.includes(abilityId));
// Source level1 MP is retained. Eligibility and affordability are not conflated.
const nextEligibility = supported.map((abilityId) => ({ abilityId, cost: next.abilityCost(id, abilityId),
  canUse: next.canUse(id, abilityId, 17) }));
restored.cancelBattle(nextLease);
const report = { lane: "source-catalog-and-controlled-observed-learning-owner", semanticsVerified: false,
  publishedHash: published.contentHash, sourceHash: source.contentHash, sourceSetHash: corpus.manifest.sourceSetHash,
  nativeSha256: native.nativeSha256, miscSource: source.reactionSource, sources: compiled.sources,
  candidates: compiled.catalog.candidates, executable: supported, blockedExecutable: 25,
  observation: { firstObserver: 8, qualifying: observation.length, alreadyLearned, forbiddenProbes },
  owner: { recipe: "controlled source8 starting roster, qualified action log, zero EXP; source rows unchanged",
    originalStoryReachability: false, snapshotVersion: snapshot.formatVersion, globalOwnedMagic: snapshot.nativeState.ownedMagic,
    rejectedSnapshots: rejected, nextEligibility },
  limitations: ["Only 142/161/162 effects are admitted; other candidate records do not grant executable effects.",
    "The source8 test roster is not applied to the published game.",
    "Original-game execution and complete story acquisition remain unverified."] };
await writeFile(root + "build/reports/character-learning-check.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ candidates: 28, executable: supported, qualifying: observation.length, forbiddenProbes,
  ownerRoundTrips: 1, rejectedSnapshots: rejected, semanticsVerified: false }, null, 2));
