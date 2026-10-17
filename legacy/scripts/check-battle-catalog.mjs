// Source encounter data + controlled field launch/return, through real owners.
// This does not claim the holdout parties occur in the migrated main story.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url)), args = process.argv.slice(2), options = new Map();
for (let i = 0; i < args.length; i += 2) {
  assert.ok(["--dist", "--catalog", "--report"].includes(args[i]) && args[i + 1] &&
    !args[i + 1].startsWith("--") && !options.has(args[i]), "Use --dist/--catalog/--report <path>");
  options.set(args[i], args[i + 1]);
}
const dist = resolve(root, options.get("--dist") ?? "dist");
const load = (name) => import(pathToFileURL(resolve(dist, "src", name + ".js")));
const reportPath = resolve(root, options.get("--report") ?? "build/reports/battle-catalog-check.json");
const report = { kind: "battle-catalog-check-v1", result: "running", checks: [], journeys: [],
  lane: "source-data-with-controlled-field-launch", originalGameExecuted: false,
  mainStoryCoverage: false, originalPresentation: false,
  controlledInputs: ["Private field event scripts launch source parties 3002 and 3035 and return through an authored Exit",
    "No source party, owned roster, equipment, abilities, inventory, enemy HP or reward quantities are changed",
    "Private dependency mutations exercise compiler failures; they are not source content additions",
    "In-memory save storage; no user save slot or browser presentation is used"] };
await mkdir(resolve(reportPath, ".."), { recursive: true });
await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
try {
  const [{ compileOpeningBattle, battleTableIndex }, { compileOpeningPlayable },
    { compileBattleEncounterRuntime }, { compileParameterLimits }, { compilePhysicalLimits },
    { readSnapshot, snapshotFile }, { hash }, { verifyContent }, { GameSession }, { CheckpointStorage }] = await Promise.all([
    load("compiler/battle"), load("compiler/opening-playable"), load("compiler/battle-encounter-runtime"),
    load("compiler/parameters"), load("compiler/physical-parameters"), load("compiler/integrity"),
    load("compiler/content"), load("core/content-integrity"), load("core/game-session"), load("core/saved-game"),
  ]);
  const source = await compileOpeningBattle(root), compiled = await compileOpeningPlayable(root, source);
  const catalog = await verifyContent(JSON.parse(await readFile(resolve(root,
    options.get("--catalog") ?? "build/game/opening-playable.json"), "utf8")));
  assert.equal(catalog.contentHash, compiled.contentHash, "Published catalog must use the current selected source batch and compiler");
  assert.deepEqual(catalog.encounterReport, compiled.encounterReport);
  const tables = JSON.parse(snapshotFile(await readSnapshot(resolve(root, "build/import")), "tables.json"));
  const exported = JSON.parse(snapshotFile(await readSnapshot(resolve(root, "build/battle")), "battle.json"));
  const reader = battleTableIndex(tables, exported.tableSources);
  assert.deepEqual(source.encounterPartyIds, exported.encounterPartyIds);
  for (const id of [1, 2, 3, 42, 3002, 3035]) {
    assert.ok(source.encounterPartyIds.includes(id), "Required source holdout/regression is not selected: " + id);
    assert.ok(catalog.encounters[id], "Required source party did not compile: " + id);
  }
  assert.equal(catalog.encounterReport.requested, source.encounterPartyIds.length);
  assert.equal(catalog.encounterReport.compiledDefinitions + catalog.encounterReport.blocked,
    catalog.encounterReport.requested);
  assert.equal(catalog.encounterReport.originalGameExecuted, false);
  report.sourceSetHash = source.parentSourceSetHash; report.battleSourceSetHash = source.sourceSetHash;
  report.sourceContentHash = source.contentHash; report.catalogHash = catalog.contentHash;
  report.catalog = catalog.encounterReport;
  const check = (name, details = {}) => report.checks.push({ name, result: "pass", ...details });
  check("selected-source-batch-and-current-runtime-catalog", { ids: source.encounterPartyIds });

  for (const id of [3002, 3035]) {
    const row = tables["monster_party.csv"].find((r) => Number(r.id) === id), runtime = catalog.encounters[id];
    assert.ok(row); assert.equal(Number(row.script_name), 0); assert.equal(Number(row.battle_flag_group_id), 0);
    const expected = Array.from({ length: 9 }, (_, n) => n + 1).filter((slot) => Number(row[`monster${slot}`]))
      .map((slot) => [`enemy:${slot}`, Number(row[`monster${slot}`]), { x: Number(row[`monster${slot}_x_position`]),
        y: Number(row[`monster${slot}_y_position`]), group: Number(row[`monster${slot}_group`]) }]);
    assert.deepEqual(runtime.enemies.map((e) => [e.id, e.sourceId, e.placement]), expected);
    assert.equal(runtime.formation, Number(row.battle_pattern3) ? "opposed" : "normal");
    assert.ok(expected.length > 1, "Holdout must exercise a multi-enemy formation");
    assert.equal(catalog.encounterDiagnostics.filter((d) => d.partyId === id &&
      ["battle-script", "battle-flags"].includes(d.code)).length, 0);
    for (const enemy of runtime.enemies) {
      const monster = tables["monster.csv"].find((r) => Number(r.id) === enemy.sourceId);
      assert.equal(enemy.exp, Number(monster.exp)); assert.equal(enemy.gil, Number(monster.gill));
      assert.ok(catalog.common.sprites[enemy.sprites.idle]);
    }
    check("holdout-source-slots-media-and-rewards-" + id, { enemies: expected.length, formation: runtime.formation });
  }
  assert.ok(catalog.encounterDiagnostics.some((d) => d.partyId === 3035 && d.kind === "runtime-dependency" &&
    d.dependency?.id === 696 && d.pc === 10), "The unimplemented wolf branch must remain visible");
  for (const id of [1, 2, 3, 42]) assert.ok(catalog.encounterDiagnostics.some((d) => d.partyId === id &&
    d.kind === "development-omission" && d.code === "battle-script"));
  check("conditional-abilities-and-existing-script-omissions-remain-explicit");

  const zero = { hp: 0, mp: 0, magic: 0, vitality: 0, attack: 0, defense: 0, magicDefense: 0,
    agility: 0, weight: 0, evasion: 0, magicEvasion: 0 };
  const legacy = source.encounters.find((e) => e.partyId === 1);
  assert.equal(catalog.encounters[1].lifecycle.mode, "development-omission");
  const input = { requestedPartyIds: source.encounterPartyIds, encounters: source.encounters,
    sourceDiagnostics: source.encounterDiagnostics, abilities: catalog.common.abilities, conditions: catalog.common.conditions,
    sprites: source.sprites, name: (key) => {
      const monster = Object.values(source.tables["monster.csv"]).find((r) => r.values.mes_id_name === key);
      const known = Object.values(catalog.encounters).flatMap((e) => e.enemies)
        .find((e) => e.sourceId === Number(monster?.values.id));
      assert.ok(known, "Probe has no independently compiled source name"); return known.name;
    },
    parameters: { temporary: zero, limits: compileParameterLimits(reader).values },
    physical: { temporary: { attack: 0, strength: 0, accuracy: 0, criticalRate: 0 }, limits: compilePhysicalLimits(reader).values },
    development: { scripts: [{ id: 8010, source: legacy.script.source, reason: catalog.encounters[1].lifecycle.reason }],
      flagGroups: [{ id: 11, rows: legacy.metadata.battleFlags, reason: "Existing explicit development omission" }] } };
  for (const [label, mutate, code] of [
    ["missing-monster", (e) => { e.enemies[0].monsterId = 2147483647; }, "enemy-provider"],
    ["missing-media", (e) => { e.enemies[0].sprite = "controlled-missing-sprite"; }, "enemy-provider"],
    ["unsupported-script", (e) => { e.metadata.scriptId = 2147483647; e.script = structuredClone(legacy.script); }, "battle-script"],
    ["unsupported-reward", (e) => { e.metadata.getAp = 1; }, "party-rewards"],
    ["missing-ability", (e) => {
      const op = e.enemies[0].ai.data.Mnemonics.find((m) => m.mnemonic === "Act");
      assert.ok(op); op.operands.iValues = [2147483647]; op.operands.rValues = [];
    }, "ability-reference"],
  ]) {
    const candidate = { ...input, encounters: structuredClone(input.encounters) };
    mutate(candidate.encounters.find((e) => e.partyId === 3002));
    const result = compileBattleEncounterRuntime(reader, candidate);
    assert.equal(result.encounters[3002], undefined, label);
    for (const id of [1, 2, 3, 42, 3035]) assert.deepEqual(result.encounters[id], catalog.encounters[id], label);
    assert.ok(result.diagnostics.some((d) => d.partyId === 3002 && d.kind === "blocked" && d.code === code), label);
    check("isolated-" + label, { retainedDefinitions: Object.keys(result.encounters).length });
  }
  const changedTables = structuredClone(tables);
  changedTables["monster.csv"].find((r) => r.id === "26").initial_condition = "9";
  const failedState = compileBattleEncounterRuntime(battleTableIndex(changedTables, exported.tableSources), input);
  assert.deepEqual(Object.keys(failedState.encounters), ["3", "3002"]);
  check("unimplemented-initial-state-blocks-only-dependent-parties");

  const field = await verifyContent(JSON.parse(await readFile(resolve(root, "build/game/narshe.json"), "utf8")));
  const controlledField = structuredClone(field), returnScript = "controlled_catalog_return";
  const origin = { file: "controlled-battle-catalog", assetPath: "Fixtures/BattleCatalog/events.json" };
  controlledField.scripts[returnScript] = [{ kind: "exit", script: returnScript, index: 0, source: origin }];
  for (const id of [3002, 3035]) {
    const script = `controlled_catalog_${id}`;
    assert.equal(field.scripts[script], undefined);
    controlledField.scripts[script] = [
      { kind: "encounter", party: id, continuation: returnScript, script, index: 0, source: origin },
      { kind: "exit", script, index: 1, source: origin },
    ];
  }
  const { contentHash: oldHash, ...payload } = controlledField;
  controlledField.contentHash = hash(payload); await verifyContent(controlledField);
  let session = new GameSession(controlledField, catalog);
  const memory = new Map(), storage = new CheckpointStorage({ getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => { memory.set(key, value); } });
  for (const id of [3002, 3035]) {
    const before = session.state.snapshot(), partyIds = session.state.activeParty.map((p) => p.id);
    assert.equal(session.field.startEvent(`controlled_catalog_${id}`), true);
    session.advance(10); assert.ok(session.battle, session.field.stop?.message);
    assert.equal(session.battle.content.encounterId, id);
    assert.deepEqual(session.battle.enemies.map((e) => [e.id, e.sourceId]), catalog.encounters[id].enemies.map((e) => [e.id, e.sourceId]));
    assert.deepEqual(session.battle.players.map((p) => p.id), partyIds);
    let commands = 0;
    for (let tick = 0; tick < 16000 && session.battle.phase === "active"; tick++) {
      const battle = session.battle;
      for (const actor of battle.ready) {
        const ally = battle.players.find((p) => p.hp > 0 && p.hp < p.maxHp * 0.6);
        const target = ally ?? battle.targets(actor.id, 218)[0];
        if (target && battle.command(actor.id, ally ? 222 : 218, target.id)) commands++;
      }
      session.advance(50);
    }
    assert.equal(session.battle.phase, "victory", session.field.stop?.message); assert.ok(commands > 0);
    assert.deepEqual(session.state.snapshot(), before, "Victory presentation must not publish its reward");
    const reward = structuredClone(session.battle.reward), returnOps = session.field.content.scripts[returnScript];
    const expectedGil = catalog.encounters[id].enemies.reduce((sum, e) => sum + e.gil, 0);
    const eligibleCount = session.battle.players.filter((p) => p.hp > 0).length;
    const expectedExp = Math.floor(catalog.encounters[id].enemies.reduce((sum, e) => sum + e.exp, 0) / eligibleCount);
    assert.equal(reward.gil, expectedGil); assert.equal(reward.each, expectedExp);
    delete session.field.content.scripts[returnScript];
    assert.throws(() => session.continueVictory(), /Missing battle continuation/);
    assert.deepEqual(session.state.snapshot(), before);
    session.field.content.scripts[returnScript] = returnOps;
    assert.equal(session.continueVictory(), true);
    const awarded = session.state.snapshot();
    assert.equal(awarded.gil, before.gil + expectedGil);
    assert.equal(session.continueVictory(), false); assert.deepEqual(session.state.snapshot(), awarded);
    for (let n = 0; n < 100 && !session.checkpointReady; n++) session.advance(10);
    assert.equal(session.battle, null); assert.equal(session.checkpointReady, true);
    const checkpoint = session.checkpoint(); await storage.save(checkpoint, report.journeys.length);
    session = GameSession.restore((await storage.load()).checkpoint, controlledField, catalog);
    assert.deepEqual(session.checkpoint(), checkpoint);
    assert.equal(session.continueVictory(), false); assert.deepEqual(session.state.snapshot(), awarded);
    report.journeys.push({ encounterId: id, result: "pass", commands, enemies: catalog.encounters[id].enemies.length,
      sourceGil: expectedGil, eachExp: expectedExp, dropGrants: reward.dropPlan.grants,
      levels: awarded.roster.map((p) => p.level), completed: [...session.completedEncounters],
      savedAndRestored: true, failedReturnAtomic: true, duplicateRewardRejected: true });
  }
  assert.deepEqual(session.completedEncounters, [3002, 3035]);
  await verifyContent(catalog); await verifyContent(field); await verifyContent(controlledField);
  report.result = "pass"; report.checkCount = report.checks.length; report.journeyCount = report.journeys.length;
  report.final = { gil: session.gil, completed: [...session.completedEncounters] };
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: "pass", checks: report.checkCount, sourceJourneys: report.journeyCount,
    definitions: report.catalog.compiledDefinitions, runtimeDependencies: report.catalog.withRuntimeDependencies,
    report: reportPath }));
} catch (error) {
  report.result = "fail"; report.error = { name: error.name, message: error.message };
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  throw error;
}
