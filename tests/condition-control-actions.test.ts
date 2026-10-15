import test from "node:test";
import assert from "node:assert/strict";
import { projectBattleAbilities, projectBattleCommandAvailability } from "../src/core/battle-abilities.js";
import { planWebControlAction, planWebControlTarget } from "../src/core/condition-control-actions.js";
import { battleAITargetBlocker, planBattleAITarget } from "../src/core/battle-ai-targets.js";
import { battleAbilityFixture } from "./fixtures/battle-abilities.js";
import type { TargetRule } from "../src/core/battle-targets.js";

const rule: TargetRule = { relation: "either", modes: ["single"], defaultMode: "single", defaultRelation: "enemy",
  normalFormationOnly: false, life: "alive" };
const units = [{ id: "player", side: "player" as const, hp: 10 }, { id: "enemy", side: "enemy" as const, hp: 10 }];

test("automatic command availability preserves the persistent order and bypasses menu release without bypassing exclusions", () => {
  const f = battleAbilityFixture(), before = structuredClone(f), context = { ...f.context, conditionIds: [53] };
  assert.equal(projectBattleAbilities(f.catalog, f.member, context).entries.find(entry => entry.commandId === 1)!.released, false);
  const automatic = projectBattleCommandAvailability(f.catalog, f.member, context);
  assert.deepEqual(automatic.entries.map(entry => entry.commandId), f.member.abilities.commandIds);
  assert.equal(automatic.entries.find(entry => entry.commandId === 1)!.released, true);
  const invalid = projectBattleCommandAvailability(f.catalog, f.member, { ...context, invalidContentIds: [2007] });
  assert.equal(invalid.entries.find(entry => entry.commandId === 7)!.available, false);
  assert.deepEqual(f, before);
});

test("Web control planning validates every candidate before shared draws and never silently drops an unknown branch", () => {
  const input = { policy: "web-source-control-actions-v1" as const, actor: units[0]!, units, formation: "normal" as const,
    candidates: [{ commandId: 7, abilities: [{ id: 31, range: 7, rule }] }, { commandId: 1, abilities: [{ id: 1, range: 7, rule }] }] };
  const before = structuredClone(input), calls: [number, number][] = [];
  const result = planWebControlAction(input, (min, max) => { calls.push([min, max]); return min; });
  assert.equal(result.commandId, 7); assert.equal(result.abilityId, 31); assert.ok(calls.length >= 3);
  assert.deepEqual(input, before);
  const invalid = structuredClone(input); invalid.candidates[1]!.abilities[0]!.range = 999;
  calls.length = 0;
  assert.throws(() => planWebControlAction(invalid, (min, max) => { calls.push([min, max]); return min; }), /target domain/);
  assert.deepEqual(calls, []);
  const split = { id: 31, range: 6, rule: { ...rule, modes: ["single", "side"] as ("single" | "side")[], normalFormationOnly: true } };
  assert.throws(() => planWebControlTarget(split, units[0]!, [units[0]!, units[0]!], "normal", () => { throw new Error("unexpected draw"); }),
    /current control-action unit/);
});

test("control-only range16 requires an explicit Web target policy and still rejects counter/opposed reinterpretation", () => {
  const group: TargetRule = { ...rule, relation: "enemy", modes: ["side"], defaultMode: "side", normalFormationOnly: true },
    policy = { kind: "web-source-control-actions-v1" as const };
  assert.match(battleAITargetBlocker(16, group, "normal", "normal")!, /Unimplemented/);
  assert.equal(battleAITargetBlocker(16, group, "normal", "normal", policy), null);
  assert.match(battleAITargetBlocker(16, group, "counter", "normal", policy)!, /Unimplemented/);
  assert.match(battleAITargetBlocker(16, group, "normal", "opposed", policy)!, /formation/);
  assert.deepEqual(planBattleAITarget({ actor: units[1]!, units, eligiblePlayers: [units[0]!], range: 16,
    rule: group, formation: "normal", controlPolicy: policy }, () => { throw new Error("group selection must not draw"); }),
  { selection: { kind: "side", side: "player" }, targetIds: ["player"] });
});
