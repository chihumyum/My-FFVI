// Source-bound ordered refreshes against an explicit controlled renderer.
// Native actor/material publication and the full source session are separate lanes.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
assert.ok(args.length === 0 || (args.length === 2 && args[0] === "--compiled-dir"),
  "Use --compiled-dir <directory>");
const compiled = resolve(root, args[1] ?? "dist");
const module = (name) => import(pathToFileURL(resolve(compiled, "src", name + ".js")).href);
const sha = (value) => createHash("sha256").update(value).digest("hex");
const output = resolve(root, "build/reports/field-party-actor-transactions-check.json");
await mkdir(resolve(root, "build/reports"), { recursive: true });
const report = {
  formatVersion: 1, kind: "field-party-actor-transactions-check", status: "running",
  lane: "source-owned-condition-and-party-plans-with-controlled-batch-renderer",
  semanticsVerified: false, originalGameExecuted: false, browserExecuted: false,
  nativeActorPublicationExecuted: false, completeOpening: false,
  packages: [], cases: [],
  controlledInputs: [
    "The real fresh source owner and MapSetup checkpoint are constructed without executing the opening VM.",
    "The source AddCondition instruction is dispatched directly after this checkpoint; story timing and reachability are not tested here.",
    "A controlled batch renderer stages source changes and camera writes in order and commits one detached record.",
    "Renderer preparation and validation failures are injected before owned publication.",
  ],
  limitations: [
    "The controlled renderer does not load bitmaps, create animation/material owners, or publish native actors.",
    "Legacy callback renderers retain the zero-offset restriction and must provide no-throw prepared commits.",
    "An arbitrary external commit that violates the no-throw contract cannot be rolled back by FieldPartyActors.",
    "Stable native saves, map handoff, GPU parity and original-game dynamic equivalence are separate gates.",
  ],
};
let stage = "load-runtime";
const check = (name, run) => { run(); report.cases.push({ name, pass: true }); };

try {
  const { verifyContent } = await module("core/content-integrity");
  const { canonical } = await module("core/canonical");
  const { GameState } = await module("core/game-state");
  const { createNewGame } = await module("core/new-game");
  const { EventState } = await module("core/event-state");
  const { FieldPartyActors } = await module("core/field-party-actors");
  const { createFreshFieldPartyActorCheckpoint } = await module("core/field-actor-factory");
  const { prepareMapPartyEntry, readMapPartySwitching } = await module("core/map-party-entry");
  const { executeOwnedConditionEvent } = await module("core/owned-condition");
  const { compileOwnedConditionInstruction } = await module("compiler/owned-condition");
  const { loadCorpus } = await module("compiler/corpus");
  const { hash } = await module("compiler/content");
  const readPackage = async (file, expected) => {
    const bytes = await readFile(resolve(root, file));
    const content = await verifyContent(JSON.parse(bytes), expected);
    report.packages.push({ file, contentHash: content.contentHash, fileSha256: sha(bytes) });
    return content;
  };

  stage = "bind-source-and-current-packages";
  const source = await readPackage("build/game/source-new-game.json");
  const battle = await readPackage("build/game/opening-playable.json", source.battleCatalogHash);
  const world = await readPackage("build/world/catalog.json", source.worldCatalogHash);
  const indexed = world.maps[String(source.entry.mapId)];
  assert.ok(indexed); assert.match(indexed.url, /^\/world\/maps\/[0-9]+\.json$/);
  const map = await readPackage("build" + indexed.url, indexed.contentHash);
  const corpus = await loadCorpus(root);
  assert.equal(source.mapContentHash, map.contentHash);
  for (const content of [source, map, world]) {
    assert.equal(content.sourceSetHash, corpus.sourceSetHash);
    assert.equal(content.parentSourceSetHash, corpus.manifest.parentSourceSetHash);
  }
  report.sourceSetHash = corpus.sourceSetHash;
  report.parentSourceSetHash = corpus.manifest.parentSourceSetHash;
  report.profile = battle.common.profile;
  const scriptName = source.entry.reservedScript.name;
  const sourceOp = map.scripts[scriptName].find((op) => op.kind === "owned-condition");
  assert.ok(sourceOp);
  const matches = corpus.assets.filter((asset) => asset.kind === "script" &&
    asset.source.file === sourceOp.source.file && asset.source.assetPath === sourceOp.source.assetPath &&
    asset.source.objectId === sourceOp.source.objectId);
  assert.equal(matches.length, 1);
  const script = matches[0];
  check("real opening instruction retains its complete source identity and condition type", () => {
    assert.equal(map.mapId, 609); assert.equal(source.entry.entrance, 1);
    assert.equal(scriptName, "sc_e_0001"); assert.equal(sourceOp.index, 18);
    assert.equal(sourceOp.source.pointer, "/Mnemonics/18");
    assert.equal(hash(script.data), source.entry.reservedScript.contentHash);
    assert.equal(script.source.sha256, sourceOp.source.sha256);
    assert.equal(map.scriptPuppetContexts[scriptName].scriptHash, hash(script.data));
    assert.equal(map.scriptPuppetContexts[scriptName].keepBadStatusVisual, false);
    const decoded = compileOwnedConditionInstruction(script.data.Mnemonics[sourceOp.index], corpus.tables);
    assert.deepEqual(decoded, { kind: sourceOp.kind, command: sourceOp.command, dependencies: sourceOp.dependencies });
    assert.deepEqual(sourceOp.command, { kind: "add-condition", conditionType: 607, target: 0 });
    assert.deepEqual(sourceOp.dependencies, [{ table: "condition.csv", id: 53 }]);
  });
  report.sourceInstruction = { script: scriptName, index: sourceOp.index, source: sourceOp.source,
    scriptHash: hash(script.data), command: sourceOp.command };

  stage = "bind-reviewed-native-evidence";
  const nativeBytes = await readFile(resolve(root, "build/runtime/game/GameAssembly.dll"));
  const nativeSha256 = sha(nativeBytes);
  assert.ok(corpus.manifest.sources.some((s) => s.file === "GameAssembly.dll" && s.sha256 === nativeSha256));
  const nativeSources = [
    { report: "party-actors-native-check", rvas: ["0x2d29b0", "0x2d2470", "0x2d2810", "0x2ee420"] },
    { report: "owned-condition-native-check", rvas: ["0xb4e130", "0xb4e500", "0xb44fb0", "0x326060", "0xb45540"] },
  ];
  const boundMethods = [];
  for (const input of nativeSources) {
    const path = "build/reports/" + input.report + ".json", bytes = await readFile(resolve(root, path));
    const evidence = JSON.parse(bytes);
    assert.equal(evidence.nativeSha256, nativeSha256); assert.equal(evidence.semanticsVerified, false);
    for (const rva of input.rvas) {
      const method = evidence.methods.find((entry) => entry.rva === rva); assert.ok(method, rva);
      const receipt = JSON.parse(await readFile(resolve(root, "build/native", method.batch, "complete.json")));
      assert.equal(receipt.status, "complete"); assert.equal(receipt.semanticsVerified, false);
      assert.equal(receipt.nativeSha256, nativeSha256);
      assert.equal(receipt.symbolsSha256, evidence.symbolsSha256);
      assert.equal(receipt.headerSha256, evidence.headerSha256);
      const recorded = receipt.methods.find((entry) => entry.rva === rva); assert.ok(recorded);
      assert.equal(recorded.nativeRangeSha256, method.nativeRangeSha256);
      assert.equal(recorded.decompiledSha256, method.decompiledSha256);
      const range = method.sourceRange;
      assert.equal(sha(nativeBytes.subarray(range.fileOffset, range.fileOffset + range.size)), method.nativeRangeSha256);
      assert.equal(sha(await readFile(resolve(root, "build/native", method.batch, rva.slice(2) + ".c"))), method.decompiledSha256);
      boundMethods.push({ evidence: path, evidenceSha256: sha(bytes), ...method });
    }
  }
  const reference = JSON.parse(await readFile(resolve(root, "build/reports/party-actors-native-check.json")));
  assert.equal(sha(await readFile(resolve(root, "build/native/il2cpp/script.json"))), reference.symbolsSha256);
  assert.equal(sha(await readFile(resolve(root, "build/native/il2cpp/il2cpp_ghidra.h"))), reference.headerSha256);
  check("ordered refresh and camera-write evidence is bound to the supplied DLL and completed exports", () => {
    assert.equal(boundMethods.length, 9);
  });
  report.native = { nativeSha256, methods: boundMethods, semanticsVerified: false };

  const make = () => {
    const state = GameState.createNewGame(battle.gameState, battle.common.players, battle.contentHash, battle.common.conditions);
    const fresh = createNewGame(battle.gameState.sourceNewGame), port = state.fieldPartyAppearance;
    assert.ok(port && map.partyEntry);
    const party = port.current(), catalog = port.catalog;
    const initial = createFreshFieldPartyActorCheckpoint({ factory: source.factory, catalog, fresh, party,
      map: map.partyEntry, playerId: "-1001" });
    const entry = prepareMapPartyEntry(catalog, { definition: map.partyEntry, entrance: fresh.entry.entrance,
      mapViewType: fresh.entry.viewType, prior: initial, playerVisible: true, party,
      transportation: fresh.entry.transportation,
      canPartySwitching: readMapPartySwitching((ref) => new EventState(fresh.events).read(ref)) });
    return { state, catalog, host: new FieldPartyActors(catalog, entry.checkpoint, fresh.entry.transportation.id) };
  };
  const controlledRenderer = () => {
    let current = { revision: 0, cameraOffset: { x: 0, y: 0 }, plans: [] };
    const batches = [];
    let commits = 0;
    return { batches, read: () => structuredClone(current), commits: () => commits,
      renderer: { prepareBatch(steps) {
        const before = canonical(current), next = structuredClone(current);
        const batch = structuredClone(steps); batches.push(batch);
        for (const step of batch) {
          next.plans.push(step.plan);
          if (step.plan.cameraOffset !== null) next.cameraOffset = structuredClone(step.plan.cameraOffset);
        }
        next.revision++;
        return { validate() { assert.equal(canonical(current), before, "Stale controlled renderer owner"); },
          commit() { current = next; commits++; } };
      } } };
  };

  stage = "source-transaction-probes";
  check("fresh source conditions and party-actor metadata retain separate owners", () => {
    const { state, host } = make();
    assert.equal(state.initialization, "source-new-game");
    assert.deepEqual(state.fieldPuppetRoster.current().owned.map((member) => member.sourceId), [1, 31, 32]);
    assert.ok(state.snapshot().roster.every((member) => member.conditionIds.length === 0));
    assert.ok(host.checkpoint().context.multiParty.every((party) => party.members.length === 0));
    assert.equal(Object.hasOwn(host.checkpoint(), "cameraOffset"), false);
    assert.equal(Object.hasOwn(host.checkpoint().context.camera, "offset"), false);
  });
  check("legacy renderer still rejects source nonzero camera writes before owned publication", () => {
    const { state, host } = make(), before = state.snapshot(), appearance = host.checkpoint();
    let callbacks = 0;
    assert.throws(() => executeOwnedConditionEvent(sourceOp, state.fieldOwnedConditions,
      (steps) => host.prepareSequence(steps, () => { callbacks++; return () => {}; })), /Nonzero party camera offset/);
    assert.equal(callbacks, 0); assert.deepEqual(state.snapshot(), before); assert.deepEqual(host.checkpoint(), appearance);
  });
  check("renderer rejection after seeing all three source refreshes publishes nothing", () => {
    const { state, host } = make(), before = state.snapshot(), appearance = host.checkpoint();
    let prepareCalls = 0;
    assert.throws(() => executeOwnedConditionEvent(sourceOp, state.fieldOwnedConditions,
      (steps) => host.prepareSequence(steps, { prepareBatch(batch) {
        prepareCalls++; assert.equal(batch.length, 3);
        assert.ok(batch.every((step) => step.plan.cameraOffset?.y === 16));
        throw new Error("Controlled last-step media preparation failure");
      } })), /last-step media preparation failure/);
    assert.equal(prepareCalls, 1); assert.deepEqual(state.snapshot(), before); assert.deepEqual(host.checkpoint(), appearance);
  });
  check("late renderer validation runs before the shared source owned transaction commits", () => {
    const { state, host } = make(), before = state.snapshot(), appearance = host.checkpoint();
    let allowed = true, committed = false;
    assert.throws(() => executeOwnedConditionEvent(sourceOp, state.fieldOwnedConditions, (steps) => {
      const publication = host.prepareSequence(steps, { prepareBatch() {
        return { validate() { if (!allowed) throw new Error("Controlled renderer binding became stale"); },
          commit() { committed = true; } };
      } });
      allowed = false; return publication;
    }), /renderer binding became stale/);
    assert.equal(committed, false); assert.deepEqual(state.snapshot(), before); assert.deepEqual(host.checkpoint(), appearance);
  });

  const successful = make(), renderer = controlledRenderer(), ownedBefore = successful.state.snapshot();
  const appearanceBefore = successful.host.checkpoint(), targetIds = successful.state.activeParty.map((member) => member.id);
  const projectedSteps = [];
  check("source per-target candidates prepare as one ordered batch and publish once", () => {
    const expected = structuredClone(ownedBefore);
    executeOwnedConditionEvent(sourceOp, successful.state.fieldOwnedConditions, (steps) => {
      assert.deepEqual(steps.map((step) => step.targetId), targetIds);
      for (const step of steps) {
        expected.roster.find((member) => member.id === step.targetId).conditionIds.push(53);
        assert.equal(step.setDummy, false); assert.equal(step.affectLeader, true);
        for (const member of step.appearance.activeMembers)
          assert.deepEqual(member.conditionIds, expected.roster.find((owner) => owner.id === member.id).conditionIds);
        projectedSteps.push({ targetId: step.targetId, active: structuredClone(step.appearance.activeMembers) });
      }
      const publication = successful.host.prepareSequence(steps, renderer.renderer);
      assert.deepEqual(successful.state.snapshot(), ownedBefore);
      assert.deepEqual(successful.host.checkpoint(), appearanceBefore);
      assert.equal(renderer.commits(), 0);
      return publication;
    });
    assert.equal(renderer.batches.length, 1); assert.equal(renderer.batches[0].length, 3); assert.equal(renderer.commits(), 1);
    assert.deepEqual(renderer.batches[0].map((step) => step.plan.cameraOffset), Array.from({ length: 3 }, () => ({ x: 0, y: 16 })));
    assert.deepEqual(successful.state.snapshot(), expected);
    assert.deepEqual(renderer.read().cameraOffset, { x: 0, y: 16 });
    assert.deepEqual(successful.host.checkpoint().context.camera, appearanceBefore.context.camera);
    assert.ok(successful.host.checkpoint().context.multiParty.every((party) => party.members.length === 0));
  });
  check("already-owned source condition still executes the complete three-target refresh sequence", () => {
    const before = successful.state.snapshot(), appearance = successful.host.checkpoint();
    executeOwnedConditionEvent(sourceOp, successful.state.fieldOwnedConditions,
      (steps) => successful.host.prepareSequence(steps, renderer.renderer));
    assert.equal(renderer.batches.length, 2); assert.equal(renderer.batches[1].length, 3); assert.equal(renderer.commits(), 2);
    assert.deepEqual(successful.state.snapshot(), before); assert.deepEqual(successful.host.checkpoint(), appearance);
    assert.deepEqual(renderer.batches[1], renderer.batches[0]);
  });
  check("a replaced appearance checkpoint invalidates a prepared source publication before owned commit", () => {
    const { state, host } = make(), before = state.snapshot(), appearance = host.checkpoint(), controlled = controlledRenderer();
    assert.throws(() => executeOwnedConditionEvent(sourceOp, state.fieldOwnedConditions, (steps) => {
      const publication = host.prepareSequence(steps, controlled.renderer);
      host.restore(host.checkpoint()); return publication;
    }), /Stale or repeated party appearance transaction/);
    assert.equal(controlled.commits(), 0); assert.deepEqual(state.snapshot(), before); assert.deepEqual(host.checkpoint(), appearance);
  });
  report.sourceExecution = { targetIds, projectedSteps,
    batchPlans: renderer.batches, sourceConditionsAfter: successful.state.snapshot().roster.map(({ id, conditionIds }) => ({ id, conditionIds })),
    finalAppearance: successful.host.checkpoint(), controlledRenderer: renderer.read() };

  stage = "bind-runtime-and-checker";
  report.implementation = await Promise.all(["core/field-party-actors", "core/party-actors", "core/owned-condition",
    "core/game-state", "core/map-party-entry", "core/field-actor-factory", "compiler/owned-condition"].map(async (name) => ({
      file: "src/" + name + ".ts", sha256: sha(await readFile(resolve(root, "src", name + ".ts"))),
      compiledSha256: sha(await readFile(resolve(compiled, "src", name + ".js"))),
    })));
  report.checkerSha256 = sha(await readFile(fileURLToPath(import.meta.url)));
  report.counts = { cases: report.cases.length, verifiedPackages: report.packages.length, nativeMethods: boundMethods.length,
    targets: targetIds.length, successfulBatches: renderer.batches.length,
    orderedRefreshes: renderer.batches.reduce((sum, batch) => sum + batch.length, 0), rendererPublications: renderer.commits() };
  report.status = "pass";
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ status: report.status, ...report.counts, semanticsVerified: false,
    nativeActorPublicationExecuted: false, reportSha256: sha(await readFile(output)) }));
} catch (error) {
  report.status = "failed"; report.failedStage = stage;
  report.error = { name: error.name, message: error.message, stack: error.stack };
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  throw error;
}
