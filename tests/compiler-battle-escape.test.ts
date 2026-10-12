import test from "node:test";
import assert from "node:assert/strict";
import { compileBattleEncounterRuntime } from "../src/compiler/battle-encounter-runtime.js";
import { analyzeBatchEncounters } from "../src/compiler/content-batch-battle.js";
import { encounterContent } from "../src/core/battle-content.js";
import { encounterRuntimeFixture } from "./fixtures/battle-encounter-runtime.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";

const policy = { kind: "framework-battle-escape-v1" as const, id: "authored-ordinary-retreat" };
test("escape compilation is opt-in, preserves source modes and never treats AllRedrawing as ordinary retreat", () => {
  const f = encounterRuntimeFixture(); f.input.encounters[1]!.metadata.notEscape = 2;
  const original = JSON.stringify(f.input.encounters);
  assert.equal(compileBattleEncounterRuntime(f.reader(), f.input).encounters[9201]!.escapePolicy, undefined);
  f.input.development.escape = policy;
  const result = compileBattleEncounterRuntime(f.reader(), f.input);
  assert.deepEqual(result.encounters[9201]!.escapePolicy, policy);
  assert.equal(result.encounters[9202]!.escapePolicy, undefined);
  assert.ok(result.diagnostics.some(d => d.partyId === 9201 && d.code === "escape-policy" && d.kind === "development-omission"));
  assert.ok(result.diagnostics.some(d => d.partyId === 9202 && d.code === "escape"));
  assert.equal(JSON.stringify(f.input.encounters), original);
  result.encounters[9201]!.escapePolicy!.id = "changed";
  assert.equal(f.input.development.escape.id, policy.id);
});

test("escape overrides and unimplemented AP cannot be authorized by a generic omission", () => {
  for (const flagId of [3, 9, 15, 27]) {
    const f = encounterRuntimeFixture(), source = f.input.encounters[0]!;
    f.input.development.escape = policy;
    source.metadata.battleFlagGroupId = 5;
    source.metadata.battleFlags = [{ values: { id: "1", battle_flag_id: String(flagId) }, source: f.rowSource("battle_flag_group.csv", 1) }];
    f.input.development.flagGroups = [{ id: 5, rows: structuredClone(source.metadata.battleFlags), reason: "Synthetic omission" }];
    const result = compileBattleEncounterRuntime(f.reader(), f.input);
    assert.equal(result.encounters[9201], undefined);
    assert.ok(result.diagnostics.some(d => d.partyId === 9201 && d.code === "escape-flags"));
  }
  for (const key of ["getAp"] as const) {
    const f = encounterRuntimeFixture(); f.input.development.escape = policy;
    f.input.encounters[0]!.metadata[key] = 1;
    const result = compileBattleEncounterRuntime(f.reader(), f.input);
    assert.equal(result.encounters[9201], undefined);
    assert.ok(result.diagnostics.some(d => d.code === "party-rewards"));
  }
});

test("source magic points remain victory-only when an encounter also permits authored retreat", () => {
  const f = encounterRuntimeFixture(); f.input.development.escape = policy;
  f.input.encounters[0]!.metadata.getValue = 5;
  const result = compileBattleEncounterRuntime(f.reader(), f.input);
  assert.deepEqual(result.encounters[9201]!.rewardPolicy,
    { kind: "battle-reward-policy-v1", ap: 0, magicPoints: 5 });
  assert.deepEqual(result.encounters[9201]!.escapePolicy, policy);
});

test("invalid policy and misplaced common policy fail admission before a battle can open", () => {
  const f = encounterRuntimeFixture(); f.input.development.escape = { ...policy, id: "" };
  const result = compileBattleEncounterRuntime(f.reader(), f.input);
  assert.equal(result.report.compiledDefinitions, 0);
  const catalog = checkpointFixture().battle;
  Object.assign(catalog.common, { escapePolicy: policy });
  assert.throws(() => encounterContent(catalog, 1000, 1), /belong to an encounter/);
  assert.ok(analyzeBatchEncounters(catalog, [1000]).diagnostics.some(d => d.code === "encounter-escape"));
});
