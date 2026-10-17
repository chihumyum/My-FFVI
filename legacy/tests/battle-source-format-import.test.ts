import test from "node:test";
import assert from "node:assert/strict";
import { hash } from "../src/compiler/content.js";
import { compileBattleEvent } from "../src/compiler/battle-event.js";
import { createBattleSourceFormatImportResolver } from "../src/compiler/battle-source-format-import.js";
import { SOURCE_FORMAT_FLAG_IMPORT } from "../src/compiler/source-system-flags.js";
import { WEB_BATTLE_BRANCH_EXECUTION as policy } from "../src/core/battle-branch-execution.js";
import { createBattleEventState, parseBattleEventProgram, advanceBattleEvent, BattleEventError } from "../src/core/battle-event.js";
import { compileBattleEncounterRuntime } from "../src/compiler/battle-encounter-runtime.js";
import { GameSession } from "../src/core/game-session.js";
import { CheckpointStorage } from "../src/core/saved-game.js";
import { branchInputs, branchRaw as raw, branchSourceData, unknownBranchRaw as unknown } from "./fixtures/battle-branch-execution.js";
import { encounterRuntimeFixture } from "./fixtures/battle-encounter-runtime.js";
import { battleMessageSessionFixture } from "./fixtures/battle-event-message.js";

function fixture(flags: Record<string, number> = { SkipInitialize: 0 }, ops = [raw("Nop"), raw("Exit")]) {
  const source = branchInputs().source, data = { ...branchSourceData(ops), SystemFlag: flags, Animations: [] as unknown[] };
  const physical = { file: "source/" + source.file, sha256: source.sha256, assetPath: source.assetPath,
    serializedFile: source.serializedFile, objectId: source.objectId };
  const sources = [{ file: "GameAssembly.dll", sha256: SOURCE_FORMAT_FLAG_IMPORT.nativeSha256 },
    { file: physical.file, sha256: physical.sha256 }];
  const snapshot = { sourceSetHash: hash(sources), manifest: { parentSourceSetHash: source.sourceSetHash, sources },
    assets: [{ kind: "script", source: physical, data }] };
  const resolve = createBattleSourceFormatImportResolver(snapshot), binding = resolve({ source, data });
  const program = compileBattleEvent(data, source, undefined, undefined, policy, binding);
  return { source, data, physical, snapshot, resolve, binding, program };
}

test("trusted Format import preserves the original JSON and v2 body while admitting only proven zero projections", () => {
  for (const flags of [{ SkipInitialize: 0 }, { SkipInitialize: 0, KeepPlayerPuppet: 0, KeepBadStatusVisual: 0 }, {}]) {
    const f = fixture(flags), before = structuredClone(f.data), p = f.program;
    assert.deepEqual(p.branchExecution!.sourceProgram, before);
    assert.deepEqual(p.branchExecution!.sourceFormatImport!.values,
      { SkipInitialize: 0, KeepPlayerPuppet: 0, KeepBadStatusVisual: 0, RidingVehicle: 0 });
    assert.deepEqual(p.branchExecution!.sourceFormatImport!.binding, f.binding);
    assert.equal(f.binding.rawScriptHash, hash(before)); assert.equal(p.blockers.length, 0);
    assert.deepEqual(parseBattleEventProgram(p), p); assert.deepEqual(f.data, before);
    assert.equal(advanceBattleEvent(p, createBattleEventState(p, policy),
      { clock: 0, timeSeconds: 0, started: true, aiCoreAlive: false, actionStaging: false }, policy).state.status, "exited");
    const legacy = compileBattleEvent(f.data, f.source), unboundV2 = compileBattleEvent(f.data, f.source, undefined, undefined, policy);
    assert.equal(legacy.kind, "battle-event-v1"); assert.equal(Object.hasOwn(legacy, "branchExecution"), false);
    assert(legacy.blockers.some(v => v.includes("four explicitly")));
    assert.throws(() => createBattleEventState(unboundV2, policy));
    assert.throws(() => compileBattleEvent(f.data, f.source, undefined, undefined, undefined, f.binding));
    assert.throws(() => compileBattleEvent(f.data, null, undefined, undefined, policy, f.binding));
  }
  const explicit = fixture(branchSourceData([]).SystemFlag);
  assert.equal(compileBattleEvent(explicit.data, explicit.source).blockers.length, 0);
  const nonzero = fixture({ SkipInitialize: 1 });
  assert(nonzero.program.blockers.length); assert.throws(() => createBattleEventState(nonzero.program, policy));
  const animation = fixture(); animation.data.Animations = [{}];
  assert.throws(() => animation.resolve({ source: animation.source, data: animation.data }), /changed physical/);
});

test("raw/projection/defaulted conflicts, unknown fields, native identity and physical source mismatches fail before execution", () => {
  const f = fixture(), original = f.program;
  const mutations: ((p: typeof original) => void)[] = [
    p => { p.branchExecution!.sourceProgram.SystemFlag.SkipInitialize = 1; },
    p => { p.branchExecution!.sourceProgram.SystemFlag.RidingVehicle = 0; },
    p => { p.branchExecution!.sourceProgram.SystemFlag.Unknown = 0; },
    p => { p.branchExecution!.sourceFormatImport!.values.RidingVehicle = 1; },
    p => { p.branchExecution!.sourceFormatImport!.defaulted.reverse(); },
    p => { p.branchExecution!.sourceFormatImport!.binding.nativeSha256 = "f".repeat(64); },
    p => { p.branchExecution!.sourceFormatImport!.binding.symbolsSha256 = "f".repeat(64); },
    p => { p.branchExecution!.sourceFormatImport!.binding.headerSha256 = "f".repeat(64); },
    p => { p.branchExecution!.sourceFormatImport!.binding.parentSourceSetHash = "f".repeat(64); },
    p => { p.branchExecution!.sourceFormatImport!.binding.source.objectId = "9007199254740993"; },
    p => { p.branchExecution!.sourceFormatImport!.binding.source.serializedFile = "another"; },
    p => { p.branchExecution!.sourceFormatImport!.binding.source.file = "another.bundle"; },
    p => { p.branchExecution!.sourceFormatImport!.binding.source.sha256 = "f".repeat(64); },
    p => { (p.branchExecution!.sourceFormatImport! as unknown as Record<string, unknown>).future = true; },
    p => { p.branchExecution!.sourceProgram.Animations = [{}]; },
    p => { delete p.branchExecution!.sourceFormatImport; },
  ];
  for (const mutate of mutations) { const changed = structuredClone(original); mutate(changed); assert.throws(() => createBattleEventState(changed, policy)); }
  for (const SystemFlag of [undefined, null, [], { RidingVehicle: 0.1 }, { RidingVehicle: "0" }, { skipInitialize: 0 }]) {
    const data: Record<string, unknown> = { ...f.data }; if (SystemFlag === undefined) delete data.SystemFlag; else data.SystemFlag = SystemFlag;
    const snapshot = { ...f.snapshot, assets: [{ ...f.snapshot.assets[0]!, data }] };
    assert.throws(() => createBattleSourceFormatImportResolver(snapshot)({ source: f.source, data }));
  }
  for (const field of ["assetPath", "objectId", "serializedFile", "sha256"] as const)
    assert.throws(() => f.resolve({ data: f.data, source: { ...f.source, [field]: "changed" } }));
  assert.throws(() => createBattleSourceFormatImportResolver({ ...f.snapshot,
    assets: [f.snapshot.assets[0]!, f.snapshot.assets[0]!] })({ source: f.source, data: f.data }), /ambiguous/);
  assert.throws(() => createBattleSourceFormatImportResolver({ ...f.snapshot,
    assets: [{ ...f.snapshot.assets[0]!, kind: "data" }] })({ source: f.source, data: f.data }), /Missing/);
});

test("the production encounter compiler uses the explicit resolver and retains unknown/AI/owned/media gates", () => {
  const f = fixture({ SkipInitialize: 0 }, [raw("Jump", [1]), unknown(), raw("Exit")]), r = encounterRuntimeFixture();
  const entry = r.input.encounters[0]!; entry.script = { data: f.data, source: f.source }; entry.metadata.scriptId = 1;
  const before = structuredClone(r.input.encounters);
  const unbound = compileBattleEncounterRuntime(r.reader(), { ...r.input, branchExecution: policy });
  assert(!unbound.encounters[entry.partyId]);
  const bound = compileBattleEncounterRuntime(r.reader(), { ...r.input, branchExecution: policy, sourceFormatImport: f.resolve });
  assert(bound.encounters[entry.partyId]); assert(bound.diagnostics.some(d => d.partyId === entry.partyId && d.kind === "runtime-dependency" && d.pc === 1));
  assert.deepEqual(r.input.encounters, before);
  entry.background = "missing";
  const broken = compileBattleEncounterRuntime(r.reader(), { ...r.input, branchExecution: policy, sourceFormatImport: f.resolve });
  assert(!broken.encounters[entry.partyId]); assert(broken.diagnostics.some(d => d.partyId === entry.partyId && d.kind === "blocked" && /sprite/.test(d.reason)));
});

function session(ops: ReturnType<typeof raw>[]) {
  const f = fixture({ SkipInitialize: 0 }, ops), inputs = battleMessageSessionFixture(f.program);
  inputs.battle.encounters[1000]!.lifecycle = { kind: "battle-lifecycle-v2", mode: "script", scriptId: 1, program: f.program, branchExecution: policy };
  const runtime = { ...inputs.runtime, battleBranchExecution: policy }, game = new GameSession(inputs.field, inputs.battle, 314, runtime);
  assert(game.field.startEvent("fight")); game.advance(10); assert(game.prepareBattleStart()!.commit());
  return { ...inputs, runtime, game };
}
test("the first real Session tick remains transactional when the imported source reaches an unknown operation", () => {
  const { game } = session([raw("SetFlag", [52], [], ["ScenarioFlag1"]), unknown(), raw("Exit")]);
  const battle = game.battle!, before = { owned: game.state.snapshot(), time: battle.time, units: structuredClone(battle.combatants),
    vm: battle.eventExecution, shared: battle.eventSharedReturn!.candidate, actions: battle.pendingActions };
  for (let n = 0; n < 2; n++) {
    assert.throws(() => game.advance(10), (error: unknown) => { assert(error instanceof BattleEventError); assert.equal(error.pc, 1); assert.deepEqual(error.rawInstruction, unknown()); return true; });
    assert.deepEqual({ owned: game.state.snapshot(), time: battle.time, units: structuredClone(battle.combatants),
      vm: battle.eventExecution, shared: battle.eventSharedReturn!.candidate, actions: battle.pendingActions }, before);
  }
});
test("field return and Storage restore rebind verified content; saved fields cannot supply the import or runtime policy", async () => {
  const f = session([raw("ExecBattleAI"), raw("Blank"), raw("SyncBattleAI"), raw("Branch", [0, 0, 0], [], ["ScriptLocalVariable", "＝", "imm"]), raw("BattleSyncAction"), raw("Exit")]);
  for (let n = 0; n < 30000 && f.game.battle!.phase === "active"; n++) {
    for (const actor of f.game.battle!.ready) { const target = f.game.battle!.targets(actor.id, 10)[0]; if (target) f.game.battle!.command(actor.id, 10, target.id); }
    f.game.advance(10);
  }
  assert.equal(f.game.battle!.phase, "victory"); assert(f.game.prepareBattleReturn()!.commit()); f.game.advance(10);
  const slots = new Map<string, string>(), storage = new CheckpointStorage({ getItem: k => slots.get(k) ?? null, setItem: (k, v) => { slots.set(k, v); } });
  await storage.save(f.game.checkpoint(), 1); const saved = (await storage.load())!;
  assert(!JSON.stringify(saved.checkpoint).includes("sourceFormatImport"));
  const restored = GameSession.restore(saved.checkpoint, f.field, f.battle, undefined, f.runtime);
  assert.deepEqual(restored.checkpoint(), saved.checkpoint);
  assert.throws(() => GameSession.restore({ ...saved.checkpoint, sourceFormatImport: {} } as never, f.field, f.battle, undefined, f.runtime));
  // The saved checkpoint cannot supply a policy after its runtime host is removed.
  const noHost = GameSession.restore(saved.checkpoint, f.field, f.battle, undefined, { ...f.runtime, battleBranchExecution: undefined } as never);
  assert(noHost.field.startEvent("fight")); noHost.advance(10); assert.throws(() => noHost.prepareBattleStart()!.commit(), /explicit Web runtime host/);
});
