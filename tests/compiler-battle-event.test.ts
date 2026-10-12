import test from "node:test";
import assert from "node:assert/strict";
import { compileBattleEvent } from "../src/compiler/battle-event.js";
import { compileBattleEncounterRuntime } from "../src/compiler/battle-encounter-runtime.js";
import { analyzeBatchEncounters } from "../src/compiler/content-batch-battle.js";
import { parseBattleLifecycle } from "../src/core/battle-lifecycle.js";
import { encounterContent, type BattleCatalog } from "../src/core/battle-content.js";
import { assertBattleEventExecutable } from "../src/core/battle-event.js";
import { encounterRuntimeFixture } from "./fixtures/battle-encounter-runtime.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";

type RawOp = [string, number[]?, number[]?, string[]?];
const source = { sourceSetHash: "a".repeat(64), battleSourceSetHash: "b".repeat(64), sha256: "c".repeat(64),
  file: "synthetic.bundle", assetPath: "synthetic/event.json", serializedFile: "synthetic", objectId: "90071992547409937" };
function raw(ops: RawOp[] = [["Nop"], ["WaitToBattleStart"], ["ExecBattleAI"], ["Blank"],
  ["SyncBattleAI"], ["Branch", [0, 0, 2], [], ["ScriptLocalVariable", "＝", "imm"]], ["Exit"]]) {
  return { Name: "event", Title: { main: "Synthetic event", sub: "Redistributable" },
    ScriptLocal: ["AI state", "Stage"], ScriptLocalValue: [0, 0] as number[] | null,
    SystemFlag: { KeepBadStatusVisual: 0, KeepPlayerPuppet: 0, RidingVehicle: 0, SkipInitialize: 0 } as Record<string, number>,
    Animations: [] as unknown[], Segments: [{ Label: "Main", EntryPoint: 0, Count: ops.length }],
    Mnemonics: ops.map(([mnemonic, i = [], r = [], s = []]) => ({ mnemonic, type: 1,
      operands: { iValues: Array.from({ length: 8 }, (_, n) => i[n] ?? 0),
        rValues: Array.from({ length: 8 }, (_, n) => r[n] ?? 0),
        sValues: Array.from({ length: 8 }, (_, n) => s[n] ?? "") } })),
  };
}
function runtime() {
  const f = encounterRuntimeFixture(), encounter = f.input.encounters[0]!;
  encounter.metadata.scriptId = 8123;
  encounter.script = { source: structuredClone(source), data: raw() };
  const compile = () => compileBattleEncounterRuntime(f.reader(), f.input);
  const catalog = (): BattleCatalog => {
    const result = compile(), base = checkpointFixture().battle;
    return { ...base, common: { ...base.common, abilities: structuredClone(f.input.abilities),
      sprites: structuredClone(f.input.sprites), drops: result.drops,
      battleEvents: { conditions: f.input.conditions.rules.definitions.map(definition => ({ id: definition.id,
        type: definition.type, attackTarget: definition.id === 305 ? 1 : 0, gameOverTarget: definition.id === 305 ? 1 : 0 })) } }, encounters: result.encounters,
      encounterDiagnostics: result.diagnostics, encounterReport: result.report };
  };
  return { f, encounter, compile, catalog };
}

test("shared lifecycle compiler preserves source identity, ordinary loop and locals without an encounter-ID branch", () => {
  const input = raw(), before = structuredClone(input), program = compileBattleEvent(input, source);
  assert.deepEqual(program.instructions.map(i => i.op.kind), ["nop", "wait-start", "exec-ai", "blank", "sync-ai", "branch", "exit"]);
  assert.deepEqual(program.instructions[5]!.op, { kind: "branch", index: 0, operator: "＝",
    right: { kind: "immediate", value: 0 }, target: 2 });
  assert.deepEqual(program.initialLocals, [0, 0]); assert.deepEqual(program.blockers, []);
  assert.doesNotThrow(() => assertBattleEventExecutable(program));
  program.localNames[0] = "changed"; program.source!.file = "changed";
  assert.deepEqual(input, before); assert.equal(source.file, "synthetic.bundle");
});

test("Nop and Blank consume no formerly authored operands but invalid encoding or type is not a no-op", () => {
  const input = raw();
  input.Mnemonics[0]!.operands.iValues = [2, 5, 76, 1, 0, 0, 0, 0];
  assert.equal(compileBattleEvent(input, source).instructions[0]!.op.kind, "nop");
  input.Mnemonics[0]!.operands = { iValues: [], rValues: [], sValues: [] };
  assert.equal(compileBattleEvent(input, source).instructions[0]!.op.kind, "nop");
  input.Mnemonics[0]!.type = 2;
  assert.equal(compileBattleEvent(input, source).instructions[0]!.op.kind, "blocked");
  input.Mnemonics[0]!.type = 1; input.Mnemonics[0]!.operands.iValues = [Number.NaN];
  assert.equal(compileBattleEvent(input, source).instructions[0]!.op.kind, "blocked");
  input.Mnemonics[3]!.operands.iValues[0] = 17;
  assert.equal(compileBattleEvent(input, source).instructions[3]!.op.kind, "blank");
  input.Mnemonics[3]!.operands.iValues = [17, 20];
  assert.equal(compileBattleEvent(input, source).instructions[3]!.op.kind, "blocked");
});

test("supported local operations, calls and host controls remain typed and range-bound", () => {
  const program = compileBattleEvent(raw([["Nop"], ["Calc", [1, 7], [], ["ScriptLocalVariable", "←", "imm"]],
    ["Calc", [0, 1], [], ["ScriptLocalVariable", "＋", "ScriptLocalVariable"]], ["Call", [9]],
    ["BattleEndEnabled", [-2]], ["BattleSyncAction"], ["Wait", [], [0.1]], ["Jump", [9]], ["Exit"], ["Nop"], ["Return"]]), source);
  assert.doesNotThrow(() => assertBattleEventExecutable(program));
  assert.deepEqual(program.instructions[2]!.op, { kind: "calc", index: 0, operator: "＋", right: { kind: "local", index: 1 } });
  assert.deepEqual(program.instructions[4]!.op, { kind: "end-enabled", enabled: true });
  assert.deepEqual(program.instructions[6]!.op, { kind: "wait", seconds: 0.1 });
});

test("unknown hosts, operand tails, wrong arrays and nonfinite source waits retain their original PCs", () => {
  for (const mutate of [
    (value: ReturnType<typeof raw>) => { value.Mnemonics[3]!.mnemonic = "SysCall"; },
    (value: ReturnType<typeof raw>) => { value.Mnemonics[3]!.mnemonic = "ExecBattleAI"; value.Mnemonics[3]!.operands.iValues[7] = 1; },
    (value: ReturnType<typeof raw>) => { value.Mnemonics[3]!.mnemonic = "SyncBattleAI"; value.Mnemonics[3]!.operands.rValues = []; },
    (value: ReturnType<typeof raw>) => { value.Mnemonics[3]!.mnemonic = "Wait"; value.Mnemonics[3]!.operands.rValues[0] = Infinity; },
  ]) {
    const value = raw(); mutate(value); const program = compileBattleEvent(value, source);
    assert.equal(program.instructions.length, value.Mnemonics.length);
    assert.equal(program.instructions[3]!.op.kind, "blocked");
    assert.throws(() => parseBattleLifecycle({ kind: "battle-lifecycle-v1", mode: "script", scriptId: 10, program }), /3/);
  }
});

test("source pause/interactivity flags and negative waits retain their distinct host meanings", () => {
  const program = compileBattleEvent(raw([["Nop"], ["BattlePause", [-1]], ["BattleInteractive", [0]],
    ["Wait", [], [-1]], ["Exit"]]), source);
  assert.doesNotThrow(() => assertBattleEventExecutable(program));
  assert.deepEqual(program.instructions.slice(1, 4).map(i => i.op), [
    { kind: "pause", enabled: true }, { kind: "interactive", enabled: false }, { kind: "wait", seconds: -1 },
  ]);
});

test("branches cannot read undeclared/unsupported banks or target the final label without a following instruction", () => {
  for (const op of [
    ["Branch", [2, 0, 0], [], ["ScriptLocalVariable", "＝", "imm"]],
    ["Branch", [0, 2, 0], [], ["ScriptLocalVariable", "＝", "ScriptLocalVariable"]],
    ["Branch", [0, 0, 0], [], ["AreaLocalVariable", "＝", "imm"]],
    ["Branch", [0, 0, -1], [], ["ScriptLocalVariable", "＝", "imm"]],
    ["Jump", [2]],
  ] as RawOp[]) {
    const program = compileBattleEvent(raw([["Nop"], op, ["Exit"]]), source);
    assert.equal(program.instructions[1]!.op.kind, "blocked");
  }
  const noLocals = raw(); noLocals.ScriptLocal = []; noLocals.ScriptLocalValue = [];
  assert.deepEqual(compileBattleEvent(noLocals, source).instructions[4]!.op,
    { kind: "blocked", reason: "SyncBattleAI requires ScriptLocalVariable[0]" });
});

test("shared bank operands compile without replacing the battle-local fast path", () => {
  const value = raw([["Nop"],
    ["Calc", [1, 10], [], ["ScriptLocalVariable", "←", "ScenarioVariable"]],
    ["Calc", [3, 1], [], ["ScenarioVariable", "＋", "ScriptLocalVariable"]],
    ["Branch", [3, 10, 0], [], ["ScenarioVariable", "≧", "imm"]],
    ["Calc", [1, 0], [], ["ScriptLocalVariable", "←", "ScriptLocalVariable"]],
    ["SetFlag", [52], [], ["ScenarioFlag1"]],
    ["ResetFlag", [53], [], ["ScenarioFlag1"]],
    ["FlipFlag", [12], [], ["TreasureFlag4"]], ["Exit"]]);
  const program = compileBattleEvent(value, source);
  assert.doesNotThrow(() => assertBattleEventExecutable(program));
  assert.deepEqual(program.instructions[1]!.op, { kind: "variable-calc",
    left: { category: "ScriptLocalVariable", index: 1 }, operator: "←",
    right: { kind: "variable", ref: { category: "ScenarioVariable", index: 10 } } });
  assert.deepEqual(program.instructions[2]!.op, { kind: "variable-calc",
    left: { category: "ScenarioVariable", index: 3 }, operator: "＋",
    right: { kind: "variable", ref: { category: "ScriptLocalVariable", index: 1 } } });
  assert.deepEqual(program.instructions[3]!.op, { kind: "variable-branch",
    left: { category: "ScenarioVariable", index: 3 }, operator: "≧",
    right: { kind: "immediate", value: 10 }, target: 0 });
  assert.deepEqual(program.instructions[4]!.op,
    { kind: "calc", index: 1, operator: "←", right: { kind: "local", index: 0 } });
  assert.deepEqual(program.instructions.slice(5, 8).map(instruction => instruction.op), [
    { kind: "variable-flag", ref: { category: "ScenarioFlag1", index: 52 }, operation: "set" },
    { kind: "variable-flag", ref: { category: "ScenarioFlag1", index: 53 }, operation: "reset" },
    { kind: "variable-flag", ref: { category: "TreasureFlag4", index: 12 }, operation: "flip" },
  ]);
  const first = program.instructions[1]!.op;
  if (first.kind !== "variable-calc") throw new Error("Unexpected compiler result");
  first.left.index = 99;
  assert.equal(compileBattleEvent(value, source).instructions[1]!.op.kind, "variable-calc");
  assert.equal(value.Mnemonics[1]!.operands.iValues[0], 1);
});

test("flag bank bounds retain source offset aliases while globals and locals retain their own lengths", () => {
  for (const family of ["ScenarioFlag", "TreasureFlag"]) for (let bank = 1; bank <= 4; bank++) {
    const offset = (bank - 1) * 256, category = family + bank;
    for (const index of [-offset, 1023 - offset]) {
      const p = compileBattleEvent(raw([["SetFlag", [index], [], [category]], ["Exit"]]), source);
      assert.deepEqual(p.instructions[0]!.op, { kind: "variable-flag", ref: { category, index }, operation: "set" });
      assert.doesNotThrow(() => assertBattleEventExecutable(p));
    }
    for (const index of [-offset - 1, 1024 - offset])
      assert.equal(compileBattleEvent(raw([["SetFlag", [index], [], [category]], ["Exit"]]), source).instructions[0]!.op.kind, "blocked");
  }
  for (const [category, index, kind] of [["ScenarioVariable", 15, "variable-flag"],
    ["ScenarioVariable", 16, "blocked"], ["ScriptLocalVariable", 1, "variable-flag"],
    ["ScriptLocalVariable", 2, "blocked"], ["ScenarioVariable", -1, "blocked"]] as const)
    assert.equal(compileBattleEvent(raw([["FlipFlag", [index], [], [category]], ["Exit"]]), source).instructions[0]!.op.kind, kind);
});

test("unsupported persistent and selection contexts stay blocked on either side of an operation", () => {
  for (const category of ["AreaLocalVariable", "MapLocalVariable", "MessageSelection", "ItemSelection", "FutureBank", "imm"]) {
    const inputs: RawOp[] = [
      ["SetFlag", [0], [], [category]],
      ["Calc", [0, 1], [], [category, "←", "imm"]],
      ["Branch", [0, 0, 0], [], [category, "＝", "ScriptLocalVariable"]],
    ];
    if (category !== "imm") inputs.push(["Calc", [0, 0], [], ["ScriptLocalVariable", "←", category]]);
    for (const op of inputs)
      assert.equal(compileBattleEvent(raw([["Nop"], op, ["Exit"]]), source).instructions[1]!.op.kind, "blocked");
  }
  for (const op of [
    ["Calc", [0, 16], [], ["ScriptLocalVariable", "←", "ScenarioVariable"]],
    ["Calc", [0, 2], [], ["ScenarioVariable", "←", "ScriptLocalVariable"]],
    ["Branch", [3, 1, 2], [], ["ScenarioVariable", "＝", "imm"]],
  ] as RawOp[])
    assert.equal(compileBattleEvent(raw([["Nop"], op, ["Exit"]]), source).instructions[1]!.op.kind, "blocked");
});

test("new shared instructions keep exact operand slots and reject unhandled argument tails", () => {
  for (const mutation of [
    (op: ReturnType<typeof raw>["Mnemonics"][number]) => { op.operands.iValues[1] = 1; },
    (op: ReturnType<typeof raw>["Mnemonics"][number]) => { op.operands.rValues[0] = 1; },
    (op: ReturnType<typeof raw>["Mnemonics"][number]) => { op.operands.sValues[1] = "ScenarioFlag1"; },
    (op: ReturnType<typeof raw>["Mnemonics"][number]) => { op.operands.iValues.pop(); },
  ]) {
    const value = raw([["SetFlag", [52], [], ["ScenarioFlag1"]], ["Exit"]]);
    mutation(value.Mnemonics[0]!);
    assert.equal(compileBattleEvent(value, source).instructions[0]!.op.kind, "blocked");
  }
  const bad = raw([["Calc", [3, 7], [], ["ScenarioVariable", "←", "imm"]], ["Exit"]]);
  bad.Mnemonics[0]!.operands.iValues[2] = 1;
  assert.equal(compileBattleEvent(bad, source).instructions[0]!.op.kind, "blocked");
  bad.Mnemonics[0]!.operands.iValues[2] = 0; bad.Mnemonics[0]!.operands.sValues[1] = "=";
  assert.equal(compileBattleEvent(bad, source).instructions[0]!.op.kind, "blocked");
});

test("the player-end SysCall is one exact no-argument binding with a declared return local", () => {
  const value = raw([["SysCall", [], [], ["プレイヤーの状況で戦闘終了"]], ["Exit"]]);
  assert.deepEqual(compileBattleEvent(value, source).instructions[0]!.op, { kind: "players-ended" });
  assert.doesNotThrow(() => assertBattleEventExecutable(compileBattleEvent(value, source)));
  for (const mutate of [
    (v: ReturnType<typeof raw>) => { v.Mnemonics[0]!.operands.sValues[0] += " "; },
    (v: ReturnType<typeof raw>) => { v.Mnemonics[0]!.operands.iValues[0] = 1; },
    (v: ReturnType<typeof raw>) => { v.Mnemonics[0]!.operands.rValues[0] = 0.1; },
    (v: ReturnType<typeof raw>) => { v.Mnemonics[0]!.operands.sValues[1] = "arg"; },
    (v: ReturnType<typeof raw>) => { v.ScriptLocal = []; v.ScriptLocalValue = []; },
  ]) {
    const invalid = structuredClone(value); mutate(invalid);
    assert.equal(compileBattleEvent(invalid, source).instructions[0]!.op.kind, "blocked");
  }
});

test("source headers, segment, animations and flags cannot inherit implicit defaults", () => {
  const missing = raw() as Record<string, unknown>; delete missing.SystemFlag;
  assert.throws(() => compileBattleEvent(missing, source));
  assert.throws(() => compileBattleEvent({ ...raw(), FutureHeader: 1 }, source));
  for (const mutate of [
    (value: ReturnType<typeof raw>) => { delete value.SystemFlag.SkipInitialize; },
    (value: ReturnType<typeof raw>) => { value.SystemFlag.FutureFlag = 0; },
    (value: ReturnType<typeof raw>) => { value.SystemFlag.SkipInitialize = 1; },
    (value: ReturnType<typeof raw>) => { value.Animations.push({ unknown: true }); },
    (value: ReturnType<typeof raw>) => { value.Segments[0]!.Count++; },
    (value: ReturnType<typeof raw>) => { value.Segments[0]!.EntryPoint = 1; },
    (value: ReturnType<typeof raw>) => { value.ScriptLocal[1] = value.ScriptLocal[0]!; },
  ]) {
    const value = raw(); mutate(value); const program = compileBattleEvent(value, source);
    assert.ok(program.blockers.length); assert.throws(() => assertBattleEventExecutable(program));
  }
});

test("copied script authoring names do not override the encounter resolver's asset identity", () => {
  const input = raw(); input.Name = "copied_from_another_asset";
  const program = compileBattleEvent(input, source);
  assert.doesNotThrow(() => assertBattleEventExecutable(program));
  assert.deepEqual(program.source, source);
});

test("explicit missing or count-mismatched initial values follow the existing source zero-bank rule", () => {
  for (const initial of [null, [], [7]]) {
    const value = raw(); value.ScriptLocalValue = initial;
    assert.deepEqual(compileBattleEvent(value, source).initialLocals, [0, 0]);
  }
  const value = raw(); value.ScriptLocalValue = [7, -1];
  assert.deepEqual(compileBattleEvent(value, source).initialLocals, [7, -1]);
});

test("new encounter compilation declares none and script explicitly and isolates blocked programs", () => {
  const f = runtime(), result = f.compile();
  assert.equal(result.encounters[9201]!.lifecycle!.mode, "script");
  assert.deepEqual(result.encounters[9202]!.lifecycle, { kind: "battle-lifecycle-v1", mode: "none" });
  assert.equal(result.diagnostics.some(d => d.code === "battle-script"), false);
  const value = raw(); value.Mnemonics[3]!.mnemonic = "FutureHost"; f.encounter.script!.data = value;
  const bad = f.compile();
  assert.equal(bad.encounters[9201], undefined); assert.ok(bad.encounters[9202]);
  assert.ok(bad.diagnostics.some(d => d.partyId === 9201 && d.pc === 3 && d.kind === "blocked" &&
    d.dependency?.table === "script.csv" && d.dependency.id === 8123));
});

test("a source-bound development omission stays explicit and cannot hide an unrelated binding", () => {
  const f = runtime(); f.encounter.script!.data = {};
  f.f.input.development.scripts = [{ id: 8123, source: structuredClone(source), reason: "Controlled omission" }];
  const allowed = f.compile();
  assert.deepEqual(allowed.encounters[9201]!.lifecycle, { kind: "battle-lifecycle-v1", mode: "development-omission",
    scriptId: 8123, source, reason: "Controlled omission" });
  f.encounter.script!.source.sha256 = "d".repeat(64);
  assert.equal(f.compile().encounters[9201], undefined);
  f.encounter.script!.source.sha256 = source.sha256; f.encounter.script!.data = raw();
  assert.equal(f.compile().encounters[9201]!.lifecycle!.mode, "script", "Complete programs supersede an unnecessary old omission");
});

test("missing/inconsistent source script dependencies never turn into none", () => {
  for (const kind of ["missing", "unbound"] as const) {
    const f = runtime();
    if (kind === "missing") f.encounter.script = null; else f.encounter.metadata.scriptId = 0;
    const result = f.compile();
    assert.equal(result.encounters[9201], undefined);
    assert.ok(result.diagnostics.some(d => d.code === "battle-script" && /binding/.test(d.reason)));
  }
});

test("catalog lifecycle parsing is strict and detached, including omission identity", () => {
  const program = compileBattleEvent(raw(), source), valid = { kind: "battle-lifecycle-v1", mode: "script", scriptId: 22, program };
  const parsed = parseBattleLifecycle(valid);
  assert.equal(parsed.mode, "script"); if (parsed.mode !== "script") throw new Error("unreachable");
  parsed.program.initialLocals[0] = 999; assert.equal(program.initialLocals[0], 0);
  for (const invalid of [
    {}, { kind: "battle-lifecycle-v1", mode: "none", scriptId: 1 },
    { ...valid, scriptId: 0 }, { ...valid, mode: "unknown" },
    { kind: "battle-lifecycle-v1", mode: "development-omission", scriptId: 1, source, reason: "" },
    { kind: "battle-lifecycle-v1", mode: "development-omission", scriptId: 1, source: null, reason: "unknown" },
  ]) assert.throws(() => parseBattleLifecycle(invalid));
});

test("source-owned catalog requires a per-encounter lifecycle while legacy synthetic callers remain compatible", () => {
  const catalog = runtime().catalog(); catalog.gameState.characterInitializations = {};
  assert.equal(encounterContent(catalog, 9201)!.lifecycle!.mode, "script");
  delete catalog.encounters[9201]!.lifecycle;
  assert.throws(() => encounterContent(catalog, 9201), /lifecycle binding/);
  delete catalog.gameState.characterInitializations;
  assert.equal(encounterContent(catalog, 9201)!.lifecycle, undefined);
  const synthetic = compileBattleEvent(raw(), null);
  catalog.encounters[9201]!.lifecycle = { kind: "battle-lifecycle-v1", mode: "script", scriptId: 33, program: synthetic };
  assert.ok(encounterContent(catalog, 9201)); catalog.gameState.characterInitializations = {};
  assert.throws(() => encounterContent(catalog, 9201), /source identity/);
});

test("batch dependency analysis validates lifecycle capability independently of a compiled report", () => {
  const f = runtime(), catalog = f.catalog();
  const good = analyzeBatchEncounters(catalog, [9201]);
  assert.equal(good.runtimeAdmission, "unassessed"); assert.equal(good.encounters[0]!.status, "ready");
  const lifecycle = catalog.encounters[9201]!.lifecycle!;
  assert.equal(lifecycle.mode, "script"); if (lifecycle.mode !== "script") throw new Error("unreachable");
  lifecycle.program.instructions[3]!.op = { kind: "blocked", reason: "Missing provider" };
  assert.ok(analyzeBatchEncounters(catalog, [9201]).diagnostics.some(d => d.code === "battle-lifecycle"));
  f.encounter.script!.data = {};
  f.f.input.development.scripts = [{ id: 8123, source: structuredClone(source), reason: "Controlled omission" }];
  const omitted = f.catalog();
  assert.equal(analyzeBatchEncounters(omitted, [9201]).encounters[0]!.status, "ready");
  omitted.encounterDiagnostics = omitted.encounterDiagnostics!.filter(d => d.code !== "battle-script");
  assert.ok(analyzeBatchEncounters(omitted, [9201]).diagnostics.some(d => /omission/.test(d.reason)));
});

test("script batch admission requires complete current source condition metadata independently of decoding", () => {
  for (const mutate of [
    (catalog: BattleCatalog) => { delete catalog.common.battleEvents; },
    (catalog: BattleCatalog) => { catalog.common.battleEvents!.conditions.pop(); },
    (catalog: BattleCatalog) => { catalog.common.battleEvents!.conditions[0]!.type++; },
  ]) {
    const catalog = runtime().catalog(); mutate(catalog);
    const result = analyzeBatchEncounters(catalog, [9201]);
    assert.equal(result.encounters[0]!.status, "blocked");
    assert.ok(result.diagnostics.some(d => d.code === "battle-lifecycle" && /condition/.test(d.reason)));
  }
});
