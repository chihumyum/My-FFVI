// Exact source templates and one explicitly controlled owned/battle-entry chain.
// This check neither grants a character in the published bootstrap nor certifies
// native animation, story reachability or complete battle ability execution.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const option = (name, fallback) => {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error("Missing " + name + " value");
  return value;
};
const outDir = option("--dist", "dist");
const catalogPath = option("--catalog", "build/game/opening-playable.json");
const module = (path) => import(pathToFileURL(resolve(root, outDir, "src", path + ".js")));
const { loadCorpus } = await module("compiler/corpus");
const { readSnapshot, snapshotFile } = await module("compiler/integrity");
const { battleTableIndex } = await module("compiler/battle");
const { compilePlayerBattleDefinitions } = await module("compiler/player-battle");
const { compileRosterLifecycleEvent } = await module("compiler/roster");
const { GameState } = await module("core/game-state");
const { GameSession } = await module("core/game-session");
const { battleDefinitionBlocker } = await module("core/battle-content");
const { verifyContent } = await module("core/content-integrity");
const { hash } = await module("compiler/content");
const sha = (data) => createHash("sha256").update(data).digest("hex");
const reportPath = resolve(root, "build/reports/player-battle-check.json");
await mkdir(resolve(root, "build/reports"), { recursive: true });
await rm(reportPath, { force: true });
const corpus = await loadCorpus(root);
const snapshot = await readSnapshot(resolve(root, "build/battle"));
const exported = JSON.parse(snapshotFile(snapshot, "battle.json"));
const field = JSON.parse(snapshotFile(await readSnapshot(resolve(root, "build/field")), "field.json"));
const source = await verifyContent(JSON.parse(await readFile(resolve(root, "build/game/opening-battle.json"), "utf8")));
const published = await verifyContent(JSON.parse(await readFile(resolve(root, catalogPath), "utf8")));
assert.equal(source.sourceSetHash, exported.sourceSetHash);
assert.equal(source.parentSourceSetHash, corpus.manifest.parentSourceSetHash);
assert.equal(published.common.sourceContentHash, source.contentHash);
const nativeDependencies = [];
const nativeHash = sha(await readFile(resolve(root, "build/runtime/game/GameAssembly.dll")));
// These are dependencies on independently generated native evidence, not new
// native checks or an original-game execution claim from this compiler test.
for (const name of ["owned-character", "equipment", "parameter", "physical"]) {
  const path = `build/reports/${name}-native-check.json`;
  const bytes = await readFile(resolve(root, path));
  const report = JSON.parse(bytes);
  assert.equal(report.nativeSha256, nativeHash);
  assert.equal(report.semanticsVerified, false);
  nativeDependencies.push({ path, sha256: sha(bytes), nativeSha256: nativeHash, semanticsVerified: false });
}
const name = (key) => {
  const value = field.messages.system_zhc[key];
  assert.equal(typeof value, "string", "Missing source player name " + key);
  return value;
};
const input = { tables: corpus.tables, initializations: source.ownedInitializations,
  characterMedia: source.characterMedia, sprites: source.sprites, name };
const reader = () => battleTableIndex(corpus.tables, exported.tableSources);
const before = hash({ initializations: input.initializations, media: input.characterMedia, sprites: input.sprites });
const compiled = compilePlayerBattleDefinitions(reader(), input);
assert.deepEqual(compiled.blockers, []);
assert.equal(compiled.definitions.length, Object.keys(source.ownedInitializations).length);
assert.equal(compiled.definitions.length, 18);
assert.equal(hash(compilePlayerBattleDefinitions(reader(), input)), hash(compiled));
assert.equal(hash({ initializations: input.initializations, media: input.characterMedia, sprites: input.sprites }), before);
const definitions = new Map(compiled.definitions.map((d) => [d.sourceId, d]));
const media = [];
for (const definition of compiled.definitions) {
  const template = source.ownedInitializations[definition.sourceId];
  for (const [key, value] of Object.entries(template.confirmed)) assert.equal(definition[key], value);
  assert.equal(definition.level, template.initial.level);
  assert.equal(definition.exp, template.initial.exp);
  assert.equal(definition.name, name(template.nameKey));
  assert.deepEqual(definition.abilities, []);
  assert.deepEqual(definition.commands, []);
  assert.equal(definition.ownedAbilities, undefined);
  assert.equal(definition.sprites.mount, null);
  const sprite = source.sprites[definition.sprites.idle];
  assert.equal(sha(snapshotFile(snapshot, sprite.file)), sprite.sha256);
  const files = exported.sources.filter((s) => s.file.endsWith("/" + sprite.source.file));
  assert.equal(files.length, 1);
  assert.equal(sha(await readFile(resolve(root, "build/runtime/game", files[0].file))), files[0].sha256);
  media.push({ sourceId: definition.sourceId, key: definition.sprites.idle, ...sprite.source,
    sourceFileSha256: files[0].sha256, imageSha256: sprite.sha256 });
}
// Check the actual source-2 values separately from first-join level correction.
assert.deepEqual({ level: definitions.get(2).level, hp: definitions.get(2).hp, mp: definitions.get(2).mp,
  physical: definitions.get(2).physical }, { level: 1, hp: 48, mp: 7,
  physical: { attack: 40, strength: 37, accuracy: 100, criticalRate: 3 } });
const rejected = [];
for (const [label, change, pattern] of [
  ["missing-initialization", (x) => { delete x.initializations[2]; x.sourceIds = [2]; }, /Missing source owned initialization/],
  ["invented-learned-skill", (x) => { x.initializations[2].initial.abilities.owned.find((a) => a.skillLevel === 0).skillLevel = 100; }, /differs from source/],
  ["invented-level", (x) => { x.initializations[2].initial.level = 99; }, /differs from source/],
  ["missing-character-media", (x) => { delete x.characterMedia[2]; }, /source character media/],
  ["wrong-character-media", (x) => { x.characterMedia[2].spriteGroup = x.characterMedia[1].spriteGroup; }, /source character media/],
  ["missing-ordinary-pose", (x) => { delete x.sprites[definitions.get(2).sprites.idle]; }, /exact ordinary battle pose/],
  ["ambiguous-ordinary-pose", (x) => { const k = definitions.get(2).sprites.idle; x.sprites[k.toLowerCase()] = structuredClone(x.sprites[k]); }, /exact ordinary battle pose/],
  ["rounded-unity-identity", (x) => { x.sprites[definitions.get(2).sprites.idle].source.objectId = Number.MAX_SAFE_INTEGER + 2; }, /source identity/],
]) {
  const mutated = { ...structuredClone({ ...input, name: undefined }), name, sourceIds: [2] };
  change(mutated);
  const result = compilePlayerBattleDefinitions(reader(), mutated);
  assert.equal(result.definitions.length, 0, label);
  assert.equal(result.blockers.length, 1, label);
  assert.match(result.blockers[0].reasons.join(), pattern, label);
  rejected.push({ name: label, stage: result.blockers[0].stage });
}
// The ordinary compiler remains narrow. The published package explicitly adds
// the independently compiled appearance actor before removing its 607 blocker.
assert.equal(published.common.qualificationContext.mode, "source");
assert.equal(published.common.qualificationContext.conditionContext, "current");
for (const definition of compiled.definitions) {
  const enriched = published.gameState.battleDefinitions.find((d) => d.sourceId === definition.sourceId);
  assert.deepEqual(enriched, { ...definition,
    appearance: source.battleAppearance.actors[definition.sourceId],
    battleRequirements: { ...definition.battleRequirements, forbiddenConditionTypes: [] } });
}
assert.match(battleDefinitionBlocker([{ ...definitions.get(2), conditionIds: [53] }],
  published.common.qualificationContext, published.common.conditions), /特殊战斗外观/);
assert.match(battleDefinitionBlocker([definitions.get(2)],
  { ...published.common.qualificationContext, mode: "development-static" }, published.common.conditions), /来源战斗入口/);
// These potential definitions do not create owners. Only the source join
// transaction may acquire a character, equipment and initial learning history.
const content = structuredClone(published.gameState);
const make = () => new GameState(content, published.common.players, published.contentHash, published.common.conditions);
const state = make(), original = state.snapshot();
assert.deepEqual(original.roster.map((p) => p.sourceId), published.common.players.map((p) => p.sourceId));
assert.equal(original.roster.some((p) => p.sourceId === 2), false);
const join = compileRosterLifecycleEvent("メンバー加入：ロック", corpus.tables).command;
assert.equal(join.sourceId, 2);
assert.equal(join.recovery, false);
assert.equal(join.refitEquipment, false);
const pending = state.fieldRoster.prepare({ ...join, refreshActors: false });
assert.deepEqual(state.snapshot(), original);
pending.commit();
assert.equal(state.battlePartyBlocker, null);
const joined = state.snapshot(), owner = joined.roster.find((p) => p.sourceId === 2);
assert.deepEqual({ id: owner.id, level: owner.level, exp: owner.exp, hp: owner.hp, maxHp: owner.maxHp },
  { id: "player:2", level: 5, exp: 400, hp: 48, maxHp: 102 });
assert.deepEqual(owner.abilities, published.gameState.characterInitializations[owner.id].initial.abilities);
const restored = make(); restored.restore(JSON.parse(JSON.stringify(joined)));
assert.deepEqual(restored.snapshot(), joined);
assert.deepEqual(restored.partyPlayers(), state.partyPlayers());
const lease = restored.openBattle(Number(Object.keys(published.encounters)[0]));
const players = restored.battlePlayers(lease), player = players.find((p) => p.sourceId === 2);
assert.equal(player.hp, owner.hp);
assert.equal(player.maxHp, owner.maxHp);
assert.equal(player.level, owner.level);
assert.deepEqual(player.ownedAbilities.abilities, owner.abilities);
assert.deepEqual(player.sprites, definitions.get(2).sprites);
assert.deepEqual(restored.snapshot(), joined);
restored.cancelBattle(lease);
assert.deepEqual(restored.snapshot(), joined);

// The actual host derives exclusions from its current field and transport,
// supplies the lease equipment snapshot and executes both appearance paths.
const runtimeField = JSON.parse(await readFile(resolve(root, option("--field", "build/game/narshe.json")), "utf8"));
const probe = { file: "controlled-source-player-entry", assetPath: "shared-host" };
runtimeField.scripts.controlled_join = [
  { kind: "roster", command: join, dependencies: [], script: "controlled_join", index: 0, source: probe },
  { kind: "exit", script: "controlled_join", index: 1, source: probe },
];
runtimeField.scriptSystemFlags.controlled_join = { keepBadStatusVisual: false };
const runtime = new GameSession(runtimeField, published, 29);
assert.equal(runtime.field.startEvent("controlled_join"), true); runtime.advance(10);
assert.equal(runtime.field.stop, null);
assert.deepEqual(runtime.state.snapshot(), joined);
assert.equal(runtime.field.partyActorCheckpoint.context.puppets[3].fieldAssetId, 2);
const saved = runtime.checkpoint();
const session = GameSession.restore(JSON.parse(JSON.stringify(saved)), runtimeField, published);
const enter = (session, field) => {
  field.scripts.controlled_entry = [{ kind: "encounter", party: lease.encounterId,
    continuation: "controlled_return", script: "controlled_entry", index: 0, source: probe }];
  field.scripts.controlled_return = [{ kind: "exit", script: "controlled_return", index: 0, source: probe }];
  assert.equal(session.field.startEvent("controlled_entry"), true); session.advance(10);
  assert.ok(session.battle, session.field.stop?.message);
};
enter(session, runtimeField);
const game = session.battle, battleContent = game.content;
assert.deepEqual(battleContent.qualificationContext.invalidContentIds, [16, 17, 23, 412, 1309]);
assert.equal(battleContent.qualificationContext.itemMenuAvailable, null, "a common flag does not grant individual item eligibility");
const entered = game.players.find((p) => p.sourceId === 2);
assert.equal(entered.hp, owner.hp); assert.equal(entered.maxHp, owner.maxHp); assert.equal(entered.level, owner.level);
assert.equal(entered.appearanceState.magitek, null);
assert.deepEqual(entered.ownedAbilities.abilities, owner.abilities);
const qualification = game.commandQualification(owner.id);
assert.equal(qualification.entries.find((e) => e.commandId === 26).released, false);
assert.ok(qualification.entries.some((e) => e.commandId === 1 && e.abilityIds.includes(1)));
assert.equal(game.commandMenu(owner.id).find((entry) => entry.id === 1).available, true);
assert.equal(game.appearanceFrame(owner.id, { key: "default", bodyFrame: 0, armorFrame: 0 }).armor, null);
assert.equal(game.players.filter((p) => p.appearanceState.magitek).length, 3);
assert.deepEqual(session.state.snapshot(), joined);

// Re-equipping uses the new owner's current slots, not this static definition.
const empty = content.equipmentSystem.catalog.characters[2].emptySlots[0];
assert.equal(restored.changeEquipment(owner.id, 1, empty), true);
const changed = restored.partyPlayers().find((p) => p.sourceId === 2);
assert.notEqual(changed.physical.attack, player.physical.attack);
assert.equal(changed.hp, owner.hp);
assert.deepEqual(changed.ownedAbilities.abilities, player.ownedAbilities.abilities);
const equipmentField = structuredClone(runtimeField);
const equipmentSession = GameSession.restore(JSON.parse(JSON.stringify(saved)), equipmentField, published);
assert.equal(equipmentSession.changeEquipment(owner.id, 1, empty), true);
enter(equipmentSession, equipmentField);
assert.equal(equipmentSession.battle.players.find((p) => p.sourceId === 2).physical.attack, changed.physical.attack);
const uniqueSources = [...new Map(compiled.dependencies.flatMap((d) => d.sources).map((s) => [hash(s), s])).values()];
const report = {
  formatVersion: 1, lane: "source-controlled-player-battle-templates", sourceSetHash: source.parentSourceSetHash,
  sourceContentHash: source.contentHash, catalogHash: published.contentHash, nativeDependencies,
  definitions: compiled.definitions.map((d) => ({ sourceId: d.sourceId, id: d.id, level: d.level, hp: d.hp, mp: d.mp,
    physical: d.physical, sprites: d.sprites, emptyActionLists: true })),
  blockers: compiled.blockers, initializationBlockers: source.ownedInitializationBlockers,
  sourceRows: uniqueSources.length, sourceRowsHash: hash(uniqueSources), media,
  rejected, controlledEntry: { sourceId: owner.sourceId, id: owner.id, level: owner.level, exp: owner.exp,
    hp: owner.hp, maxHp: owner.maxHp, sourceDefinitionLevel: definitions.get(2).level, refreshActors: true,
    saveRestore: true, sourceQualification: true, reequippedAttack: changed.physical.attack,
    ordinaryContext: battleContent.qualificationContext, actualGameSessionEntry: true,
    sourceMountedPlayers: 3, sourceOrdinaryPlayers: 1, ownedAbilitiesUnchanged: true },
  initialOwnerIds: original.roster.map((p) => p.sourceId), requiredContext: compiled.requiredContext,
  limitations: compiled.limitations, originalGameExecution: false, storyReachability: false,
};
const text = JSON.stringify({ ...report, contentHash: hash(report) }, null, 2) + "\n";
await writeFile(reportPath, text);
console.log(JSON.stringify({ definitions: report.definitions.length, initializationBlockers: Object.keys(source.ownedInitializationBlockers).length,
  sourceRows: report.sourceRows, exactMedia: media.length, rejected: rejected.length,
  controlledEntry: report.controlledEntry, reportSha256: sha(text) }, null, 2));
