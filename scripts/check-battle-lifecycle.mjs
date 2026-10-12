// A complete source battle-root program on an explicitly controlled, already
// admitted source encounter. No source export or public content is rewritten.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { controlledAudioRuntime } from "./controlled-audio.mjs";

const root = resolve(import.meta.dirname, ".."), args = process.argv.slice(2), options = new Map();
for (let i = 0; i < args.length; i += 2) {
  assert.ok(["--compiled-dir", "--fixture-dir"].includes(args[i]) && args[i + 1] &&
    !args[i + 1].startsWith("--") && !options.has(args[i]),
  "Use [--compiled-dir <directory>] [--fixture-dir <ignored-output-directory>]");
  options.set(args[i], args[i + 1]);
}
const compiled = resolve(root, options.get("--compiled-dir") ?? "dist");
const load = name => import(pathToFileURL(resolve(compiled, "src", name + ".js")).href);
const output = resolve(root, "build/reports/battle-lifecycle-check.json");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const stage = (name, details = {}) => report.stages.push({ name, result: "passed", ...details });
const report = {
  kind: "source-program-controlled-battle-lifecycle-v1", result: "running", stages: [],
  evidence: {
    lane: "verified-source-battle-program-and-source-combat-in-controlled-session",
    scriptId: 9001, scriptSourcePartyId: 442, executedEnemyPartyId: 3002,
    controlledInputs: [
      "The full, unchanged sc_b_2001 source program is added to private party 3002, whose source script ID is zero",
      "Party 3002 enemies, AI, skills, media, formation, rewards and drop rules remain unchanged",
      "Other encounters retain their source-bound script/flag omissions; party 3002 has no source script or flag group",
      "Development checkpoint roster and a two-step walking policy; no added money, equipment, items, skills or character state",
      "One separate authored end-disabled program tests delayed settlement on the same source combat",
      "Headless audio acknowledgements and in-memory CheckpointStorage",
    ],
    limitations: [
      "The original party 442 is independently checked and its missing dependencies remain blocked",
      "Static compilation is not runtime admission for every script or encounter",
      "The Web host fixes action/progress then event then end-judgment order; Unity component relative timing is not certified",
      "End permission defaults true; normal victory still waits until the source root is no longer Ready; player defeat can precede root completion",
      "The existing omitted sc_b_0239 SysCalls are not implemented by executing a different complete program",
      "No original-game execution, story reachability, browser pixels or full migration claim",
    ],
    originalGameExecuted: false, browserVerified: false, fullSourceEncounterExecuted: false, fullGameMigration: false,
  },
};
await mkdir(resolve(output, ".."), { recursive: true });

try {
  const [{ compileOpeningBattle, battleTableIndex }, { compileOpeningPlayable },
    { compileBattleEncounterSources }, { compileBattleEncounterRuntime }, { compileBattleEvent },
    { parseBattleLifecycle }, { createBattleEventState, advanceBattleEvent, assertBattleEventExecutable },
    { compileParameterLimits }, { compilePhysicalLimits }, { readSnapshot, snapshotFile },
    { verifyContent, contentDigest }, { GameSession }, { GameFlow }, { CheckpointStorage },
    { loadCorpus }, { BattleGame }] = await Promise.all([
    load("compiler/battle"), load("compiler/opening-playable"), load("compiler/battle-encounters"),
    load("compiler/battle-encounter-runtime"), load("compiler/battle-event"), load("core/battle-lifecycle"),
    load("core/battle-event"), load("compiler/parameters"), load("compiler/physical-parameters"),
    load("compiler/integrity"), load("core/content-integrity"), load("core/game-session"),
    load("core/game-flow"), load("core/saved-game"), load("compiler/corpus"), load("core/battle"),
  ]);
  const paths = ["build/import/tables.json", "build/battle/battle.json", "build/game/narshe.json"];
  const inputBytes = await Promise.all(paths.map(path => readFile(resolve(root, path))));
  const [imported, exported, fieldExport] = await Promise.all([
    readSnapshot(resolve(root, "build/import")), readSnapshot(resolve(root, "build/battle")),
    readSnapshot(resolve(root, "build/field")),
  ]);
  assert.deepEqual(snapshotFile(imported, "tables.json"), inputBytes[0]);
  assert.deepEqual(snapshotFile(exported, "battle.json"), inputBytes[1]);
  const tables = JSON.parse(inputBytes[0]), media = JSON.parse(inputBytes[1]);
  const sourceField = await verifyContent(JSON.parse(inputBytes[2]));
  const source = await compileOpeningBattle(root), sourceCatalog = await compileOpeningPlayable(root, source);
  assert.equal(source.parentSourceSetHash, sourceField.parentSourceSetHash);
  assert.equal(sourceCatalog.common.fieldSourceSetHash, sourceField.sourceSetHash);
  const reader = battleTableIndex(tables, media.tableSources);
  const names = JSON.parse(snapshotFile(fieldExport, "field.json")).messages.system_zhc;
  const json = name => {
    const matches = Object.values(media.assets).filter(asset => asset.source.assetPath.endsWith("/" + name + ".json"));
    assert.equal(matches.length, 1, "Unresolved source JSON: " + name);
    const asset = matches[0], file = media.sources.find(s => s.file === asset.source.file || s.file.endsWith("/" + asset.source.file));
    assert.ok(file, "Unbound source JSON: " + name);
    return { data: asset.data, source: { ...asset.source, sha256: file.sha256,
      sourceSetHash: media.parentSourceSetHash, battleSourceSetHash: media.sourceSetHash } };
  };
  const spritePath = suffix => {
    const matches = Object.keys(media.sprites).filter(key => key.toLowerCase().endsWith(suffix.toLowerCase()));
    assert.equal(matches.length, 1, "Unresolved source sprite: " + suffix); return matches[0];
  };
  const partyRow = reader.row("monster_party.csv", 442), scriptRow = reader.row("script.csv", 9001);
  assert.equal(Number(partyRow.values.script_name), 9001);
  assert.equal(scriptRow.values.script_name, "sc_b_2001");
  const sourceScript = json(scriptRow.values.script_name), program = compileBattleEvent(sourceScript.data, sourceScript.source);
  assertBattleEventExecutable(program);
  assert.equal(program.instructions.length, 12);
  const lifecycle = parseBattleLifecycle({ kind: "battle-lifecycle-v1", mode: "script", scriptId: 9001, program });
  report.sourceProgram = { party: partyRow, script: scriptRow, source: sourceScript.source,
    programHash: await contentDigest(program), instructions: program.instructions };
  stage("complete-source-program-bound-through-script-table-and-asset-identity", {
    scriptId: 9001, instructions: program.instructions.length, source: sourceScript.source,
  });

  const corpus = await loadCorpus(root);
  const scriptAssets = corpus.assets.filter(asset => asset.kind === "script" &&
    /\/(?:CommonBattleScript|BattleScript)\/sc_b_[^/]+\.json$/.test(asset.source.assetPath));
  assert.equal(scriptAssets.length, 53, "The source scope includes the CommonBattleScript asset");
  const sameProgram = scriptAssets.find(asset => asset.source.assetPath === sourceScript.source.assetPath);
  assert.ok(sameProgram);
  assert.deepEqual(sameProgram.data, sourceScript.data);
  for (const key of ["sha256", "objectId", "serializedFile"])
    assert.equal(sameProgram.source[key], sourceScript.source[key]);
  assert.equal(basename(sameProgram.source.file), sourceScript.source.file);
  report.staticPrograms = scriptAssets.map(asset => {
    const name = basename(asset.source.assetPath, ".json"), bound = asset;
    try {
      // This lane analyzes the verified corpus, including an asset not in the
      // selected battle export. It does not invent a battle-export binding.
      const p = compileBattleEvent(bound.data, null);
      const blocked = p.instructions.flatMap((instruction, pc) => instruction.op.kind === "blocked"
        ? [{ pc, mnemonic: instruction.mnemonic, reason: instruction.op.reason }] : []);
      return { name, authoringName: bound.data.Name, source: bound.source,
        instructions: p.instructions.length, headerBlockers: p.blockers, blocked,
        complete: p.blockers.length === 0 && blocked.length === 0 };
    } catch (error) {
      return { name, authoringName: bound.data.Name, source: bound.source,
        complete: false, headerBlockers: [String(error.message ?? error)], blocked: [] };
    }
  }).sort((a, b) => a.name.localeCompare(b.name));
  assert.equal(report.staticPrograms.find(p => p.name === "sc_b_2001").complete, true);
  for (const name of ["sc_b_0239", "sc_b_2026"])
    assert.equal(report.staticPrograms.find(p => p.name === name).complete, false);
  stage("whole-script-scope-keeps-unknown-hosts-as-diagnostics", {
    scripts: report.staticPrograms.length, corpusSourceSetHash: corpus.sourceSetHash,
    completePrograms: report.staticPrograms.filter(p => p.complete).map(p => p.name),
    identityAliases: report.staticPrograms.filter(p => p.authoringName !== p.name).map(p => ({ asset: p.name, name: p.authoringName })),
  });

  const selected = compileBattleEncounterSources(reader, { partyIds: [442], json, spritePath });
  const zero = { hp: 0, mp: 0, magic: 0, vitality: 0, attack: 0, defense: 0,
    magicDefense: 0, agility: 0, weight: 0, evasion: 0, magicEvasion: 0 };
  const candidate = compileBattleEncounterRuntime(reader, {
    requestedPartyIds: selected.requestedPartyIds, encounters: selected.encounters, sourceDiagnostics: selected.diagnostics,
    abilities: sourceCatalog.common.abilities, conditions: sourceCatalog.common.conditions, sprites: media.sprites,
    name(key) { assert.equal(typeof names[key], "string", "Missing source monster name"); return names[key]; },
    parameters: { temporary: zero, limits: compileParameterLimits(reader).values },
    physical: { temporary: { attack: 0, strength: 0, accuracy: 0, criticalRate: 0 }, limits: compilePhysicalLimits(reader).values },
    development: { scripts: [], flagGroups: [] },
  });
  assert.equal(candidate.encounters[442], undefined);
  assert.ok(candidate.diagnostics.some(d => d.kind === "blocked"));
  report.candidateDiagnostics = candidate.diagnostics;
  stage("source-party-442-retains-independent-encounter-blockers", { report: candidate.report, diagnostics: candidate.diagnostics });

  // The source program is unchanged. Only these external host observations are
  // authored, allowing its Call/Return path to be observed between host frames.
  let vm = createBattleEventState(program), aiStarted = false;
  const trace = [];
  for (let clock = 0; clock < 8 && vm.status !== "exited"; clock++) {
    for (let boundary = 0; boundary < 16; boundary++) {
      const result = advanceBattleEvent(program, vm, { clock, timeSeconds: clock / 100,
        started: clock > 0, aiCoreAlive: aiStarted && clock < 5, actionStaging: false });
      trace.push({ clock, visited: result.visited, requests: result.requests, state: result.state });
      vm = result.state;
      for (const request of result.requests) if (request.kind === "exec-ai") aiStarted = true;
      if (!result.requests.length) break;
      assert.notEqual(boundary, 15, "Unexpected request loop");
    }
  }
  assert.equal(vm.status, "exited"); assert.deepEqual(vm.stack, []); assert.equal(vm.locals[0], 1);
  assert.ok(trace.some(t => t.visited.join(",").includes("6,11,7")), "Call must enter EventMain and return to Sync in order");
  assert.ok(new Set(trace.filter(t => t.state.pc === 5 && t.state.wait?.kind === "blank").map(t => t.clock)).size >= 3);
  stage("unchanged-program-call-return-and-multiclock-ai-polling", { observations: "controlled host input", trace });

  const field = structuredClone(sourceField), catalog = structuredClone(sourceCatalog), partyId = 3002;
  assert.ok(catalog.encounters[partyId]);
  assert.equal(catalog.common.qualificationContext.mode, "source");
  const encounter = catalog.encounters[partyId], originalEncounter = structuredClone(encounter);
  assert.equal(originalEncounter.lifecycle.mode, "none");
  const originalSource = source.encounters.find(e => e.partyId === partyId);
  assert.equal(originalSource.metadata.scriptId, 0); assert.equal(originalSource.metadata.battleFlagGroupId, 0);
  encounter.lifecycle = structuredClone(lifecycle);
  // This party has no source event. Add the explicit controlled program
  // combination while retaining every original catalog diagnostic.
  const oldDiagnostics = structuredClone(catalog.encounterDiagnostics);
  catalog.encounterDiagnostics.push({ partyId, kind: "development-omission", code: "controlled-lifecycle-substitution",
    reason: "Source 2001 / party 442 program on party 3002, solely for shared lifecycle verification",
    source: originalSource.source,
    dependency: { table: "script.csv", id: 9001 } });
  field.walkEncounters = { kind: "framework-walk-encounters-v1", id: "source-program-controlled-walking",
    minSteps: 2, maxSteps: 2, transportationIds: [field.entry.transportationId], parties: [{ partyId, weight: 1 }] };
  field.limitations.push("Controlled battle lifecycle probe: full source sc_b_2001 on existing party 3002, two-step walking; not source story reachability.");
  const reverted = structuredClone(catalog);
  reverted.encounters[partyId] = originalEncounter; reverted.encounterDiagnostics = oldDiagnostics;
  assert.deepEqual(reverted, sourceCatalog, "No combat or owned data may change in the private fixture");
  const seal = async content => {
    const { contentHash: _, ...payload } = content;
    content.contentHash = await contentDigest(payload); return verifyContent(content);
  };
  await seal(field); await seal(catalog);
  report.hashes = { sourceSetHash: source.parentSourceSetHash, battleSourceSetHash: source.sourceSetHash,
    sourceCompiledHash: source.contentHash, sourceCatalogHash: sourceCatalog.contentHash,
    sourceFieldHash: sourceField.contentHash, controlledFieldHash: field.contentHash, controlledCatalogHash: catalog.contentHash,
    files: Object.fromEntries(paths.map((path, index) => [path, sha(inputBytes[index])])) };
  stage("private-binding-preserves-source-combat-and-uses-one-event-owner", {
    actualEncounterId: partyId, originalLifecycle: originalEncounter.lifecycle,
    executedLifecycle: { mode: lifecycle.mode, scriptId: lifecycle.scriptId, source: program.source }, grants: [],
  });
  if (options.has("--fixture-dir")) {
    const directory = resolve(root, options.get("--fixture-dir"));
    assert.ok(directory.startsWith(resolve(root, "build") + "/"), "Browser fixture must stay inside ignored build/");
    await mkdir(directory, { recursive: true });
    await Promise.all([
      writeFile(resolve(directory, "field.json"), JSON.stringify(field) + "\n"),
      writeFile(resolve(directory, "catalog.json"), JSON.stringify(catalog) + "\n"),
      writeFile(resolve(directory, "manifest.json"), JSON.stringify({ kind: "controlled-battle-lifecycle-browser-fixture-v1",
        field: "field.json", catalog: "catalog.json", seed: 314, hashes: report.hashes,
        sourceProgram: report.sourceProgram, originalLifecycle: originalEncounter.lifecycle,
        actualEncounterId: partyId, inventoryGrants: [], evidence: report.evidence,
        candidateDiagnostics: report.candidateDiagnostics }, null, 2) + "\n"),
    ]);
    report.fixtureDirectory = directory;
  }

  const host = { visible: true, mediaReady: true, overlayOpen: false }, audio = controlledAudioRuntime();
  let session = new GameSession(field, catalog, 314, audio), flow = new GameFlow(session);
  flow.start(); flow.advance(0, host);
  const fieldStart = [session.field.player.x, session.field.player.y];
  const enter = () => {
    for (const direction of ["up", "down"]) { assert.equal(flow.move(direction), true); flow.advance(240, host); }
    assert.equal(flow.phase, "battle"); assert.ok(session.battle);
    assert.equal(session.battle.content.encounterId, partyId);
    assert.deepEqual(session.battle.content.enemies, originalEncounter.enemies);
    assert.deepEqual(session.battle.content.rewardPolicy, originalEncounter.rewardPolicy);
    assert.deepEqual([session.field.player.x, session.field.player.y], fieldStart);
    return session.battle;
  };
  const drive = (battle, stop = () => false, advance = () => flow.advance(10, host)) => {
    const actions = [], seen = new Set(), clocks = new Set(), samples = [battle.eventExecution];
    for (let tick = 0; tick < 16000 && battle.phase === "active" && !stop(); tick++) {
      for (const actor of battle.ready) {
        const ally = battle.players.find(player => player.hp > 0 && player.hp < player.maxHp * 0.6);
        const target = ally ?? battle.targets(actor.id, 218)[0];
        if (target) battle.command(actor.id, ally ? 222 : 218, target.id);
      }
      advance();
      const observed = battle.eventExecution;
      if (observed.state?.wait?.kind === "blank" && observed.state.locals[0] === 0) {
        clocks.add(observed.state.clock);
        if (samples.length < 8) samples.push(observed);
      }
      const action = battle.action;
      if (action?.resolved && !seen.has(action)) {
        seen.add(action); actions.push({ actor: action.actor, source: structuredClone(action.source), results: structuredClone(action.results) });
      }
    }
    samples.push(battle.eventExecution);
    assert.ok(actions.some(action => action.source.kind === "ability" && action.source.id === 218 &&
      action.results.some(result => result.effects.some(effect => effect.resource === "hp" &&
        !effect.recovery && !effect.missed && effect.amount > 0))), "Source actions must cause the victory damage");
    assert.ok(actions.some(action => battle.enemies.some(enemy => enemy.id === action.actor)),
      "The existing source AI must execute through the shared action owner");
    assert.ok(clocks.size > 2, "The actual event owner must poll across multiple battle frames");
    assert.equal(battle.eventExecution.controls.aiStarted, true);
    return { observedPollingClocks: clocks.size, eventSamples: samples, sourceActions: actions };
  };
  const victory = label => {
    const battle = enter(), owner = session.state, fieldOwner = session.field, before = owner.snapshot();
    assert.deepEqual(battle.lifecycleDefinition, lifecycle);
    const observed = drive(battle);
    assert.equal(flow.phase, "victory"); assert.deepEqual(owner.snapshot(), before);
    assert.deepEqual(battle.eventExecution.state.stack, []);
    assert.equal(battle.eventExecution.state.status, "exited");
    assert.equal(battle.eventExecution.state.locals[0], 1);
    const result = battle.previewVictory(); assert.ok(result);
    assert.equal(flow.continueVictory(), true); assert.equal(flow.continueVictory(), false);
    assert.equal(battle.previewVictory(), null);
    assert.equal(flow.phase, "exploration"); assert.equal(session.state, owner); assert.equal(session.field, fieldOwner);
    const after = owner.snapshot();
    assert.equal(after.completedBattles.length, before.completedBattles.length + 1);
    assert.equal(after.gil, Math.min(catalog.gameState.limits.gil, before.gil + battle.reward.gil));
    assert.equal(session.menuReady, true); assert.equal(session.checkpointReady, true);
    stage(label, { ...observed, finalEvent: battle.eventExecution, reward: battle.reward,
      beforeGil: before.gil, afterGil: after.gil, receipts: after.completedBattles });
    return battle;
  };
  victory("source-program-and-ai-win-then-publish-one-reward-and-return-to-same-field");
  const memory = new Map(), storage = new CheckpointStorage({ getItem: key => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, value) }, "framework");
  const saved = session.checkpoint(); await storage.save(saved, 1);
  const loaded = await storage.load(); assert.ok(loaded);
  session = GameSession.restore(loaded.checkpoint, field, catalog, undefined, audio);
  assert.deepEqual(session.checkpoint(), saved);
  flow = new GameFlow(session); flow.start(); flow.advance(0, host);
  stage("actual-storage-restore-preserves-receipt-and-session-before-next-encounter", {
    saveHash: loaded.contentHash, receipts: session.state.snapshot().completedBattles,
  });
  const completed = victory("restored-session-restarts-event-program-and-settles-next-battle-once");
  assert.equal(session.state.snapshot().completedBattles.length, 2);

  // Separate synthetic program: source semantics, authored instruction order.
  // It is never labelled as another source script or inserted into public data.
  const heldContent = structuredClone(completed.content);
  const ops = [{ kind: "exec-ai" }, { kind: "end-enabled", enabled: false }, { kind: "blank" },
    { kind: "sync-ai" }, { kind: "branch", index: 0, operator: "＝", right: { kind: "immediate", value: 0 }, target: 1 },
    { kind: "sync-action" }, { kind: "wait", seconds: 0.5 }, { kind: "end-enabled", enabled: true }, { kind: "exit" }];
  heldContent.lifecycle = { kind: "battle-lifecycle-v1", mode: "script", scriptId: 1,
    program: { kind: "battle-event-v1", source: null, entry: 0, end: ops.length,
      localNames: ["BattleAIFlag"], initialLocals: [0], blockers: [],
      instructions: ops.map(op => ({ mnemonic: op.kind, op })) } };
  // Exercise this deliberately authored program at the BattleGame/GameState
  // boundary. Do not forge source identity to admit it as a source encounter.
  const lease = session.state.openBattle(partyId, heldContent.rewardPolicy);
  const held = new BattleGame(heldContent, 315, session.state.battlePlayers(lease),
    session.state.battleInventory(lease), session.state.battleProgression(lease, heldContent.experience));
  const beforeHeld = session.state.snapshot();
  const observedHeld = drive(held, () => held.enemies.every(enemy => enemy.hp === 0) &&
    held.action === null && held.eventExecution.state?.wait?.kind === "time", () => held.advance(10));
  assert.equal(held.phase, "active"); assert.equal(held.eventExecution.controls.endEnabled, false);
  assert.equal(held.eventExecution.state.wait.kind, "time");
  assert.equal(held.previewVictory(), null); assert.equal(held.reward, null);
  assert.deepEqual(session.state.snapshot(), beforeHeld);
  const waitStart = held.eventExecution;
  held.advance(100);
  assert.equal(held.phase, "active"); assert.equal(held.reward, null);
  assert.deepEqual(session.state.snapshot(), beforeHeld);
  for (let tick = 0; tick < 60 && held.phase === "active"; tick++) held.advance(10);
  assert.equal(held.phase, "victory"); assert.equal(held.eventExecution.controls.endEnabled, true);
  assert.deepEqual(session.state.snapshot(), beforeHeld);
  const heldResult = held.previewVictory(); assert.ok(heldResult);
  const publish = session.state.prepareVictory(lease, heldResult); publish();
  assert.ok(held.takeVictory()); assert.equal(held.takeVictory(), null);
  assert.throws(() => publish(), /Stale|stale|published|committed/);
  stage("authored-end-disabled-tail-holds-results-until-event-permission-without-early-owned-write", {
    scope: "Synthetic instruction sequence on unchanged source combat; not the source sc_b_2001 sequence",
    programHash: await contentDigest(held.lifecycleDefinition.program),
    ...observedHeld, waitStart, released: held.eventExecution, receipts: session.state.snapshot().completedBattles,
  });
  for (const [index, path] of paths.entries())
    assert.deepEqual(await readFile(resolve(root, path)), inputBytes[index], "Published/source input changed during private verification");
  await Promise.all([verifyContent(field), verifyContent(catalog)]);
  stage("source-and-public-content-bytes-remain-unchanged");
  report.result = "passed";
} catch (error) {
  report.result = "failed"; report.error = String(error.stack ?? error); throw error;
} finally {
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: report.result, stages: report.stages.length, report: output }));
}
