import test from "node:test";
import assert from "node:assert/strict";
import { createFieldActorFactoryCandidate } from "../src/core/field-actor-factory.js";
import { createWebFlatConditionLeaderActivityPort, WEB_FLAT_CONDITION_LEADER_ACTIVITY } from "../src/core/field-condition-activity.js";
import { createNativeFieldActorProjections, readNativeFieldActors, type NativeFieldActor } from "../src/core/field-native-actors.js";
import { fieldActorFactoryFixture } from "./fixtures/field-actor-factory.js";

function setup() {
  const f = fieldActorFactoryFixture(), candidate = createFieldActorFactoryCandidate(f.input);
  const owner: Record<string, NativeFieldActor> = Object.fromEntries(
    createNativeFieldActorProjections(candidate, f.map.mapRange, f.partyCatalog).map(actor => [actor.id, actor]));
  const host = { readActors: () => owner, readBindings: () => candidate.bindings, readFactory: () => f.factory };
  const port = createWebFlatConditionLeaderActivityPort(), scope = port.prepare(host);
  const draft = () => readNativeFieldActors(owner, null).actors.find(entity => entity.id === candidate.bindings.player)!;
  return { f, candidate, owner, host, port, scope, draft };
}
test("named Web flat policy reads same draft activeSelf independently of alpha and live pre-state", () => {
  const t = setup(), draft = t.draft();
  assert.equal(t.port.policy, WEB_FLAT_CONDITION_LEADER_ACTIVITY); assert.ok(Object.isFrozen(t.port));
  draft.visible = false; draft.fadeAlpha = 1;
  assert.equal(t.scope.isActiveAndEnabled(draft.id, draft), false);
  draft.visible = true; draft.fadeAlpha = 0;
  assert.equal(t.scope.isActiveAndEnabled(draft.id, draft), true);
  assert.equal(t.owner[draft.id]!.native.entity.visible, true);
});
test("unknown/mismatched instances and unresolved hierarchy representations remain unknown", () => {
  const t = setup();
  for (const kind of ["id", "child", "character", "ride"] as const) {
    const draft = t.draft();
    if (kind === "id") draft.id = "saved-but-unbound";
    if (kind === "child") draft.childEntityObject = "unknown";
    if (kind === "character") draft.character = false;
    if (kind === "ride") draft.rideOnEntity = "unknown";
    assert.equal(t.scope.isActiveAndEnabled(t.candidate.bindings.player, draft), "unknown");
  }
  assert.equal(t.scope.isActiveAndEnabled("saved-but-unbound", t.draft()), "unknown");
});
test("factory source changes, missing actors and duplicate binding identities cannot prepare scopes", () => {
  for (const kind of ["source", "prefab", "absent", "duplicate", "child"] as const) {
    const t = setup();
    if (kind === "source") t.f.factory.sources[0]!.sha256 = "0".repeat(64);
    if (kind === "prefab") Reflect.set(t.f.factory.playerPrefab, "objectId", "rounded-or-replaced");
    if (kind === "absent") delete t.owner[t.candidate.bindings.player];
    if (kind === "duplicate") t.candidate.bindings.partyPuppets[0] = t.candidate.bindings.player;
    if (kind === "child") t.owner[t.candidate.bindings.player]!.native.entity.childEntityObject = "unknown";
    assert.throws(() => t.port.prepare(t.host), /factory|identity|actor|prefab/);
  }
});
test("map transition, equal actor/entity replacement and changed source bindings invalidate old scope", () => {
  for (const kind of ["owner", "actor", "entity", "bindings", "factory", "contents"] as const) {
    const t = setup(), id = t.candidate.bindings.player;
    if (kind === "owner") t.host.readActors = () => ({ ...t.owner });
    if (kind === "actor") t.owner[id] = { ...t.owner[id]! };
    if (kind === "entity") t.owner[id]!.native.entity = { ...t.owner[id]!.native.entity };
    if (kind === "bindings") t.host.readBindings = () => structuredClone(t.candidate.bindings);
    if (kind === "factory") t.host.readFactory = () => structuredClone(t.f.factory);
    if (kind === "contents") t.f.factory.sources[0]!.sha256 = "f".repeat(64);
    assert.throws(() => t.scope.validate(), /Stale/);
    assert.throws(() => t.scope.isActiveAndEnabled(id, t.draft()), /Stale/);
  }
});
test("source-backed visibility changes keep the same scope, save data cannot create another scope", () => {
  const t = setup(), id = t.candidate.bindings.player, entity = t.owner[id]!.native.entity;
  entity.visible = false; t.scope.validate();
  assert.equal(t.scope.isActiveAndEnabled(id, t.draft()), false);
  const before = t.f.factory; Reflect.set(t.host, "readFactory", () => ({ visible: true }));
  assert.throws(() => t.port.prepare(t.host), /factory/); assert.equal(t.f.factory, before);
});
