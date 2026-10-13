// Typed requirements, the real dependency planner, and actual field/session
// owners. Provider composition is not source reachability or native execution.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url)), args = process.argv.slice(2);
assert.ok(args.length === 0 || args.length === 2 && args[0] === "--dist" && args[1],
  "Usage: check-field-content-admission.mjs [--dist <isolated-compiled-directory>]");
const compiled = resolve(root, args[1] ?? "dist"), load = path => import(pathToFileURL(resolve(compiled, path + ".js")).href);
const output = resolve(root, "build/reports/field-content-admission-check.json");
const report = { kind: "field-content-admission-mechanism-v1", result: "running", stages: [],
  nativeVerified: false, browserVerified: false, originalGameExecuted: false, fullGameMigration: false,
  limitations: ["Synthetic operations exercise provider composition and shared owners; no original story is executed",
    "Static requirements do not prove selected owners, dynamic values, transaction readiness or route reachability",
    "An empty external-provider requirement list never certifies opcode implementation",
    "Source map609/new-game artifacts are scanned only; no source script or map is executed",
    "Constructor admission remains limited to its actual entry; unused script failures do not certify future paths"] };
await mkdir(resolve(root, "build/reports"), { recursive: true });
await rm(output, { force: true });
const stage = (id, details = {}) => report.stages.push({ id, result: "passed", ...details });
const sha = bytes => createHash("sha256").update(bytes).digest("hex");

try {
  const [{ fieldInstructionRequirements, deriveFieldContentRequirements, assessFieldRequirements },
    { analyzeContentDependencies }, { FieldGame }, { GameSession }, { EventState }, { checkpointFixture }, { hash }] =
    await Promise.all([load("src/core/field-content-admission"), load("src/compiler/content-dependencies"),
      load("src/core/field"), load("src/core/game-session"), load("src/core/event-state"),
      load("tests/fixtures/checkpoint-game"), load("src/compiler/content")]);
  const source = { file: "synthetic-field-admission.bundle", assetPath: "synthetic/admission.json",
    objectId: "90071992547409937", serializedFile: "synthetic-CAB", sha256: "a".repeat(64) };
  const flag = { category: "ScenarioFlag1", index: 29 }, affordability = { category: "MapLocalVariable", index: 0 };
  const op = (kind, fields = {}, script = "audit", index = 1) => ({ kind, ...structuredClone(fields), script, index, source });
  const program = (operations, script = "audit") => operations.map((value, index) => ({ ...structuredClone(value), script, index }));
  const inventory = op("inventory", { command: { kind: "pay-gil", amount: 15 }, result: affordability,
    dependencies: [{ table: "product.csv", id: 1 }] });
  const recovery = op("field-recovery", { command: { kind: "recover-mp", amount: 3, target: 0,
    allowUnableFight: false, allowMineralization: false }, dependencies: [{ table: "condition.csv", id: 305 }] });
  function fixture(operations, runtime = {}) {
    const f = checkpointFixture();
    const audit = program([op("wait", { seconds: 0 }), ...operations, op("flag", { ref: flag, operation: "set" }), op("exit")]);
    f.field.scripts.audit = audit; f.target.scripts.audit = structuredClone(audit);
    const game = new GameSession(f.field, f.battle, 5901, runtime);
    game.field.eventState.write(flag, 0); game.field.eventState.write(affordability, 77);
    return { ...f, game, audit };
  }
  function plan(f, context) {
    return analyzeContentDependencies({ catalog: f.world, maps: [f.target],
      roots: [{ kind: "script", mapId: 2, script: "audit" }], mapIds: [2], providerContext: context });
  }
  const graphRow = (graph, instruction) => {
    const row = graph.providerAssessments.find(row => row.site.script === instruction.script && row.site.index === instruction.index);
    assert.ok(row, "Planner omitted the current typed instruction's provider assessment"); return row;
  };
  const pureRow = ({ status, diagnostics }) => ({ status, diagnostics });
  const diagnostic = (assessment, code) => {
    const value = assessment.diagnostics.find(item => item.code === code);
    assert.ok(value, `Missing ${code}: ${assessment.diagnostics.map(item => item.code)}`); return value;
  };

  for (const [name, instruction, provider, code] of [
    ["inventory", inventory, "inventory", "FIELD_INVENTORY_PROVIDER"],
    ["recovery", recovery, "recovery", "FIELD_RECOVERY_PROVIDER"],
  ]) {
    const f = fixture([instruction]), current = f.audit[1];
    // Explicitly compose a real FieldGame with the session's existing owned
    // state. Omit the one port, rather than cloning or deleting live functions.
    const eventState = new EventState(f.game.field.eventState.snapshot());
    const ports = name === "inventory" ? { recovery: f.game.state.fieldRecovery } : { inventory: f.game.state.fieldInventory };
    const field = new FieldGame(f.field, eventState, undefined, undefined, ports);
    const context = { providers: { [provider]: "missing" }, actorKind: "actor" };
    const requirements = fieldInstructionRequirements(current), beforeOp = structuredClone(current);
    const direct = assessFieldRequirements(requirements, context), graph = plan(f, context), row = graphRow(graph, current);
    const actual = field.assessInstructionAdmission(current);
    assert.deepEqual(pureRow(row), direct); assert.deepEqual(actual, direct);
    assert.equal(actual.status, "blocked");
    const expected = diagnostic(actual, code);
    assert.deepEqual(expected.site, { script: current.script, index: current.index, source: current.source });
    const owned = f.game.state.snapshot();
    assert.equal(field.startEvent("audit"), true);
    const events = field.eventState.snapshot(); field.advance(10);
    assert.equal(field.stop?.kind, "unsupported");
    assert.equal(field.stop.message, expected.reason); assert.deepEqual(field.stop.site, current);
    assert.deepEqual(f.game.state.snapshot(), owned); assert.deepEqual(field.eventState.snapshot(), events);
    assert.equal(field.eventState.read(flag), 0); assert.equal(field.eventState.read(affordability), 77);
    assert.deepEqual(current, beforeOp);
    stage(`${name}-missing-port-matches-pure-planner-and-actual-stop-without-publication`,
      { code, site: expected.site, requirements: requirements.length, referenceClosure: graph.referenceClosure });
  }

  {
    const grant = op("inventory", { command: { kind: "grant-gil", amount: 9 }, result: null, dependencies: [] });
    const f = fixture([grant, recovery]), injured = f.game.state.snapshot();
    injured.roster[0].mp = 0; injured.roster[1].mp = 1; f.game.state.restore(injured);
    const before = f.game.state.snapshot(), field = f.game.field;
    assert.equal(field.assessInstructionAdmission(f.audit[1]).status, "ready");
    assert.equal(field.assessInstructionAdmission(f.audit[2]).status, "ready");
    assert.equal(field.startEvent("audit"), true); f.game.advance(10);
    assert.equal(field.stop, null); assert.equal(field.eventState.read(flag), 1);
    assert.equal(f.game.state.snapshot().gil, before.gil + 9);
    assert.deepEqual(f.game.state.snapshot().roster.map(member => member.mp), [3, 4]);
    assert.deepEqual([f.game.characterMenu("a").mp, f.game.characterMenu("b").mp], [3, 4]);
    assert.equal(f.game.field, field); assert.equal(f.game.checkpointReady, true);
    const saved = f.game.checkpoint(), restored = GameSession.restore(JSON.parse(JSON.stringify(saved)), f.field, f.battle);
    assert.deepEqual(restored.checkpoint(), saved);
    stage("available-ports-execute-through-one-session-owner-menu-and-existing-checkpoint");
  }

  {
    const f = fixture([]);
    f.field.scripts.future = program([op("blocked", { mnemonic: "SyntheticFuture", reason: "Synthetic unavailable future provider" }),
      op("field-script-motion", { command: { kind: "lerp", x: 2, y: 1, layer: 0,
        duration: 0.2, arcHeight: 0, animation: "" } })], "future");
    f.target.scripts.future = structuredClone(f.field.scripts.future);
    const game = new GameSession(f.field, f.battle, 5902);
    const before = game.state.snapshot(), requirements = deriveFieldContentRequirements({ contentHash: f.field.contentHash, scripts: f.field.scripts });
    const future = requirements.instructions.filter(row => row.site.script === "future");
    assert.equal(future.length, 2);
    assert.equal(game.field.content.scripts.future[0].kind, "blocked");
    assert.equal(game.field.content.scripts.future[0].reason, "Synthetic unavailable future provider");
    assert.equal(future[0].requirements.length, 0,
      "External provider requirements do not replace the source semantic blocker");
    assert.equal(assessFieldRequirements(future[1].requirements,
      { providers: {}, actorKind: "unknown" }).status, "conditional");
    assert.equal(game.field.stop, null); assert.equal(game.field.startEvent("audit"), true); game.advance(10);
    assert.equal(game.field.stop, null); assert.deepEqual(game.state.snapshot(), before);
    assert.equal(game.field.eventState.read(flag), 1);
    const graph = plan(f, { providers: {}, actorKind: "unknown" });
    assert.ok(graph.providerAssessments.every(row => row.site.script !== "future"), "Unreached scripts must not become route assessments");
    stage("unused-blocked-and-unknown-future-ops-stay-explicit-without-global-constructor-rejection",
      { catalogFutureSites: future.length, reachedFutureSites: 0, semanticBlockersPreserved: 1, conditionalFutureSites: 1 });
  }

  {
    const lerp = op("field-script-motion", { command: { kind: "lerp", x: 2, y: 1, layer: 0,
      duration: 0.2, arcHeight: 0, animation: "" } });
    const f = fixture([lerp]), current = f.audit[1], context = { providers: {}, actorKind: "unknown" };
    const before = structuredClone(current), requirements = fieldInstructionRequirements(current);
    const direct = assessFieldRequirements(requirements, context), row = graphRow(plan(f, context), current);
    assert.equal(direct.status, "conditional"); diagnostic(direct, "FIELD_SCRIPT_MOTION_PROVIDER");
    assert.deepEqual(pureRow(row), direct); assert.deepEqual(current, before);
    const actual = f.game.field.assessInstructionAdmission(current, "unbound-actor");
    assert.equal(actual.status, "blocked"); diagnostic(actual, "FIELD_SCRIPT_MOTION_PROVIDER");
    stage("unknown-puppet-binding-is-conditional-and-actual-missing-actor-is-blocked",
      { static: direct.status, actual: actual.status, site: direct.diagnostics[0].site });
  }

  {
    let decoded = false;
    const ready = op("field-sound", { command: { kind: "ready", soundId: 1 } });
    const play = op("field-sound", { command: { kind: "play", soundId: 1, asynchronous: true,
      handleSlot: 0, fadeSeconds: 0, seekSeconds: 0, pan: 0 } });
    const f = fixture([ready], { audioReadiness: { isReady: () => decoded } });
    f.field.se = { sourceSetHash: "synthetic-se", tracks: { 1: { file: "synthetic.flac", sha256: "synthetic-se",
      sampleRate: 1000, frames: 100, channels: 1, loop: null, source, tableSource: source } } };
    f.field.scriptLocals = { audit: { labels: ["sound"], values: [0] } };
    const game = new GameSession(f.field, f.battle, 5903, { audioReadiness: { isReady: () => decoded } });
    const current = f.audit[1], readyRequirements = fieldInstructionRequirements(current), playRequirements = fieldInstructionRequirements(play);
    assert.equal(game.field.assessInstructionAdmission(current).status, "ready");
    const rejected = game.field.assessInstructionAdmission(play);
    assert.equal(rejected.status, "blocked"); diagnostic(rejected, "FIELD_SOUND_PRESENTATION_PROVIDER");
    assert.ok(!readyRequirements.some(req => req.code === "FIELD_SOUND_PRESENTATION_PROVIDER"));
    assert.ok(playRequirements.some(req => req.code === "FIELD_SOUND_PRESENTATION_PROVIDER"));
    const owned = game.state.snapshot(); game.field.eventState.write(flag, 0);
    assert.equal(game.field.startEvent("audit"), true); game.advance(10);
    assert.equal(game.field.eventState.read(flag), 0); assert.equal(game.field.se.voices.length, 0);
    assert.equal(game.field.eventState.read({ category: "ScriptLocalVariable", index: 0 }), 0);
    assert.equal(game.field.pendingAudioTracks.length, 1);
    decoded = true; game.advance(10);
    assert.equal(game.field.eventState.read(flag), 1); assert.equal(game.field.pendingAudioTracks.length, 0);
    assert.equal(game.field.se.voices.length, 0); assert.deepEqual(game.state.snapshot(), owned);
    for (const command of [{ kind: "sync", handleSlot: 0 }, { kind: "stop", handleSlot: 0, fadeSeconds: 0 }])
      assert.equal(game.field.assessInstructionAdmission(op("field-sound", { command })).status, "ready");
    stage("sound-ready-waits-for-loading-without-voice-and-play-requires-presentation-while-handle-queries-do-not",
      { readyRequirements: readyRequirements.length, playRequirements: playRequirements.length });
  }

  {
    const newGamePath = resolve(root, "build/game/source-new-game.json"), mapPath = resolve(root, "build/world/maps/609.json");
    const newGameBytes = await readFile(newGamePath), mapBytes = await readFile(mapPath);
    const newGame = JSON.parse(newGameBytes), map = JSON.parse(mapBytes);
    const { contentHash: newGameHash, ...newGameBody } = newGame, { contentHash: mapHash, ...mapBody } = map;
    assert.equal(hash(newGameBody), newGameHash); assert.equal(hash(mapBody), mapHash);
    assert.equal(newGame.mapContentHash, mapHash); assert.equal(newGame.sourceSetHash, map.sourceSetHash);
    const requirements = deriveFieldContentRequirements({ contentHash: map.contentHash, scripts: map.scripts }), observations = requirements.instructions.map(row => {
      const original = map.scripts[row.site.script]?.[row.site.index]; assert.ok(original);
      return { site: row.site, opcodeKind: original.kind, requirements: row.requirements,
        semanticBlocker: original.kind === "blocked" ? { mnemonic: original.mnemonic, reason: original.reason } : null,
        assessment: assessFieldRequirements(row.requirements, { providers: {}, actorKind: "unknown" }) };
    });
    assert.equal(requirements.contentHash, mapHash);
    assert.ok(observations.length > 0);
    for (const row of observations) {
      const original = map.scripts[row.site.script]?.[row.site.index]; assert.ok(original);
      assert.deepEqual(row.site.source, original.source);
      if (row.site.source.objectId !== undefined) assert.equal(typeof row.site.source.objectId, "string");
    }
    report.sourceScan = { sourceSetHash: map.sourceSetHash, parentSourceSetHash: map.parentSourceSetHash,
      newGameSha256: sha(newGameBytes), map609Sha256: sha(mapBytes), newGameContentHash: newGameHash,
      map609ContentHash: mapHash, instructions: observations,
      sourceProgramsExecuted: false, sourceGameplayVerified: false };
    stage("current-source-new-game-and-map609-typed-requirements-scanned-without-source-execution",
      { sourceInstructions: observations.length, sourceGameplayVerified: false });
  }
  report.compiledInputs = {};
  for (const path of ["src/core/field-content-admission.js", "src/compiler/content-dependencies.js", "src/core/field.js",
    "src/core/game-session.js", "tests/fixtures/checkpoint-game.js"])
    report.compiledInputs[path] = sha(await readFile(resolve(compiled, path)));
  report.result = "passed";
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: report.result, stages: report.stages.length, nativeVerified: false, browserVerified: false }));
} catch (error) {
  report.result = "failed"; report.error = error instanceof Error ? error.stack : String(error);
  await writeFile(output, JSON.stringify(report, null, 2) + "\n"); throw error;
}
