// Source ownership and actor-roster checks. This prepares shared-state
// transactions; it never publishes a field session or runs the original game.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url)), args = process.argv.slice(2);
assert.ok(args.length === 0 || (args.length === 2 && args[0] === "--compiled-dir"), "Use --compiled-dir <directory>");
const compiled = resolve(root, args[1] ?? "dist");
const module = (name) => import(pathToFileURL(resolve(compiled, "src", name + ".js")).href);
const { loadCorpus } = await module("compiler/corpus");
const { readSnapshot, snapshotFile } = await module("compiler/integrity");
const { battleTableIndex } = await module("compiler/battle");
const { compileNewGame } = await module("compiler/new-game");
const { compileOrdinaryWeaponEffects } = await module("compiler/ordinary-weapon");
const { compileFieldPuppetActorCatalog } = await module("compiler/field-puppet-actors");
const { GameState } = await module("core/game-state");
const { createNewGame } = await module("core/new-game");
const { projectFieldPuppetRoster } = await module("core/field-puppet-roster");
const { fieldPuppetResidentIndex } = await module("core/field-puppet-actors");
const { EventState } = await module("core/event-state");
const { Transportations } = await module("core/transportation");
const { hash } = await module("compiler/content");
const sha = (value) => createHash("sha256").update(value).digest("hex");
const output = root + "build/reports/source-native-state-check.json";
await mkdir(root + "build/reports", { recursive: true });
await rm(output, { force: true });
const nativeReports = [];
for (const name of ["new-game", "field-puppet-actors"]) {
  execFileSync(process.execPath, [root + `scripts/check-${name}-native.mjs`], { cwd: root, stdio: "pipe" });
  const bytes = await readFile(root + `build/reports/${name}-native-check.json`);
  const report = JSON.parse(bytes);
  assert.equal(report.semanticsVerified, false);
  nativeReports.push({ name, sha256: sha(bytes), report });
}
const corpus = await loadCorpus(root);
const battle = JSON.parse(snapshotFile(await readSnapshot(root + "build/battle"), "battle.json"));
const field = JSON.parse(snapshotFile(await readSnapshot(root + "build/field"), "field.json"));
const publishedBytes = await readFile(root + "build/game/opening-playable.json");
const published = JSON.parse(publishedBytes), { contentHash, ...publishedBody } = published;
assert.equal(hash(publishedBody), contentHash);
assert.equal(battle.parentSourceSetHash, corpus.manifest.parentSourceSetHash);
assert.equal(field.parentSourceSetHash, corpus.manifest.parentSourceSetHash);
const sourceBattle = JSON.parse(await readFile(root + "build/game/opening-battle.json", "utf8"));
const { contentHash: sourceBattleHash, ...sourceBattleBody } = sourceBattle;
assert.equal(sourceBattleHash, hash(sourceBattleBody));
assert.equal(published.common.sourceContentHash, sourceBattleHash);
const nativeSource = corpus.manifest.sources.find((s) => s.file === "GameAssembly.dll");
for (const native of nativeReports) assert.equal(native.report.nativeSha256, nativeSource?.sha256);
const reader = () => battleTableIndex(corpus.tables, battle.tableSources);
const extra = corpus.assets.filter((asset) => asset.source.assetPath ===
  "Assets/GameAssets/Serial/Data/BattleExtraData/battle_extra_data.json");
assert.equal(extra.length, 1);
const effects = compileOrdinaryWeaponEffects(reader(), extra[0].data).catalog;
const definition = compileNewGame(reader(), corpus.tables, (key) => {
  assert.equal(typeof field.messages.system_zhc[key], "string");
  return field.messages.system_zhc[key];
}, effects).definition;
assert.deepEqual(published.gameState.sourceNewGame, definition);
const plan = createNewGame(definition);
const fresh = () => GameState.createNewGame(published.gameState, published.common.players, contentHash, published.common.conditions);
const development = () => new GameState(published.gameState, published.common.players, contentHash, published.common.conditions);
const state = fresh(), initial = state.snapshot();
const cases = [];
function check(name, fn) { fn(); cases.push({ name, pass: true }); }

check("bound fresh and development states have distinct owned-v9 initialization identities", () => {
  assert.equal(initial.formatVersion, 9);
  assert.equal(initial.initialization, "source-new-game");
  assert.deepEqual(initial.roster.map((member) => member.conditionIds), [[], [], []]);
  const old = development();
  assert.equal(old.initialization, "development-checkpoint");
  assert.equal(old.nativeState, null);
  assert.deepEqual(old.fieldPuppetRoster.current().owned.map((member) => member.conditionTypes), [[607], [607], [607]]);
});
check("all native initialization domains and the complete entry seed survive source creation", () => {
  assert.deepEqual(state.nativeState, { kind: "source-native-state-v1", entrySeed: plan.entry, ...plan.nativeInitialization });
  assert.equal(state.nativeState.ownedTransportationIds.length, 8);
  assert.equal(Object.keys(state.nativeState.parkedTransportationMapIds).length, 8);
  assert.ok(Object.values(state.nativeState.parkedTransportationMapIds).every((id) => id === -1));
  assert.equal(state.nativeState.entrySeed.beastExchangeFlags.length, 400);
  assert.equal(state.nativeState.entrySeed.mapId, 609);
  assert.equal(state.nativeState.entrySeed.scriptId, 1);
  assert.equal(state.nativeState.entrySeed.entrySynchronized, false);
});
check("puppet reads retain real source identities and all four owned-id cells", () => {
  assert.deepEqual(state.fieldPuppetRoster.current(), { owned: [
    { ownedId: 1, sourceId: 1, enabled: true, conditionTypes: [] },
    { ownedId: 2, sourceId: 31, enabled: true, conditionTypes: [] },
    { ownedId: 3, sourceId: 32, enabled: true, conditionTypes: [] },
  ], party: [1, 2, 3, 0] });
  const result = state.fieldPuppetRoster.current();
  result.owned[0].conditionTypes.push(999); result.party[0] = 999;
  const native = state.nativeState; native.entrySeed.mapId = 1; native.ownedTransportationIds.splice(0);
  assert.deepEqual(state.snapshot(), initial);
});
check("field entry selects from source-owned parking data and the independent EventState release flags", () => {
  const transportations = new Transportations(definition.transportation), events = new EventState(plan.events);
  const native = state.nativeState;
  assert.deepEqual(native.ownedTransportationIds, definition.transportation.definitions.map((entry) => entry.id));
  const result = transportations.projectMapEntry({ currentId: null,
    loadId: native.entrySeed.transportation.id, mapId: native.entrySeed.mapId,
    stayMapIds: native.parkedTransportationMapIds,
    availability: transportations.availability((ref) => events.read(ref)) });
  assert.equal(result.currentId, 1); assert.equal(result.currentType, 1); assert.equal(result.selected, true);
  assert.deepEqual(state.snapshot(), initial);
});

const draft = state.prepareFieldState();
check("source party and row53 conditions are visible only inside their shared candidate before publication", () => {
  draft.ports.party.prepare({ kind: "organize-slot", slot: 1, members: [32, null, 1, null], refreshActors: true }).commit();
  draft.ports.party.prepare({ kind: "select-slot", slot: 1, refreshActors: false }).commit();
  draft.ports.ownedConditions.prepare({ kind: "add-condition", conditionType: 607, target: 0 }).commit();
  assert.deepEqual(draft.ports.puppetRoster.current(), { owned: [
    { ownedId: 1, sourceId: 1, enabled: true, conditionTypes: [607] },
    { ownedId: 2, sourceId: 31, enabled: true, conditionTypes: [] },
    { ownedId: 3, sourceId: 32, enabled: true, conditionTypes: [607] },
  ], party: [3, 0, 1, 0] });
  assert.deepEqual(state.snapshot(), initial);
  assert.equal(draft.commit(), true); assert.equal(draft.commit(), false);
  assert.deepEqual(draft.ports.puppetRoster.current(), state.fieldPuppetRoster.current());
  assert.deepEqual(state.nativeState, initial.nativeState);
});

const misc = Object.values(battle.assets).filter((asset) => asset.source.assetPath ===
  "Assets/GameAssets/Serial/Data/Misc/serial_misc_assets.json");
assert.equal(misc.length, 1);
const actorCatalog = compileFieldPuppetActorCatalog(misc[0].data);
function actorContext(read) {
  return { player: "controlled:actual-player", camera: "controlled:camera",
    actors: ["controlled:actual-player", "controlled:puppet0", "controlled:puppet2"]
      .map((id) => ({ id, character: true, riding: false })),
    partyPuppets: ["controlled:puppet0", null, "controlled:puppet2", null], otherParties: [null, null, null],
    residents: actorCatalog.residents.map((entry) => ({ assetId: entry.assetId, actor: null })), entities: [],
    ...read, savedLeaderIndex: 0, conditionController: "present", companion: "absent",
    transport: { id: 1, typeId: 1 }, restorePartyInstruction: "absent" };
}
check("source resident resolution uses the complete owned read rather than confusing source ids with Corps ids", () => {
  const context = actorContext(draft.ports.puppetRoster.current());
  assert.equal(fieldPuppetResidentIndex(actorCatalog, context, 32), 0);
  assert.equal(fieldPuppetResidentIndex(actorCatalog, context, 1), 1);
  assert.equal(fieldPuppetResidentIndex(actorCatalog, context, 31), null);
  assert.ok(context.owned.some((member) => member.sourceId === 31), "outside owner must remain present");
});
check("published roster port follows later live disable and selected-party changes", () => {
  state.fieldRoster.prepare({ kind: "secede", sourceId: 1, removeEquipment: true, refreshActors: true }).commit();
  const read = draft.ports.puppetRoster.current();
  assert.equal(read.owned.find((member) => member.sourceId === 1).enabled, false);
  assert.equal(read.owned.length, 3);
  assert.deepEqual(read, state.fieldPuppetRoster.current());
  assert.equal(fieldPuppetResidentIndex(actorCatalog, actorContext(read), 1), null);
  assert.deepEqual(state.nativeState, initial.nativeState);
});
check("full source condition table is required for type projection and None rows are retained as catalog data", () => {
  const saved = state.snapshot(), definitions = published.common.conditions.rules.definitions;
  assert.ok(definitions.some((row) => row.type === 0));
  assert.deepEqual(projectFieldPuppetRoster(saved.roster, saved.party, definitions), state.fieldPuppetRoster.current());
  assert.throws(() => projectFieldPuppetRoster(saved.roster, saved.party, definitions.filter((row) => row.type !== 607)),
    /Unknown source puppet owned condition/);
});
check("JSON restore keeps the source mode and native domains without reseeding stock or conditions", () => {
  const saved = JSON.parse(JSON.stringify(state.snapshot()));
  saved.equipmentStock.find((entry) => entry.id === 200).count = 0;
  const restored = development();
  restored.restore(saved);
  assert.deepEqual(restored.snapshot(), saved);
  assert.equal(restored.initialization, "source-new-game");
  assert.deepEqual(restored.fieldPuppetRoster.current(), state.fieldPuppetRoster.current());
});
let rejectedNativeMutations = 0;
check("old schemas, missing origin and unimplemented native writes reject before publication", () => {
  const before = state.snapshot();
  const mutations = [
    (s) => { s.formatVersion = 7; }, (s) => { delete s.initialization; }, (s) => { delete s.nativeState; },
    (s) => { s.initialization = "development-checkpoint"; }, (s) => { s.nativeState = null; },
    (s) => { s.nativeState.ownedTransportationIds.pop(); },
    (s) => { s.nativeState.parkedTransportationMapIds[1] = 609; },
    (s) => { s.nativeState.entrySeed.mapId = 3; },
    (s) => { s.nativeState.entrySeed.savedPlayer.x = 10; },
    (s) => { s.nativeState.entrySeed.entrySynchronized = true; },
    (s) => { s.nativeState.entrySeed.beastExchangeFlags[0] = 1; },
    (s) => { s.nativeState.crystalFlags[0] = true; },
    ...["warehouseItems", "keywords", "ownedMagic", "ownedMagicStones"].map((key) => (s) => { s.nativeState[key].push(1); }),
    ...Object.keys(before.nativeState.counters).map((key) => (s) => { s.nativeState.counters[key] = 1; }),
  ];
  for (const mutate of mutations) {
    const invalid = structuredClone(before); mutate(invalid);
    assert.throws(() => state.restore(invalid)); assert.deepEqual(state.snapshot(), before);
    rejectedNativeMutations++;
  }
});
check("stale source drafts cannot publish their candidate party or overwrite current native state", () => {
  const draft = state.prepareFieldState(), before = state.snapshot();
  draft.ports.party.prepare({ kind: "select-slot", slot: 0, refreshActors: false }).commit();
  state.fieldInventory.prepare({ kind: "grant-gil", amount: 1 }).commit();
  const current = state.snapshot();
  assert.equal(draft.commit(), false);
  assert.deepEqual(state.snapshot(), current);
  assert.deepEqual(current.nativeState, before.nativeState);
});

const implementation = await Promise.all(["src/core/game-state.ts", "src/core/field-puppet-roster.ts",
  "src/core/source-native-state.ts"].map(async (file) => ({ file, sha256: sha(await readFile(root + file)) })));
const report = { formatVersion: 1, status: "pass", kind: "source-native-state-check",
  sourceSetHash: corpus.manifest.sourceSetHash, parentSourceSetHash: corpus.manifest.parentSourceSetHash,
  publishedCatalogHash: contentHash, publishedCatalogFileSha256: sha(publishedBytes),
  publishedProfile: published.common.profile, ownedFormatVersion: 8,
  sourceDefinitionHash: hash(definition), initialNativeStateHash: hash(initial.nativeState),
  nativeReports: nativeReports.map(({ name, sha256, report }) => ({ name, sha256,
    nativeSha256: report.nativeSha256, methods: report.methods?.length ?? null,
    rawRanges: report.rawRanges?.length ?? null, semanticsVerified: false })),
  implementation, cases,
  counts: { cases: cases.length, owners: initial.roster.length, conditionDefinitions: published.common.conditions.rules.definitions.length,
    ownedTransportations: initial.nativeState.ownedTransportationIds.length,
    beastExchangeFlags: initial.nativeState.entrySeed.beastExchangeFlags.length, rejectedNativeMutations },
  originalGameExecuted: false, semanticsVerified: false, newGameSessionPublished: false,
  limitations: ["This checker publishes only controlled shared ownership transactions, not actor refresh or a fresh field session.",
    "The retained entrySeed is initial provenance; current map, player and transportation remain separate field ownership.",
    "Parking, counter, warehouse, crystal, keyword and global magic transitions have no admitted writer in this schema.",
    "The full source corpus has more character/state capabilities than the admitted GameState roster; unknown active behavior stays blocked."] };
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ status: "pass", ...report.counts, ownedFormatVersion: 8,
  reportSha256: sha(await readFile(output)), originalGameExecuted: false, semanticsVerified: false }));
