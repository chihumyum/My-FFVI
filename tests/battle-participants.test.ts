import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixtures/battle-content.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";
import { encounterContent } from "../src/core/battle-content.js";
import { enemyBattleDefinition, parseBattleParticipantContent, projectBattleParticipantInitial,
  type BattleParticipantContent } from "../src/core/battle-participants.js";

function participants() {
  const content = fixture();
  content.enemies[0]!.placement = { x: 12, y: -8, group: 1 };
  content.enemies[1]!.placement = { x: -20, y: 13, group: 2 };
  const first = content.enemies[0]!, second = content.enemies[1]!;
  const initial: BattleParticipantContent = { kind: "battle-participant-content-v1",
    profile: "web-unique-id-slots-v1", rewardScope: "active-units",
    enemyDefinitions: { [first.sourceId]: enemyBattleDefinition(first) },
    slots: { 5: { ...first.placement! }, 9: { ...second.placement! } },
    initial: [{ id: first.id, sourceId: first.sourceId, uniqueId: 5 },
      { id: second.id, sourceId: second.sourceId, uniqueId: 9 }],
  };
  return { content, initial };
}

test("masters, slots and opaque initial instance identities remain separate and detached", () => {
  const f = participants();
  f.initial.enemyDefinitions[2000] = { ...structuredClone(f.initial.enemyDefinitions[1000]!), sourceId: 2000 };
  const parsed = parseBattleParticipantContent(f.initial, f.content.enemies);
  assert.deepEqual(projectBattleParticipantInitial(parsed), f.content.enemies);
  assert.equal(parsed.initial.length, 2, "A reserve definition does not create a current unit");
  assert.deepEqual(parsed.initial.map(entry => entry.uniqueId), [5, 9]);
  parsed.enemyDefinitions[1000]!.ai!.instructions[0]!.mnemonic = "changed";
  parsed.slots[5]!.x = 900;
  parsed.initial[0]!.id = "changed";
  assert.notEqual(f.initial.enemyDefinitions[1000]!.ai!.instructions[0]!.mnemonic, "changed");
  assert.equal(f.initial.slots[5]!.x, 12);
  assert.equal(f.initial.initial[0]!.id, "e1");
});

test("the initial projection must match the complete encounter definitions in order", () => {
  for (const mutate of [
    (f: ReturnType<typeof participants>) => { f.initial.enemyDefinitions[1000]!.hp++; },
    (f: ReturnType<typeof participants>) => { f.initial.enemyDefinitions[1000]!.ai!.instructions[0]!.mnemonic = "changed"; },
    (f: ReturnType<typeof participants>) => { f.initial.initial.reverse(); },
    (f: ReturnType<typeof participants>) => { f.initial.slots[5]!.group = 2; },
  ]) {
    const f = participants(); mutate(f);
    assert.throws(() => parseBattleParticipantContent(f.initial, f.content.enemies), /differs/);
  }
});

test("unknown policies or fields never become legacy static or default rewards", () => {
  for (const changed of [
    { kind: "battle-participant-content-v2" }, { profile: "native" }, { rewardScope: "unknown" },
    { unexpected: true },
  ]) assert.throws(() => parseBattleParticipantContent({ ...participants().initial, ...changed }));
  const absent = { ...participants().initial } as Partial<BattleParticipantContent>;
  delete absent.rewardScope;
  assert.throws(() => parseBattleParticipantContent(absent));
  assert.throws(() => parseBattleParticipantContent(undefined));
});

test("missing, duplicate and out-of-policy slot bindings fail before any unit exists", () => {
  for (const change of [
    (f: ReturnType<typeof participants>) => { f.initial.initial[0]!.uniqueId = 0; },
    (f: ReturnType<typeof participants>) => { f.initial.initial[0]!.uniqueId = 10; },
    (f: ReturnType<typeof participants>) => { f.initial.initial[0]!.uniqueId = 3; },
    (f: ReturnType<typeof participants>) => { f.initial.initial[1]!.uniqueId = 5; },
    (f: ReturnType<typeof participants>) => { f.initial.initial[1]!.id = "e1"; },
    (f: ReturnType<typeof participants>) => { f.initial.initial[0]!.sourceId = 999; },
    (f: ReturnType<typeof participants>) => { f.initial.slots["05"] = f.initial.slots[5]!; },
    (f: ReturnType<typeof participants>) => { f.initial.slots[5]!.x = Number.NaN; },
    (f: ReturnType<typeof participants>) => { f.initial.slots[5]!.group = 3; },
  ]) {
    const f = participants(); change(f);
    assert.throws(() => parseBattleParticipantContent(f.initial));
  }
});

test("a master cannot carry another identity, a runtime unit or owned-player state", () => {
  for (const change of [
    (f: ReturnType<typeof participants>) => { f.initial.enemyDefinitions[1000]!.sourceId = 1001; },
    (f: ReturnType<typeof participants>) => { f.initial.enemyDefinitions["01000"] = f.initial.enemyDefinitions[1000]!; },
    (f: ReturnType<typeof participants>) => { Object.assign(f.initial.enemyDefinitions[1000]!, { id: "runtime" }); },
    (f: ReturnType<typeof participants>) => { Object.assign(f.initial.enemyDefinitions[1000]!, { maxHp: 50 }); },
    (f: ReturnType<typeof participants>) => { Object.assign(f.initial.enemyDefinitions[1000]!, { appearance: {} }); },
    (f: ReturnType<typeof participants>) => { f.initial.enemyDefinitions[1000]!.side = "player"; },
    (f: ReturnType<typeof participants>) => { f.initial.enemyDefinitions[1000]!.hp = 0; },
  ]) {
    const f = participants(); change(f);
    assert.throws(() => parseBattleParticipantContent(f.initial));
  }
});

test("sparse references and invalid source AI object identities remain explicit errors", () => {
  for (const change of [
    (f: ReturnType<typeof participants>) => { delete f.initial.initial[0]; },
    (f: ReturnType<typeof participants>) => { f.initial.enemyDefinitions[1000]!.abilities = new Array(1); },
    (f: ReturnType<typeof participants>) => { f.initial.enemyDefinitions[1000]!.attackElements = new Array(1); },
    (f: ReturnType<typeof participants>) => { f.initial.enemyDefinitions[1000]!.ai!.instructions = new Array(3); },
    (f: ReturnType<typeof participants>) => { f.initial.enemyDefinitions[1000]!.ai = null; },
    (f: ReturnType<typeof participants>) => {
      f.initial.enemyDefinitions[1000]!.ai!.source = { sourceSetHash: "s", battleSourceSetHash: "b",
        file: "fixture", sha256: "a", assetPath: "synthetic", serializedFile: "data", objectId: "9223372036854775808" };
    },
  ]) {
    const f = participants(); change(f);
    assert.throws(() => parseBattleParticipantContent(f.initial));
  }
});

test("unimplemented AI instructions survive structural parsing for the existing runtime gate", () => {
  const f = participants();
  const ai = f.initial.enemyDefinitions[1000]!.ai!;
  ai.instructions[2] = { mnemonic: "Unknown", op: { kind: "blocked", reason: "fixture capability missing" } };
  const parsed = parseBattleParticipantContent(f.initial);
  assert.deepEqual(parsed.enemyDefinitions[1000]!.ai!.instructions[2]!.op,
    { kind: "blocked", reason: "fixture capability missing" });
});

test("encounter content binds participants independently from common and returns a detached contract", () => {
  const f = participants(), catalog = checkpointFixture().battle;
  catalog.encounters = { 1000: { encounterId: 1000, enemies: f.content.enemies, background: f.content.background,
    formation: "normal", participants: f.initial } };
  const resolved = encounterContent(catalog, 1000)!;
  assert.deepEqual(resolved.participants, f.initial);
  resolved.participants!.initial[0]!.id = "mutated";
  assert.equal(catalog.encounters[1000]!.participants!.initial[0]!.id, "e1");
  Object.assign(catalog.common, { participants: f.initial });
  assert.throws(() => encounterContent(catalog, 1000), /must belong to an encounter/);
});

test("legacy absent content stays static and never acquires a dynamic template registry", () => {
  const catalog = checkpointFixture().battle;
  const resolved = encounterContent(catalog, Number(Object.keys(catalog.encounters)[0]))!;
  assert.equal(Object.hasOwn(resolved, "participants"), false);
});
