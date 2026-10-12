// Real-source initialization and route checks. This does not launch new game,
// replay its prelude or claim that the map entry host can execute that route.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
assert.ok(
  args.length === 0 || (args.length === 2 && args[0] === "--compiled-dir"),
  "Use --compiled-dir <directory>",
);
const compiled = resolve(root, args[1] ?? "dist");
const module = (name) =>
  import(pathToFileURL(resolve(compiled, "src", name + ".js")).href);
const { readSnapshot, snapshotFile } = await module("compiler/integrity");
const { loadCorpus } = await module("compiler/corpus");
const { battleTableIndex } = await module("compiler/battle");
const { compileNewGame, compileNewGameRoute } =
  await module("compiler/new-game");
const { compileOrdinaryWeaponEffects } = await module(
  "compiler/ordinary-weapon",
);
const { decodeFieldOp } = await module("compiler/field");
const { createNewGame } = await module("core/new-game");
const { GameState } = await module("core/game-state");
const { EventState } = await module("core/event-state");
const { hash } = await module("compiler/content");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const reportPath = root + "build/reports/new-game-check.json";
await mkdir(root + "build/reports", { recursive: true });
await rm(reportPath, { force: true });
execFileSync(process.execPath, [root + "scripts/check-new-game-native.mjs"], {
  cwd: root,
  stdio: "pipe",
});
const nativeBytes = await readFile(
    root + "build/reports/new-game-native-check.json",
  ),
  native = JSON.parse(nativeBytes);
const corpus = await loadCorpus(root);
const project = JSON.parse(
  snapshotFile(await readSnapshot(root + "build/import"), "project.json"),
);
const battle = JSON.parse(
  snapshotFile(await readSnapshot(root + "build/battle"), "battle.json"),
);
const field = JSON.parse(
  snapshotFile(await readSnapshot(root + "build/field"), "field.json"),
);
const publishedBytes = await readFile(root + "build/game/opening-playable.json", "utf8");
assert.equal(native.semanticsVerified, false);
assert.equal(corpus.manifest.parentSourceSetHash, project.sourceSetHash);
assert.equal(battle.parentSourceSetHash, project.sourceSetHash);
assert.equal(
  corpus.manifest.sources.find((s) => s.file === "GameAssembly.dll")?.sha256,
  native.nativeSha256,
);
const reader = () => battleTableIndex(corpus.tables, battle.tableSources);
const extra = corpus.assets.filter(
  (a) =>
    a.source.assetPath ===
    "Assets/GameAssets/Serial/Data/BattleExtraData/battle_extra_data.json",
);
assert.equal(extra.length, 1);
const effects = compileOrdinaryWeaponEffects(reader(), extra[0].data).catalog;
const name = (key) => {
  const value = field.messages.system_zhc[key];
  assert.equal(
    typeof value,
    "string",
    "Missing exact new-game source name: " + key,
  );
  return value;
};
const before = hash(corpus.tables);
const result = compileNewGame(reader(), corpus.tables, name, effects);
const definition = result.definition,
  plan = createNewGame(definition);
const routeResult = compileNewGameRoute(reader(), definition, corpus.assets);
const route = routeResult.route;
const startScript = corpus.assets.find(
  (a) => a.source.assetPath === route.source.assetPath,
);
assert.ok(startScript);
const cases = [];
function check(name, body) {
  body();
  cases.push({ name, pass: true });
}
check(
  "source initial owner order is 1,31,32 with native owned identities 1,2,3",
  () => {
    assert.deepEqual(
      plan.owned.roster.map((p) => [p.sourceId, p.ownedId]),
      [
        [1, 1],
        [31, 2],
        [32, 3],
      ],
    );
    assert.deepEqual(
      plan.owned.roster.map((p) => p.level),
      [3, 1, 1],
    );
    assert.ok(
      plan.owned.roster.every(
        (p) => p.enabled && p.conditionIds.length === 0 && p.magicStoneId === 0,
      ),
    );
  },
);
check(
  "new game projects source Corps rows and released jobs without adding unowned templates",
  () => {
    assert.equal(plan.owned.party.selectedSlot, 0);
    assert.deepEqual(
      plan.owned.party.slots[0].map((c) => c.id),
      ["player:1", "player:31", "player:32", null],
    );
    assert.ok(plan.owned.party.slots.flat().every((c) => c.row === "front"));
    assert.ok(
      plan.owned.party.slots
        .slice(1)
        .flat()
        .every((c) => c.id === null),
    );
    assert.deepEqual(plan.owned.releasedJobIds, [1]);
  },
);
check(
  "all flag banks start known only for fresh creation; player release 900 is then enabled",
  () => {
    assert.ok(plan.events.scenario.every((v) => v === 0));
    assert.deepEqual(
      plan.events.treasure.flatMap((v, i) => (v === 1 ? [i] : [])),
      [900],
    );
    assert.ok(plan.events.treasure.every((v) => v === 0 || v === 1));
    for (const bank of [plan.events.global, plan.events.area, plan.events.map])
      assert.ok(bank.every((v) => v === 0));
    assert.equal(plan.events.currentMapId, null);
    assert.equal(plan.events.script, null);
    assert.equal(plan.events.selected, 0);
    assert.equal(plan.events.itemSelected, 0);
  },
);
check(
  "source Gil and important inventory are initialized once without giving test money",
  () => {
    assert.equal(plan.owned.gil, 3000);
    assert.equal(plan.owned.totalGil, 3000);
    assert.deepEqual(plan.owned.items, [{ id: 58, count: 1 }]);
  },
);
check(
  "source equipment ownership includes ordinary copies and native empty-slot Count",
  () => {
    assert.deepEqual(plan.owned.equipmentStock.filter((entry) => !definition.equipment.definitions[entry.id].empty), [
      { id: 95, count: 1 },
      { id: 104, count: 2 },
      { id: 201, count: 3 },
      { id: 216, count: 3 },
      { id: 244, count: 3 },
    ]);
    assert.deepEqual(plan.owned.equipmentStock.filter((entry) => definition.equipment.definitions[entry.id].empty), [
      { id: 93, count: 5 },
      { id: 197, count: 5 },
      { id: 198, count: 5 },
      { id: 199, count: 5 },
      { id: 200, count: 11 },
    ]);
  },
);
check(
  "global ability history is distinct from learned skill level and source name tags",
  () => {
    assert.equal(plan.owned.learnedAbilityIds.length, 63);
    assert.deepEqual(
      plan.owned.roster.map((p) => p.abilities.owned.length),
      [63, 4, 4],
    );
    assert.deepEqual(Object.keys(plan.owned.characterNames), ["TINA"]);
    assert.ok(plan.owned.learnedAbilityIds.includes(32));
    assert.equal(
      plan.owned.roster[0].abilities.owned.find((a) => a.abilityId === 32)
        .skillLevel,
      0,
    );
  },
);
check(
  "new-game start resolves map609 entrance1 script1 independently of map script609",
  () => {
    assert.deepEqual(
      [
        route.mapId,
        route.entrance,
        route.scriptId,
        route.scriptName,
        route.mapInitializerScriptId,
      ],
      [609, 1, 1, "sc_e_0001", 609],
    );
    assert.equal(
      route.contentHash,
      "d03b4052156ef1fedd279fd083b2e8f6ffd94a9dbcb2f1f8b5e926816782aa63",
    );
    assert.equal(route.source.objectId, "7846844822230752744");
    assert.deepEqual(plan.entry.transportation, { id: 1, type: 1, assetId: 0 });
  },
);
check(
  "source saved position and Beast seeds do not fabricate a synchronized field",
  () => {
    assert.equal(plan.entry.entrySynchronized, false);
    assert.deepEqual(plan.entry.savedPlayer, {
      x: 0,
      y: 0,
      layer: 10,
      direction: 4,
    });
    assert.equal(plan.entry.beastExchangeFlags.length, 400);
    assert.ok(plan.entry.beastExchangeFlags.every((v) => v === 0));
    assert.equal(plan.entry.beastSeekGroupId, 0);
    assert.deepEqual(
      plan.nativeInitialization.ownedTransportationIds,
      [1, 2, 3, 4, 5, 6, 7, 8],
    );
    assert.ok(
      Object.values(plan.nativeInitialization.parkedTransportationMapIds).every(
        (id) => id === -1,
      ),
    );
  },
);
check("fresh Config defaults are WAIT and source speed index2", () =>
  assert.deepEqual(plan.battlePreferences, { mode: "wait", speedIndex: 2 }),
);
check(
  "initialization is deterministic, detached, and leaves source records unchanged",
  () => {
    assert.deepEqual(createNewGame(definition), plan);
    const candidate = createNewGame(definition);
    candidate.events.scenario[0] = 1;
    candidate.owned.roster[0].hp = 0;
    assert.deepEqual(createNewGame(definition), plan);
    assert.equal(hash(corpus.tables), before);
  },
);
check(
  "restoration with an unknown event value never applies new-game zero defaults",
  () => {
    const saved = structuredClone(plan.events);
    saved.scenario[77] = null;
    saved.global[0] = 42;
    const restored = new EventState(saved);
    assert.throws(
      () => restored.read({ category: "ScenarioFlag1", index: 77 }),
      /未知事件状态/,
    );
    assert.equal(restored.read({ category: "ScenarioVariable", index: 0 }), 42);
  },
);
check(
  "later checkpoint Magitek and transport seeds cannot be inserted into new-game definition",
  () => {
    assert.throws(
      () =>
        createNewGame({
          ...definition,
          initialOwnedConditions: [{ id: "player:1", conditionIds: [53] }],
        }),
      /checkpoint fields/,
    );
    const forged = structuredClone(definition);
    forged.characters[0].template.initial.conditionIds.push(53);
    assert.throws(() => createNewGame(forged), /initial owned character state/);
    assert.equal(plan.events.treasure[905], 0);
  },
);
check(
  "incomplete field host prevents new-game publication despite initialized shared ownership",
  () => {
    assert.equal(plan.publication.state, "blocked");
    assert.deepEqual(plan.publication.missingProviders, [
      "source-new-game-field-host",
    ]);
  },
);
check("published source initializer creates shared ownership without checkpoint conditions or refill on restore", () => {
  const published = JSON.parse(publishedBytes);
  const { contentHash, ...body } = published;
  assert.equal(contentHash, hash(body));
  assert.equal(published.common.profile, "narshe-playability-v34");
  assert.equal(hash(published.gameState.sourceNewGame), hash(definition));
  const fresh = GameState.createNewGame(published.gameState, published.common.players,
    published.contentHash, published.common.conditions);
  const saved = fresh.snapshot();
  assert.equal(saved.formatVersion, 8);
  assert.deepEqual(saved.equipmentStock, plan.owned.equipmentStock);
  assert.deepEqual(saved.roster.map((member) => member.conditionIds), [[], [], []]);
  assert.deepEqual(saved.roster.map((member) => member.sourceId), [1, 31, 32]);
  saved.equipmentStock.find((entry) => entry.id === 200).count = 0;
  fresh.restore(saved);
  assert.deepEqual(fresh.snapshot(), saved);
  const development = new GameState(published.gameState, published.common.players,
    published.contentHash, published.common.conditions);
  assert.deepEqual(development.snapshot().roster.map((member) => member.conditionIds), [[53], [53], [53]]);
  assert.equal(fresh.snapshot().equipmentStock.find((entry) => entry.id === 200).count, 0);
});
const firstOperation = decodeFieldOp(
  startScript.data.Mnemonics[1],
  { script: route.scriptName, index: 1 },
  field.messages.scenario_zhc ?? {},
  corpus.tables,
);
check(
  "the actual start script requires an explicit source presentation host",
  () => {
    assert.equal(startScript.data.Mnemonics[1].mnemonic, "SysCall");
    assert.equal(firstOperation.kind, "source-presentation");
    assert.equal(firstOperation.command.kind, "advertisement-probe");
  },
);
const report = {
  formatVersion: 1,
  status: "pass",
  kind: "source-new-game-initialization-check",
  sourceSetHash: corpus.manifest.sourceSetHash,
  parentSourceSetHash: project.sourceSetHash,
  nativeReportHash: sha(nativeBytes),
  semanticsVerified: false,
  newGameSessionPublished: false,
  definitionHash: hash(definition),
  planHash: hash(plan),
  route,
  sourceDependencies: result.sources,
  routeDependencies: routeResult.sources,
  ordinaryWeaponEffectsSource: extra[0].source,
  initialOwnerSourceIds: plan.owned.roster.map((p) => p.sourceId),
  initialEquipmentStock: plan.owned.equipmentStock,
  nativeEmptyEquipmentStocks: plan.owned.equipmentStock.filter((entry) => definition.equipment.definitions[entry.id].empty),
  counts: {
    cases: cases.length,
    scenarioFlags: 1024,
    treasureFlags: 1024,
    globalVariables: 16,
    areaVariables: 8,
    mapVariables: 8,
    beastExchangeFlags: 400,
    createdOwners: 3,
    nativeEmptyEquipmentKinds: 5,
  },
  publication: plan.publication,
  firstSourceInstructionBlocker: firstOperation,
  cases,
  limitations: [
    "Only the data initializer and route are restored; opening script execution and fresh-session publication remain blocked.",
    "No restored session uses these known-zero defaults.",
    "Static DLL interpretation and controlled pure projections are not an original-game runtime oracle.",
  ],
};
await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify({
    status: report.status,
    cases: cases.length,
    owners: 3,
    published: false,
    report: reportPath,
  }),
);
