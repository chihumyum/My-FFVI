// Exact source instructions in explicitly authored mechanism harnesses. The
// original complete programs remain inspectable, including every blocker.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, ".."), args = process.argv.slice(2);
assert.ok(args.length === 0 || args.length === 2 && args[0] === "--compiled-dir" && args[1],
  "Use [--compiled-dir <directory>]");
const compiled = resolve(root, args[1] ?? "dist");
const load = name => import(pathToFileURL(resolve(compiled, name + ".js")).href);
const output = resolve(root, "build/reports/battle-event-state-check.json");
const report = { kind: "source-instruction-controlled-battle-event-state-v1", result: "running", stages: [],
  evidence: {
    lane: "manifest-bound-source-instructions-and-controlled-shared-state-session",
    originalGameExecuted: false, browserVerified: false, completeSourceProgramsExecuted: false,
    limitations: [
      "Complete source scripts are compiled for diagnostics; their unimplemented instructions remain blocked",
      "Executed programs are authored source:null harnesses containing specified unchanged source operations",
      "The native singleton writes immediately; publication at battle return is an explicit Web transaction protocol",
      "Synthetic combat, field entry, initial variable values, storage and host failure are controlled inputs",
      "No new source enemy party, map, story route or full migration is admitted by these probes",
    ],
  },
};
const stage = (name, details = {}) => report.stages.push({ name, result: "passed", ...details });
await mkdir(resolve(output, ".."), { recursive: true });
try {
  const [{ loadCorpus }, { compileBattleEvent }, { createBattleEventState, advanceBattleEvent },
    { EventState }, { BattleEventSharedState, battleEventSharedSnapshot }, { GameSession }, { GameFlow },
    { CheckpointStorage }, { contentDigest }, { checkpointFixture }] = await Promise.all([
    load("src/compiler/corpus"), load("src/compiler/battle-event"), load("src/core/battle-event"),
    load("src/core/event-state"), load("src/core/battle-event-shared"), load("src/core/game-session"),
    load("src/core/game-flow"), load("src/core/saved-game"), load("src/core/content-integrity"),
    load("tests/fixtures/checkpoint-game"),
  ]);
  const corpusBytes = await readFile(resolve(root, "build/corpus/corpus.json"));
  const corpus = await loadCorpus(root);
  const assets = corpus.assets.filter(asset => asset.kind === "script" &&
    /\/(?:Common)?BattleScript\/sc_b_[^/]+\.json$/.test(asset.source.assetPath ?? ""));
  assert.equal(assets.length, 53);
  const records = assets.map(asset => ({ name: basename(asset.source.assetPath, ".json"), asset,
    program: compileBattleEvent(asset.data, null) }));
  assert.equal(new Set(records.map(record => record.name)).size, records.length);
  const get = name => { const found = records.find(record => record.name === name); assert.ok(found, name); return found; };
  report.source = { sourceSetHash: corpus.sourceSetHash,
    manifestSha256: createHash("sha256").update(corpusBytes).digest("hex") };
  report.programs = records.map(({ name, asset, program }) => ({ name, source: asset.source,
    headerBlockers: program.blockers, instructions: program.instructions.length,
    blockers: program.instructions.flatMap((value, pc) => value.op.kind === "blocked"
      ? [{ pc, mnemonic: value.mnemonic, reason: value.op.reason }] : []),
  })).sort((a, b) => a.name.localeCompare(b.name));
  const selectedSites = [];
  const take = (name, pc, kind) => {
    const record = get(name), instruction = record.program.instructions[pc];
    assert.ok(instruction, name + ":" + pc); assert.equal(instruction.op.kind, kind);
    selectedSites.push({ name, pc, source: record.asset.source, raw: record.asset.data.Mnemonics[pc],
      compiled: instruction.op });
    return structuredClone(instruction.op);
  };
  const firstFlags = [take("sc_b_0067", 55, "variable-flag"), take("sc_b_0067", 56, "variable-flag")];
  const secondFlags = [take("sc_b_0071", 55, "variable-flag"), take("sc_b_0071", 56, "variable-flag")];
  const globalBranch = take("sc_b_0460_1", 5, "variable-branch");
  const globalRead = take("sc_b_0460_1", 59, "variable-calc");
  assert.deepEqual(firstFlags, [
    { kind: "variable-flag", ref: { category: "ScenarioFlag1", index: 52 }, operation: "set" },
    { kind: "variable-flag", ref: { category: "ScenarioFlag1", index: 53 }, operation: "reset" },
  ]);
  assert.deepEqual(secondFlags.map(op => [op.ref.index, op.operation]), [[53, "set"], [52, "reset"]]);
  assert.deepEqual(globalBranch, { kind: "variable-branch", left: { category: "ScenarioVariable", index: 3 },
    operator: "＝", right: { kind: "immediate", value: 1 }, target: 47 });
  assert.deepEqual(globalRead, { kind: "variable-calc", left: { category: "ScriptLocalVariable", index: 2 },
    operator: "←", right: { kind: "variable", ref: { category: "ScenarioVariable", index: 10 } } });
  const playerQueries = records.flatMap(record => record.asset.data.Mnemonics.flatMap((raw, pc) =>
    raw.mnemonic === "SysCall" && raw.operands.sValues[0] === "プレイヤーの状況で戦闘終了"
      ? [{ name: record.name, pc, op: take(record.name, pc, "players-ended") }] : []));
  assert.equal(playerQueries.length, 10);
  for (const name of ["sc_b_0067", "sc_b_0071", "sc_b_0460_1", "sc_b_0239", "sc_b_2026"])
    assert.ok(report.programs.find(program => program.name === name).blockers.length,
      name + " must not become a fully executable script merely because selected operations decode");
  report.selectedSites = selectedSites;
  stage("complete-source-programs-retain-blockers-and-specific-shared-operations-bind-to-original-pcs", {
    scripts: records.length, selectedSourceSites: selectedSites.length, playerEndQueries: playerQueries.length,
  });

  const authored = (ops, locals = [0, 0, 0, 0]) => ({ kind: "battle-event-v1", source: null,
    entry: 0, end: ops.length, localNames: locals.map((_, index) => "Controlled local " + index),
    initialLocals: [...locals], blockers: [], instructions: ops.map(op => ({ mnemonic: op.kind, op: structuredClone(op) })) });
  const execute = (program, shared, playersEnded = false) => {
    let state = createBattleEventState(program); const trace = [], writes = [];
    for (let clock = 0; clock < 10 && state.status !== "exited"; clock++) for (let boundary = 0; boundary < 256; boundary++) {
      const result = advanceBattleEvent(program, state, { clock, timeSeconds: clock / 100,
        started: true, aiCoreAlive: false, actionStaging: false, playersEnded,
        variables: { read: ref => shared.read(ref) } });
      trace.push({ clock, visited: result.visited, requests: result.requests }); state = result.state;
      for (const request of result.requests) {
        assert.equal(request.kind, "write-variable"); shared.write(request.ref, request.value); writes.push(request);
      }
      if (!result.requests.length) break;
      assert.notEqual(boundary, 255);
    }
    assert.equal(state.status, "exited"); return { state, trace, writes };
  };
  const empty = () => new BattleEventSharedState(battleEventSharedSnapshot(new EventState()));
  const sourceFlagCandidate = empty();
  execute(authored([...firstFlags, { kind: "exit" }]), sourceFlagCandidate);
  assert.deepEqual(sourceFlagCandidate.snapshot().scenario.slice(52, 54), [1, 0]);
  execute(authored([...secondFlags, { kind: "exit" }]), sourceFlagCandidate);
  assert.deepEqual(sourceFlagCandidate.snapshot().scenario.slice(52, 54), [0, 1]);
  stage("source-set-reset-pairs-write-known-values-without-defaulting-other-unknown-cells", {
    values: sourceFlagCandidate.snapshot().scenario.slice(52, 54),
    untouchedUnknown: sourceFlagCandidate.snapshot().scenario[54],
  });

  // Preserve the real branch's target 47. The surrounding labels, exit and
  // fallthrough are deliberately authored harness instructions, not a cut-down
  // claim that the original 0460_1 program ran successfully.
  const branchOps = Array.from({ length: 49 }, () => ({ kind: "nop" }));
  branchOps[0] = globalBranch; branchOps[1] = globalRead;
  branchOps[2] = { kind: "exit" }; branchOps[48] = { kind: "exit" };
  const branchCases = [];
  for (const value of [0, 1]) {
    const shared = empty(); shared.write({ category: "ScenarioVariable", index: 3 }, value);
    shared.write({ category: "ScenarioVariable", index: 10 }, 37);
    const run = execute(authored(branchOps), shared);
    assert.equal(run.state.locals[2], value === 0 ? 37 : 0);
    assert.equal(run.trace.some(frame => frame.visited.includes(48)), value === 1);
    branchCases.push({ inputGlobal3: value, locals: run.state.locals, trace: run.trace });
  }
  assert.throws(() => execute(authored(branchOps), empty()), /未知事件状态|Unknown/);
  stage("source-global-branch-and-local-read-use-current-shared-input-and-reject-unknown", { cases: branchCases });
  for (const query of playerQueries) for (const playersEnded of [false, true]) {
    const result = execute(authored([query.op, { kind: "exit" }], [7]), empty(), playersEnded);
    assert.equal(result.state.locals[0], playersEnded ? -1 : 7);
  }
  stage("all-exact-player-end-selectors-set-minus-one-only-when-current-player-query-is-true", {
    sourceSites: playerQueries.map(({ name, pc }) => ({ name, pc })), controlledCases: playerQueries.length * 2,
  });

  const fixture = checkpointFixture(), field = fixture.field, catalog = fixture.battle;
  catalog.common.battleEvents = { conditions: catalog.common.conditions.rules.definitions.map(({ id, type }) =>
    ({ id, type, attackTarget: type === 5 ? 1 : 0, gameOverTarget: type === 5 ? 1 : 0 })) };
  const returnProgram = flags => authored([
    { kind: "exec-ai" }, { kind: "blank" }, { kind: "sync-ai" },
    { kind: "branch", index: 0, operator: "＝", right: { kind: "immediate", value: 0 }, target: 0 },
    ...flags, globalRead,
    { kind: "variable-calc", left: { category: "ScenarioVariable", index: 3 }, operator: "←",
      right: { kind: "variable", ref: { category: "ScriptLocalVariable", index: 2 } } },
    { kind: "variable-flag", ref: { category: "TreasureFlag1", index: 9 }, operation: "set" },
    { kind: "exit" },
  ]);
  catalog.encounters[1000].lifecycle = { kind: "battle-lifecycle-v1", mode: "script", scriptId: 1, program: returnProgram(firstFlags) };
  catalog.encounters[1001] = { ...structuredClone(catalog.encounters[1000]), encounterId: 1001,
    lifecycle: { kind: "battle-lifecycle-v1", mode: "script", scriptId: 2, program: returnProgram(secondFlags) } };
  field.scripts.fight2 = field.scripts.fight.map(op => ({ ...structuredClone(op),
    script: "fight2", ...(op.kind === "encounter" ? { party: 1001 } : {}) }));
  field.scriptLocals = { ...field.scriptLocals,
    fight: { labels: ["Field-local owner"], values: [88] }, fight2: { labels: ["Field-local owner"], values: [99] } };
  field.entry.initialEventValues = [
    { ref: { category: "ScenarioFlag1", index: 52 }, value: 0 },
    { ref: { category: "ScenarioFlag1", index: 53 }, value: 1 },
    { ref: { category: "ScenarioVariable", index: 3 }, value: 0 },
    { ref: { category: "ScenarioVariable", index: 10 }, value: 37 },
    { ref: { category: "TreasureFlag1", index: 9 }, value: 0 },
  ];
  for (const content of [field, catalog]) {
    const { contentHash: _, ...payload } = content; content.contentHash = await contentDigest(payload);
  }
  report.controlled = { fieldHash: field.contentHash, catalogHash: catalog.contentHash,
    initializedValues: field.entry.initialEventValues, programHashes: await Promise.all([
      contentDigest(catalog.encounters[1000].lifecycle.program), contentDigest(catalog.encounters[1001].lifecycle.program) ]),
    sourceOperations: "0067/0071 flags and 0460_1 local read unchanged; loop, global write, treasure flag and synthetic encounter are authored",
  };
  const host = { visible: true, mediaReady: true, overlayOpen: false };
  let session = new GameSession(field, catalog, 314), flow = new GameFlow(session);
  flow.start(); flow.advance(0, host);
  const eventValues = state => ({ scenario: state.snapshot().scenario.slice(52, 54),
    global: [state.snapshot().global[3], state.snapshot().global[10]],
    treasure: state.snapshot().treasure[9], script: state.snapshot().script,
    scriptLabels: state.snapshot().scriptLabels });
  const win = (script, expected, failFirst = false) => {
    session.field.startEvent(script); flow.advance(10, host);
    assert.equal(flow.phase, "battle"); const battle = session.battle;
    const owner = session.state, fieldOwner = session.field, eventOwner = fieldOwner.eventState;
    const ownedBefore = owner.snapshot(), eventsBefore = eventOwner.snapshot();
    for (let tick = 0; tick < 3000 && battle.phase === "active"; tick++) {
      for (const player of battle.ready) {
        const target = battle.targets(player.id, 10)[0]; if (target) battle.command(player.id, 10, target.id);
      }
      flow.advance(10, host);
    }
    assert.equal(flow.phase, "victory"); assert.deepEqual(owner.snapshot(), ownedBefore);
    assert.deepEqual(eventOwner.snapshot(), eventsBefore, "Battle candidate cannot write the field singleton early");
    assert.deepEqual(battle.eventSharedReturn.candidate.scenario.slice(52, 54), expected);
    assert.equal(battle.eventSharedReturn.candidate.global[3], 37);
    assert.equal(battle.eventSharedReturn.candidate.treasure[9], 1);
    assert.equal(battle.eventExecution.state.locals[2], 37);
    if (failFirst) {
      const prepare = fieldOwner.prepareEncounterReturn;
      fieldOwner.prepareEncounterReturn = () => { throw new Error("Controlled return provider unavailable"); };
      try { assert.throws(() => flow.continueVictory(), /Controlled return provider unavailable/); }
      finally { fieldOwner.prepareEncounterReturn = prepare; }
      assert.equal(session.battle, battle); assert.equal(flow.phase, "victory");
      assert.deepEqual(owner.snapshot(), ownedBefore); assert.deepEqual(eventOwner.snapshot(), eventsBefore);
      stage("return-provider-failure-retains-owned-shared-state-and-retryable-result", { eventCandidate: battle.eventSharedReturn.candidate.scenario.slice(52, 54) });
    }
    assert.equal(flow.continueVictory(), true); assert.equal(flow.continueVictory(), false);
    flow.advance(10, host);
    assert.equal(session.state, owner); assert.equal(session.field, fieldOwner); assert.equal(session.field.eventState, eventOwner);
    assert.deepEqual(eventValues(eventOwner), { scenario: expected, global: [37, 37], treasure: 1,
      script: eventsBefore.script, scriptLabels: eventsBefore.scriptLabels });
    assert.equal(owner.snapshot().completedBattles.length, ownedBefore.completedBattles.length + 1);
    assert.equal(session.checkpointReady, true);
    stage(script === "fight" ? "victory-publishes-shared-banks-and-owned-reward-once-with-field-local-owner-preserved"
      : "restored-session-runs-opposite-source-flags-without-replaying-first-result", {
      event: battle.eventExecution, sharedAfter: eventValues(eventOwner), receipts: owner.snapshot().completedBattles,
    });
  };
  win("fight", [1, 0], true);
  const memory = new Map(), storage = new CheckpointStorage({ getItem: key => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, value) }, "framework");
  const saved = session.checkpoint(); await storage.save(saved, 1);
  const loaded = await storage.load(); assert.ok(loaded);
  session = GameSession.restore(loaded.checkpoint, field, catalog);
  assert.deepEqual(session.checkpoint(), saved);
  flow = new GameFlow(session); flow.start(); flow.advance(0, host);
  stage("storage-restore-retains-shared-flags-globals-and-unrelated-field-locals", {
    saveHash: loaded.contentHash, sharedAfter: eventValues(session.field.eventState),
  });
  win("fight2", [0, 1]);
  assert.deepEqual(await readFile(resolve(root, "build/corpus/corpus.json")), corpusBytes);
  stage("source-corpus-remains-unchanged");
  report.result = "passed";
} catch (error) {
  report.result = "failed"; report.error = String(error.stack ?? error); throw error;
} finally {
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: report.result, stages: report.stages.length, report: output }));
}
