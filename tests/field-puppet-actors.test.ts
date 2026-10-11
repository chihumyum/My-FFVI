import test from "node:test";
import assert from "node:assert/strict";
import { fieldPuppetActorsFixture } from "./fixtures/field-puppet-actors.js";
import { compileFieldPuppetActorCatalog, compileFieldPuppetScriptContext } from "../src/compiler/field-puppet-actors.js";
import { fieldPuppetLeaderId, fieldPuppetAssignments, projectFieldPuppetAssignment, fieldPuppetResidentIndex,
  resolveFieldPuppetActor, projectFieldPuppetActorEntry, projectFieldPuppetInitialization } from "../src/core/field-puppet-actors.js";

test("source Format flags are explicit int32 != 0 values, not defaulted fields", () => {
  const f = fieldPuppetActorsFixture();
  assert.equal(compileFieldPuppetScriptContext({ ...f.rawScript, SystemFlag: {
    ...f.rawScript.SystemFlag, KeepPlayerPuppet: -3,
  } }, f.misc).keepPlayerPuppet, true);
  for (const flag of Object.keys(f.rawScript.SystemFlag)) {
    const raw = structuredClone(f.rawScript) as { SystemFlag: Record<string, number> };
    delete raw.SystemFlag[flag];
    assert.throws(() => compileFieldPuppetScriptContext(raw, f.misc));
  }
  assert.throws(() => compileFieldPuppetActorCatalog({ ...f.misc, corps_order: [0, 1, 1, 3] }), /ordering/);
});

test("leader ID compresses occupied Corps cells in source order without filtering enabled", () => {
  const f = fieldPuppetActorsFixture();
  f.context.owned[1]!.enabled = false;
  assert.equal(fieldPuppetLeaderId(f.catalog, f.context), -1002);
  assert.equal(resolveFieldPuppetActor(f.catalog, f.context, -1002).actor, "puppet:2");
  f.catalog.corpsOrder = [3, 2, 0, 1];
  assert.equal(fieldPuppetLeaderId(f.catalog, f.context), -1001);
  assert.equal(resolveFieldPuppetActor(f.catalog, f.context, -1001).actor, "puppet:2");
  f.context.savedLeaderIndex = 1;
  assert.throws(() => fieldPuppetLeaderId(f.catalog, f.context), /occupied/);
});

test("negative saved leader clamps to position zero, but empty zero is an error", () => {
  const f = fieldPuppetActorsFixture(); f.context.savedLeaderIndex = -1;
  assert.equal(fieldPuppetLeaderId(f.catalog, f.context), -1001);
  f.context.party[0] = 0;
  assert.throws(() => fieldPuppetLeaderId(f.catalog, f.context), /occupied/);
});

test("actual player, source puppet -1001, camera zero and other parties are distinct instances", () => {
  const f = fieldPuppetActorsFixture();
  assert.equal(resolveFieldPuppetActor(f.catalog, f.context, -1001).actor, "puppet:0");
  assert.equal(resolveFieldPuppetActor(f.catalog, f.context, 0).actor, "camera");
  assert.equal(resolveFieldPuppetActor(f.catalog, f.context, -1030).actor, null);
  assert.equal(resolveFieldPuppetActor(f.catalog, f.context, -1005).actor, null);
  assert.equal(resolveFieldPuppetActor(f.catalog, f.context, 999).actor, null);
  assert.throws(() => resolveFieldPuppetActor(f.catalog, f.context, -1033), /error-log/);
});

test("resident alias chooses highest enabled owned Id, then checks actual party membership", () => {
  const f = fieldPuppetActorsFixture();
  f.context.owned.push({ ownedId: 8, sourceId: 102, enabled: false, conditionTypes: [] });
  assert.equal(fieldPuppetResidentIndex(f.catalog, f.context, 12), 1);
  assert.equal(resolveFieldPuppetActor(f.catalog, f.context, -12).actor, "puppet:2");
  f.context.owned[2]!.enabled = true;
  assert.equal(fieldPuppetResidentIndex(f.catalog, f.context, 12), null);
  assert.equal(resolveFieldPuppetActor(f.catalog, f.context, -12).actor, null);
  f.context.party[2] = 8;
  assert.equal(fieldPuppetResidentIndex(f.catalog, f.context, 12), 1);
});

test("resident assignment conflicts throw; puppet conflicts choose first free of four slots", () => {
  const first = projectFieldPuppetAssignment(fieldPuppetAssignments(), 1, true, 4);
  assert.throws(() => projectFieldPuppetAssignment(first.assignments, 1, true, 4), /already assigned/);
  assert.equal(projectFieldPuppetAssignment(first.assignments, -1002, false, 4).id, -1001);
  assert.throws(() => projectFieldPuppetAssignment([true, true, true, true, false], -1002, false, 4), /No free/);
  assert.equal(projectFieldPuppetAssignment([false, false, false, false, false], -1005, false, 4).id, -1005);
});

test("source immediate player Hide optimization skips puppet allocation and needs no leader", () => {
  const f = fieldPuppetActorsFixture(), assignments = fieldPuppetAssignments();
  const plan = projectFieldPuppetActorEntry({ ...f, entityId: -1001, nextMnemonic: "Hide", leaderId: null, assignments });
  assert.equal(plan.skipEntry, true);
  assert.deepEqual(plan.effects, [{ kind: "hide", actor: "player" }]);
  assert.deepEqual(plan.assignments, assignments);
});

test("ordinary positive entity entry does not infer or require unused negative-alias context", () => {
  const f = fieldPuppetActorsFixture();
  f.context.companion = "unknown"; f.context.conditionController = "unknown";
  f.context.restorePartyInstruction = "unknown"; f.context.transport = "unknown";
  const plan = projectFieldPuppetActorEntry({ ...f, entityId: 17, nextMnemonic: "Move", leaderId: null, assignments: fieldPuppetAssignments() });
  assert.equal(plan.actor, "npc"); assert.equal(plan.skipEntry, false);
  assert.deepEqual(plan.effects, []);
});

test("player source alias remaps to the leader puppet and hides only actual player", () => {
  const f = fieldPuppetActorsFixture();
  const plan = projectFieldPuppetActorEntry({ ...f, entityId: -1001, nextMnemonic: "Move", leaderId: -1002, assignments: fieldPuppetAssignments() });
  assert.equal(plan.entityId, -1002); assert.equal(plan.actor, "puppet:2");
  assert.deepEqual(plan.effects, [{ kind: "hide", actor: "player" }]);
  assert.deepEqual(plan.assignments, fieldPuppetAssignments());
});

test("party leader explicit puppet normalizes before shared assignment, resident leader hides player", () => {
  const f = fieldPuppetActorsFixture();
  const direct = projectFieldPuppetActorEntry({ ...f, entityId: -1002, nextMnemonic: "Move", leaderId: -1002, assignments: fieldPuppetAssignments() });
  assert.equal(direct.entityId, -1001); assert.equal(direct.actor, "puppet:0");
  assert.deepEqual(direct.assignments, [true, false, false, false, false]);
  const resident = projectFieldPuppetActorEntry({ ...f, entityId: -12, nextMnemonic: "Move", leaderId: -1002, assignments: fieldPuppetAssignments() });
  assert.equal(resident.entityId, -12); assert.equal(resident.actor, "puppet:2");
  assert.deepEqual(resident.effects, [{ kind: "hide", actor: "player" }]);
});

test("nonparty resident keeps XY, takes player Z and layer with both render refresh calls", () => {
  const f = fieldPuppetActorsFixture();
  const plan = projectFieldPuppetActorEntry({ ...f, entityId: -200, nextMnemonic: "Move", leaderId: -1002, assignments: fieldPuppetAssignments() });
  assert.deepEqual(plan.effects, [
    { kind: "copy-position", actor: "resident:200", from: "player", mode: "player-z" },
    { kind: "copy-layer", actor: "resident:200", from: "player" },
    { kind: "apply-view-properties", actor: "resident:200" }, { kind: "attach-transparent", actor: "resident:200" },
  ]);
});

test("-1010 binds ordinary leader while condition stand-in or missing controller remains blocked", () => {
  const f = fieldPuppetActorsFixture();
  const plan = projectFieldPuppetActorEntry({ ...f, entityId: -1010, nextMnemonic: "Move", leaderId: -1002, assignments: fieldPuppetAssignments() });
  assert.equal(plan.effects[0]!.kind, "copy-position");
  assert.equal(plan.effects[4]!.kind, "hide");
  f.context.owned[1]!.conditionTypes = [665];
  assert.throws(() => resolveFieldPuppetActor(f.catalog, f.context, -1010), /stand-in/);
  f.context.owned[1]!.conditionTypes = []; f.context.conditionController = "unknown";
  assert.throws(() => resolveFieldPuppetActor(f.catalog, f.context, -1010), /controller/);
});

test("source start copies only present compressed puppets in metadata order, including repeated leader", () => {
  const f = fieldPuppetActorsFixture(), before = structuredClone(f);
  const plan = projectFieldPuppetInitialization({ ...f, phase: "start" });
  assert.deepEqual(f, before);
  assert.equal(plan.leaderId, -1002);
  assert.deepEqual(plan.effects.filter((e) => e.kind === "copy-position").map((e) => e.actor), ["puppet:0", "puppet:2", "puppet:2"]);
  assert.deepEqual(plan.effects[0], { kind: "init-camera-dummy", actor: "camera", player: "player" });
  assert.deepEqual(plan.effects.at(-1), { kind: "cue", actor: "puppet:2", from: "player" });
  assert.equal(plan.effects.some((e) => e.kind === "hide" && e.actor === "player"), false);
  assert.deepEqual(plan.assignments, fieldPuppetAssignments());
});

test("source keep-player-puppet shows substitute before hiding player", () => {
  const f = fieldPuppetActorsFixture(); f.script.keepPlayerPuppet = true;
  const plan = projectFieldPuppetInitialization({ ...f, phase: "start" });
  assert.deepEqual(plan.effects.slice(-5), [
    { kind: "show", actor: "puppet:2" }, { kind: "apply-view-properties", actor: "puppet:2" },
    { kind: "attach-transparent", actor: "puppet:2" }, { kind: "hide", actor: "player" },
    { kind: "cue", actor: "puppet:2", from: "player" },
  ]);
});

test("finish selects current leader, restores position/layer/direction/animation, then hides puppets", () => {
  const f = fieldPuppetActorsFixture(); f.context.savedLeaderIndex = 0;
  const plan = projectFieldPuppetInitialization({ ...f, phase: "finish" });
  assert.deepEqual(plan.effects.slice(0, 7).map((e) => e.kind), ["init-camera-dummy", "copy-position", "copy-layer", "apply-view-properties", "attach-transparent", "look", "cue"]);
  assert.deepEqual(plan.effects.at(-1), { kind: "show", actor: "player" });
  assert.equal(plan.assignments, null, "finish does not reset the shared assignment list");
  assert.deepEqual(plan.effects.filter((e) => e.kind === "hide").map((e) => e.actor), ["puppet:0", "puppet:2", "puppet:0", "puppet:0"]);
});

test("lifecycle unknown providers and same-name but different source misc reject without mutation", () => {
  const f = fieldPuppetActorsFixture();
  for (const key of ["companion", "restorePartyInstruction", "conditionController"] as const) {
    const next = structuredClone(f); next.context[key] = "unknown";
    const before = structuredClone(next);
    assert.throws(() => projectFieldPuppetInitialization({ ...next, phase: "start" }));
    assert.deepEqual(next, before);
  }
  const next = structuredClone(f); next.script.miscHash = "f".repeat(64);
  assert.throws(() => projectFieldPuppetInitialization({ ...next, phase: "start" }), /mismatch/);
});

test("explicit SkipInitialize changes no actor/assignment state", () => {
  const f = fieldPuppetActorsFixture(); f.script.skipInitialize = true;
  f.context.companion = "unknown"; f.context.conditionController = "unknown";
  for (const phase of ["start", "finish"] as const)
    assert.deepEqual(projectFieldPuppetInitialization({ ...f, phase }), { leaderId: null, assignments: null, effects: [] });
});

test("riding requires an actual current transportation; effects never substitute unmounted media", () => {
  const f = fieldPuppetActorsFixture(); f.context.actors[0]!.riding = true; f.context.transport = "unknown";
  assert.throws(() => projectFieldPuppetInitialization({ ...f, phase: "start" }), /transportation/);
  f.context.transport = { id: 6, typeId: 12 };
  const plan = projectFieldPuppetInitialization({ ...f, phase: "start" });
  assert.deepEqual(plan.effects.filter((e) => e.kind === "ride-on").map((e) => e.transportationId), [6, 6, 6]);
  assert.equal(plan.effects.some((e) => e.kind === "ride-out"), false);
});
