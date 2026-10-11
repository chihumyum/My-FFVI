// Controlled source initialization and current GameState integration, not story playability.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = process.argv.includes("--dist") ? process.argv[process.argv.indexOf("--dist") + 1] : "dist";
const module = (path) => import(new URL(`${outDir}/src/${path}.js`, "file://" + root));
const { loadCorpus } = await module("compiler/corpus");
const { readSnapshot, snapshotFile } = await module("compiler/integrity");
const { battleTableIndex } = await module("compiler/battle");
const { compileOwnedCharacterInitialization } = await module("compiler/owned-character");
const { compileEquipmentCatalog } = await module("compiler/equipment");
const { createOwnedCharacter, validateOwnedCharacterAbilities } = await module("core/owned-character");
const { prepareRosterLifecycle } = await module("core/roster");
const { GameState } = await module("core/game-state");
const { hash } = await module("compiler/content");
const corpus = await loadCorpus(root);
const battle = JSON.parse(snapshotFile(await readSnapshot(root + "build/battle"), "battle.json"));
const field = JSON.parse(snapshotFile(await readSnapshot(root + "build/field"), "field.json"));
const catalog = JSON.parse(await readFile(root + "build/game/opening-playable.json", "utf8"));
const { contentHash, ...catalogInput } = catalog;
assert.equal(hash(catalogInput), contentHash);
const native = JSON.parse(await readFile(root + "build/reports/owned-character-native-check.json", "utf8"));
assert.equal(native.methods.length, 39);
assert.equal(native.semanticsVerified, false);
assert.ok(corpus.manifest.sources.some((s) => s.file === "GameAssembly.dll" && s.sha256 === native.nativeSha256));
const name = (key) => {
  const value = field.messages.system_zhc[key];
  assert.equal(typeof value, "string", "Missing exact initial character name: " + key);
  return value;
};
const reader = () => battleTableIndex(corpus.tables, battle.tableSources);
const templates = new Map(), decoded = [], blocked = [];
for (const row of corpus.tables["character_status.csv"]) {
  const sourceId = Number(row.id);
  try {
    const { template, sources } = compileOwnedCharacterInitialization(reader(), corpus.tables, sourceId, name);
    templates.set(sourceId, template);
    decoded.push({ sourceId, level: template.initial.level, hp: template.initial.hp, maxHp: template.initial.maxHp, mp: template.initial.mp,
      maxMp: template.initial.maxMp, commandIds: template.initial.abilities.commandIds,
      ownedAbilities: template.initial.abilities.owned.length,
      learnedAbilities: template.initial.abilities.owned.filter((a) => a.skillLevel === 100).length,
      sources });
  } catch (error) { blocked.push({ sourceId, reason: error.message }); }
}
assert.equal(decoded.length + blocked.length, 34);
for (const id of [1, 2, 31, 32]) assert.ok(templates.has(id), JSON.stringify(blocked));
for (const id of [4, 14, 33]) assert.ok(blocked.some((b) => b.sourceId === id && /conditions/.test(b.reason)));
const make = () => new GameState(catalog.gameState, catalog.common.players, catalog.contentHash, catalog.common.conditions);
const state = make(), initial = state.snapshot();
assert.equal(initial.formatVersion, 5);
const openingChecks = [];
for (const player of catalog.common.players) {
  const template = templates.get(player.sourceId);
  assert.deepEqual(catalog.gameState.characterInitializations[player.id], template);
  const member = initial.roster.find((r) => r.id === player.id);
  for (const key of ["hp", "mp", "level", "exp", "name"]) {
    assert.equal(template.initial[key], player[key], `${player.id}:${key}`);
    assert.equal(member[key], player[key], `${player.id}:${key}:runtime`);
  }
  assert.equal(template.initial.maxHp, player.hp);
  assert.equal(template.initial.maxMp, player.mp);
  assert.deepEqual(member.abilities, template.initial.abilities);
  assert.deepEqual(template.parameterContext, catalog.gameState.equipmentSystem.contexts[player.id]);
  if (template.nameTag !== null) assert.equal(initial.characterNames[template.nameTag], player.name);
  openingChecks.push({ id: player.id, sourceId: player.sourceId, ownedAbilities: member.abilities.owned.length });
}
assert.deepEqual(openingChecks.map((p) => p.ownedAbilities), [63, 4, 4]);
assert.deepEqual(initial.characterNames, { TINA: catalog.common.players[0].name });
assert.equal(templates.get(31).nameTag, null);
assert.equal(templates.get(32).nameTag, null);
const expectedHistory = [...new Set(initial.roster.flatMap((r) => r.abilities.owned.map((a) => a.abilityId)))];
assert.deepEqual(initial.learnedAbilityIds, expectedHistory);
assert.equal(initial.learnedAbilityIds.length, 63);
assert.ok(initial.learnedAbilityIds.includes(32));
assert.equal(initial.roster[0].abilities.owned.find((a) => a.abilityId === 32).skillLevel, 0);
const restored = make();
restored.restore(JSON.parse(JSON.stringify(initial)));
assert.deepEqual(restored.snapshot(), initial);
const rejected = [];
const mutations = {
  "learned-value": (s) => { s.roster[0].abilities.owned[0].skillLevel = 99; },
  "missing-owned-record": (s) => { s.roster[0].abilities.owned.pop(); },
  "owned-order": (s) => { s.roster[0].abilities.owned.reverse(); },
  "acquisition-order": (s) => { s.roster[0].abilities.additionOrder.reverse(); },
  "global-history-order": (s) => { s.learnedAbilityIds.reverse(); },
  "global-history-duplicate": (s) => { s.learnedAbilityIds.push(s.learnedAbilityIds[0]); },
  "global-history-missing": (s) => { s.learnedAbilityIds.pop(); },
  "name-binding": (s) => { s.characterNames.TINA = "invalid-binding"; },
  "extra-name-binding": (s) => { s.characterNames["SYNTHETIC_UNKNOWN"] = "extra"; },
  "visible-unlearned-ability": (s) => { s.roster[0].abilities.byCommand[0].abilityIds.push(32); },
};
for (const [label, mutate] of Object.entries(mutations)) {
  const corrupted = structuredClone(initial);
  mutate(corrupted);
  assert.throws(() => restored.restore(corrupted), label);
  assert.deepEqual(restored.snapshot(), initial, label + ": atomic restore");
  rejected.push(label);
}
// A source Lock initializer can participate in the pure lifecycle transaction.
// This does not grant him to the published profile or bypass missing growth/media.
const sourceIds = [1, 2, 31, 32];
const gearIds = corpus.tables["content.csv"].filter((r) => ["2", "3"].includes(r.type_id)).map((r) => Number(r.id));
const equipment = compileEquipmentCatalog(reader(), gearIds, sourceIds, name,
  Object.fromEntries(sourceIds.map((id) => [id, { hasTwoSwordStyle: false, hasTwoHand: false, equipAnyJob: false }]))).catalog;
const lifecycle = { roster: initial.roster, party: initial.party, equipmentStock: initial.equipmentStock, releasedJobIds: initial.releasedJobIds };
const original = structuredClone(lifecycle);
let sideEffects;
const providers = {
  initialize: ({ sourceId, ownedId, releasedJobIds }) => {
    const result = createOwnedCharacter(templates.get(sourceId), { id: "controlled-owner:" + sourceId, ownedId, releasedJobIds,
      learnedAbilityIds: initial.learnedAbilityIds });
    sideEffects = result;
    return result.member;
  },
  validateMember: (member) => validateOwnedCharacterAbilities(member.abilities),
};
const preview = prepareRosterLifecycle(lifecycle, { kind: "unlock", sourceId: 2, refreshActors: false },
  { equipment, jobIds: catalog.gameState.rosterLifecycle.jobIds }, providers);
assert.deepEqual(lifecycle, original);
assert.equal(preview.state.roster.length, 4);
assert.deepEqual(preview.state.party, initial.party);
assert.deepEqual(sideEffects.learnedAbilityIdsToAppend, [229]);
assert.equal(sideEffects.nameBinding.key, "ROCK");
assert.equal(preview.state.roster.at(-1).abilities.owned.length, 59);
assert.equal(preview.state.roster.at(-1).ownedId, 4);
const increments = new Map();
for (const id of templates.get(2).initial.equipment)
  if (!equipment.definitions[id].empty) increments.set(id, (increments.get(id) ?? 0) + 1);
for (const [id, count] of increments)
  assert.equal(preview.state.equipmentStock.find((s) => s.id === id).count, (initial.equipmentStock.find((s) => s.id === id)?.count ?? 0) + count);
const failed = { ...providers, validateMember: (member) => { providers.validateMember(member); if (member.sourceId === 2) throw new Error("controlled publication rejection"); } };
assert.throws(() => prepareRosterLifecycle(lifecycle, { kind: "unlock", sourceId: 2, refreshActors: false },
  { equipment, jobIds: catalog.gameState.rosterLifecycle.jobIds }, failed), /controlled publication rejection/);
assert.deepEqual(lifecycle, original);
assert.deepEqual(state.snapshot(), initial);
const report = { lane: "controlled-source-owned-initialization-and-game-state",
  catalogHash: contentHash, sourceSetHash: corpus.sourceSetHash, nativeSha256: native.nativeSha256,
  decoded, blocked, openingChecks, rejected, globalHistoryCount: initial.learnedAbilityIds.length,
  controlledNewOwner: { sourceId: 2, ownedId: 4, ownedAbilities: 59, historyAppend: [229], equipmentIncrements: [...increments] },
  acceptance: { compiledSourceInitializations: decoded.length, blockedSourceInitializations: blocked.length, sourceCatalogAndRuntimeOwners: openingChecks.length,
    invalidSavesRejected: rejected.length, jsonRoundTrip: true, controlledUnlock: true, failedPublicationAtomic: true,
    originalRuntimeOracle: false, sourceFirstJoinGrowth: false, renderedNewOwner: false },
};
const output = JSON.stringify(report, null, 2) + "\n";
await writeFile(root + "build/reports/owned-character-check.json", output);
console.log(JSON.stringify({ ...report.acceptance, globalHistoryCount: initial.learnedAbilityIds.length, reportHash: hash(report) }, null, 2));
