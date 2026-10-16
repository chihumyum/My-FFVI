import test from "node:test";
import assert from "node:assert/strict";
import { compileBattleAI, battleAIAbilities } from "../src/compiler/battle-ai.js";
import { compileEnemyBattleDefinition } from "../src/compiler/enemy-battle-definition.js";
import { compileTargetRule } from "../src/compiler/battle-targets.js";
import { startBattleAI, planBattleAITurn, planBattleAIReaction, selectBattleAIAbilities,
  type BattleAIContext, type BattleAIReaction } from "../src/core/battle-ai.js";
import { initialEnemyBehavior } from "../src/core/enemy-behavior.js";
import { aiSource, syntheticAI } from "./fixtures/battle-ai.js";
import { encounterRuntimeFixture } from "./fixtures/battle-encounter-runtime.js";

const context = (): BattleAIContext => ({
  self: { hp: 100, mp: 10, monsterId: 9101, behavior: initialEnemyBehavior() },
  conditionIds: [], players: [{ level: 1 }], enemies: [{ level: 2 }],
});
const reaction = (changes: Partial<BattleAIReaction> = {}): BattleAIReaction => ({
  counterReady: true, receivedAbilityId: 777, receivedSystemId: 3, receivedAbilityTypeId: 4, ...changes,
});
const program = (selector = 4) => syntheticAI([
  ["Nop"], ["SyncAI"], ["StartTable", [0]],
  ["CounterActReceiveCommand", [selector, 601, 602], [0, 25, 75]],
  ["Act", [603], [100]], ["Act", [604], [100]], ["EndTable"], ["JumpBattleAI", [0]],
]);

test("received-command compilation separates the type selector from ordered ability candidates", () => {
  const raw = aiSource([["CounterActReceiveCommand", [608, 701, 701, 702], [0, 20, 30, 50]], ["SyncAI"]]);
  const before = structuredClone(raw), compiled = compileBattleAI(raw, null);
  assert.deepEqual(compiled.instructions[0]!.op, { kind: "counter-received-command",
    receivedTypeId: 608, targeting: "automatic", abilities: [701, 701, 702], weights: [20, 30, 50] });
  assert.deepEqual(battleAIAbilities(compiled), [701, 702]);
  assert.deepEqual(raw, before);
  const old = syntheticAI([["CounterAct", [701], [100]], ["SyncAI"]]);
  assert.deepEqual(old.instructions[0]!.op, { kind: "counter-act", abilities: [701], weights: [100] });
});

test("the complete selector domain reads received Ability.TypeId and does not inherit CounterAct system exclusions", () => {
  for (const selector of [2, 4, 601, 602, 607, 608]) {
    const p = program(selector), ctx = context(), initial = startBattleAI(p, ctx), before = structuredClone({ p, initial, ctx });
    for (const systemId of [2, 3, 5]) {
      const turn = planBattleAIReaction(p, initial.state, ctx,
        reaction({ receivedAbilityId: 991, receivedSystemId: systemId, receivedAbilityTypeId: selector }));
      assert.deepEqual(turn.acts, [{ kind: "counter-act", pc: 3, selected: true,
        targeting: "automatic", abilities: [601, 602], weights: [25, 75] }]);
      assert.equal(turn.state.receivedAbility, null);
    }
    const other = planBattleAIReaction(p, initial.state, ctx,
      reaction({ receivedAbilityId: selector, receivedSystemId: selector, receivedAbilityTypeId: selector + 1 }));
    assert.deepEqual(other.acts, []);
    assert.deepEqual({ p, initial, ctx }, before);
  }
});

test("readiness and living guards precede the new type query, while an eligible unknown type fails explicitly", () => {
  const p = program(), ctx = context(), initial = startBattleAI(p, ctx), before = structuredClone({ p, initial, ctx });
  assert.deepEqual(startBattleAI(p, ctx).acts, []);
  assert.deepEqual(planBattleAITurn(p, initial.state, ctx).acts.map(act => [act.kind, act.selected]),
    [["act", true], ["act", false]]);
  const missing = { counterReady: true, receivedAbilityId: 777, receivedSystemId: 3 };
  assert.deepEqual(planBattleAIReaction(p, initial.state, ctx, { ...missing, counterReady: false }).acts, []);
  assert.deepEqual(planBattleAIReaction(p, initial.state, { ...ctx, self: { ...ctx.self, hp: 0 } }, missing).acts, []);
  assert.throws(() => planBattleAIReaction(p, initial.state, ctx, missing),
    /Mnemonics\/3: missing received ability type identity/);
  for (const typeId of [-1, NaN, 0x80000000])
    assert.throws(() => planBattleAIReaction(p, initial.state, ctx, reaction({ receivedAbilityTypeId: typeId })));
  assert.deepEqual({ p, initial, ctx }, before);
});

test("reaction selection preserves the normal table row and clears receiver metadata at SyncAI", () => {
  const p = program(), ctx = context(), initial = startBattleAI(p, ctx);
  const first = planBattleAITurn(p, initial.state, ctx);
  assert.equal(first.state.actTurn, 1);
  const counter = planBattleAIReaction(p, first.state, ctx, reaction());
  assert.equal(counter.state.actTurn, 1);
  assert.equal(counter.state.turnCounter, 0);
  assert.equal(counter.state.receivedAbility, null);
  const second = planBattleAITurn(p, JSON.parse(JSON.stringify(counter.state)), ctx);
  assert.deepEqual(second.acts.filter(act => act.selected).map(act => act.abilities), [[604]]);
  const changedType = planBattleAIReaction(p, counter.state, ctx, reaction({ receivedAbilityTypeId: 5 }));
  assert.deepEqual(changedType.acts, []);
  assert.equal(changedType.state.receivedAbility, null);
  assert.throws(() => planBattleAIReaction(p, {
    ...counter.state, receivedAbility: { id: 777, systemId: 3, typeId: 4 },
  }, ctx, reaction()), /SyncAI retained received ability/);
});

test("the zero selector-weight slot preserves source float boundaries, duplicate candidates and one draw", () => {
  const p = program(), ctx = context(), turn = planBattleAIReaction(p, startBattleAI(p, ctx).state, ctx, reaction());
  for (const [draw, expected] of [[0, 601], [24.999, 601], [25, 602], [100, 602]]) {
    let count = 0;
    const selected = selectBattleAIAbilities(turn.acts[0]!, {
      integer: () => { throw new Error("A weighted command counter cannot use integer selection"); },
      float: (minimum, maximum) => { count++; assert.deepEqual([minimum, maximum], [0, 100]); return draw!; },
    });
    assert.deepEqual(selected, [expected]); assert.equal(count, 1);
  }
  const single = syntheticAI([["Nop"], ["SyncAI"],
    ["CounterActReceiveCommand", [4, 701], [0, 100]], ["JumpBattleAI", [0]]]);
  let count = 0;
  const act = planBattleAIReaction(single, startBattleAI(single, ctx).state, ctx, reaction()).acts[0]!;
  assert.deepEqual(selectBattleAIAbilities(act, { integer: () => 0, float: () => { count++; return 100; } }), [701]);
  assert.equal(count, 1, "A single source candidate still consumes one admitted draw");
});

test("reserved selectors, weights, strings and namespace changes remain blocked rather than silently normalized", () => {
  const valid = aiSource([["CounterActReceiveCommand", [4, 601, 602], [0, 25, 75]], ["SyncAI"]]);
  for (const mutation of [
    (m: typeof valid.Mnemonics[number]) => { m.type = 2; },
    (m: typeof valid.Mnemonics[number]) => { m.operands.iValues[0] = -1; },
    (m: typeof valid.Mnemonics[number]) => { m.operands.iValues = [4]; },
    (m: typeof valid.Mnemonics[number]) => { m.operands.iValues[1] = 0; },
    (m: typeof valid.Mnemonics[number]) => { m.operands.rValues[0] = 1; },
    (m: typeof valid.Mnemonics[number]) => { m.operands.rValues = [0, 25]; },
    (m: typeof valid.Mnemonics[number]) => { m.operands.rValues = []; },
    (m: typeof valid.Mnemonics[number]) => { m.operands.rValues = [0, 0, 0]; },
    (m: typeof valid.Mnemonics[number]) => { m.operands.rValues[1] = -1; },
    (m: typeof valid.Mnemonics[number]) => { m.operands.rValues[1] = 1e40; },
    (m: typeof valid.Mnemonics[number]) => { m.operands.sValues = [""]; },
    (m: typeof valid.Mnemonics[number]) => { m.mnemonic = "CounterActReceiveItem"; },
  ]) {
    const raw = structuredClone(valid); mutation(raw.Mnemonics[0]!);
    const before = structuredClone(raw);
    assert.equal(compileBattleAI(raw, null).instructions[0]!.op.kind, "blocked");
    assert.deepEqual(raw, before);
  }
});

test("a later unknown reaction opcode cannot publish earlier counter decisions or behavior changes", () => {
  const p = syntheticAI([["Nop"], ["SyncAI"], ["VariableAssign", [0, 9]],
    ["CounterActReceiveCommand", [4, 601], [0, 100]], ["UnresolvedReactionProvider"], ["JumpBattleAI", [0]]]);
  const ctx = context(), initial = startBattleAI(p, ctx), before = structuredClone({ p, ctx, initial });
  assert.throws(() => planBattleAIReaction(p, initial.state, ctx, reaction()),
    /Mnemonics\/4: unsupported AI instruction or operands: UnresolvedReactionProvider/);
  assert.deepEqual({ p, ctx, initial }, before);
});

function definitionFixture(mnemonic: string, abilities: number[]) {
  const f = encounterRuntimeFixture(), enemy = f.input.encounters[0]!.enemies[0]!;
  enemy.ai.data = aiSource([["Nop"], ["SyncAI"], ["StartTable", [0]],
    [mnemonic, mnemonic === "CounterActReceiveCommand" ? [4, ...abilities] : abilities,
      mnemonic === "CounterActReceiveCommand" ? [0, ...abilities.map(() => 50)] : abilities.map(() => 50)],
    ["Act", [13], [100]], ["EndTable"], ["JumpBattleAI", [0]]]);
  return { f, input: { enemy, entryPhase: "initial" as const, abilities: f.input.abilities,
    conditions: f.input.conditions, sprites: f.input.sprites, name: f.input.name,
    parameters: f.input.parameters, physical: f.input.physical, formationPlan: null } };
}

test("enemy dependency compilation retains every received-command child and its original failure PC", () => {
  const { f, input } = definitionFixture("CounterActReceiveCommand", [13, 999]);
  const before = structuredClone({ ...input, name: null }), result = compileEnemyBattleDefinition(f.reader(), input);
  assert.deepEqual(result.definition?.abilities, [13, 999]);
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === "ability-reference" &&
    diagnostic.pc === 3 && diagnostic.dependency?.id === 999));
  // The compiler's name resolver is a function; compare all data fields only.
  assert.deepEqual({ ...input, name: null }, before);
});

test("both counter families admit exact self range while ordinary other ranges stay bounded", () => {
  for (const mnemonic of ["CounterActReceiveCommand", "CounterAct"]) {
    const { f, input } = definitionFixture(mnemonic, [13]), ability = input.abilities[13]!;
    ability.program.range = 5; ability.plan!.targeting = compileTargetRule(5, 1)!;
    const result = compileEnemyBattleDefinition(f.reader(), input);
    assert.deepEqual(result.definition?.abilities, [13]);
    const targetIssues = result.diagnostics.filter(diagnostic => diagnostic.code === "automatic-target");
    assert.equal(targetIssues.length, 0);
    if (targetIssues[0]) assert.deepEqual([targetIssues[0].pc, targetIssues[0].dependency?.id], [3, 13]);
  }
});
