import test from "node:test";
import assert from "node:assert/strict";
import { projectPhysicalRows, validateBattleRowCatalog, type PhysicalRowRequest } from "../src/core/battle-row.js";
import { battleRowFixture } from "./fixtures/battle-row.js";

test("row compiler preserves exact source back_flag and empty-weapon identity", () => {
  const f = battleRowFixture(), { catalog, sources } = f.compile();
  assert.deepEqual(catalog.equipment, [
    { contentId: 11, weapon: { typeId: 2, backFlag: 0 } },
    { contentId: 12, weapon: { typeId: 1, backFlag: 0 } },
    { contentId: 13, weapon: { typeId: 1, backFlag: 1 } },
    { contentId: 21, weapon: null },
  ]);
  assert.deepEqual(catalog.abilities.filter((a) => a.ignoreRearguardAttack).map((a) => a.id), [124, 127, 130]);
  assert.equal(sources.length, 14);
  delete f.tables["weapon.csv"]![2]!.back_flag;
  f.tables["weapon.csv"]![2]!.range = "1";
  assert.throws(() => f.compile(), /Invalid table integer/);
});

test("native hand predicate excludes shield and empty weapon, and requires at least one weapon", () => {
  const f = battleRowFixture(), { catalog } = f.compile();
  for (const hands of [[12, 21], [21, 12], [11, 11], [21, 21], [12, 11]]) {
    const request = f.request(); request.actor.equipment = [...hands, 21, 21, 21, 21];
    assert.deepEqual(projectPhysicalRows(catalog, request),
      { actor: "back", target: "back", ignoreActorPenalty: false, ignoreTargetPenalty: false });
  }
  for (const hands of [[13, 21], [21, 13], [13, 11], [11, 13], [13, 13]]) {
    const request = f.request(); request.actor.equipment = [...hands, 21, 21, 21, 21];
    assert.deepEqual(projectPhysicalRows(catalog, request),
      { actor: "back", target: "back", ignoreActorPenalty: true, ignoreTargetPenalty: true });
  }
  // All, not Any; no action admission follows from this predicate-only case.
  const mixed = f.request(); mixed.actor.equipment = [13, 12, 21, 21, 21, 21];
  assert.equal(projectPhysicalRows(catalog, mixed).ignoreActorPenalty, false);
  // A non-hand ranged weapon cannot affect the row projection.
  mixed.actor.equipment = [11, 11, 13, 21, 21, 21];
  assert.equal(projectPhysicalRows(catalog, mixed).ignoreActorPenalty, false);
});

test("attack exception IDs, jump type420 and ability609 affect only the actor; type602 affects both", () => {
  const f = battleRowFixture(), { catalog } = f.compile();
  for (const id of [124, 127, 130, 402]) {
    const request = f.request(); request.abilityId = id;
    assert.deepEqual(projectPhysicalRows(catalog, request),
      { actor: "back", target: "back", ignoreActorPenalty: true, ignoreTargetPenalty: false });
  }
  const jump = f.request(); jump.actor.conditionTypes = [420];
  assert.equal(projectPhysicalRows(catalog, jump).ignoreActorPenalty, true);
  assert.equal(projectPhysicalRows(catalog, jump).ignoreTargetPenalty, false);
  const type = f.request(); type.abilityId = 401;
  assert.equal(projectPhysicalRows(catalog, type).ignoreActorPenalty, true);
  assert.equal(projectPhysicalRows(catalog, type).ignoreTargetPenalty, true);
});

test("row provider uses current conditions and equipment without mutation or cached exemptions", () => {
  const f = battleRowFixture(), { catalog } = f.compile(), before = structuredClone(catalog);
  const request = f.request(), original = structuredClone(request);
  assert.equal(projectPhysicalRows(catalog, request).ignoreActorPenalty, false);
  assert.deepEqual(request, original); assert.deepEqual(catalog, before);
  request.actor.conditionTypes = [420];
  assert.equal(projectPhysicalRows(catalog, request).ignoreActorPenalty, true);
  request.actor.conditionTypes = [];
  assert.equal(projectPhysicalRows(catalog, request).ignoreActorPenalty, false);
  request.actor.equipment = [13, 11, 21, 21, 21, 21];
  assert.equal(projectPhysicalRows(catalog, request).ignoreTargetPenalty, true);
});

test("enemy has no owned equipment and a source front row; player unknown ownership fails", () => {
  const f = battleRowFixture(), { catalog } = f.compile(), request = f.request();
  request.actor = { side: "enemy", row: "front", equipment: null, conditionTypes: [] };
  assert.deepEqual(projectPhysicalRows(catalog, request),
    { actor: "front", target: "back", ignoreActorPenalty: false, ignoreTargetPenalty: false });
  request.actor.row = "back";
  assert.throws(() => projectPhysicalRows(catalog, request), /enemy context/);
  for (const equipment of [null, [], [12, 21], [12, 999, 21, 21, 21, 21]]) {
    const missing = f.request(); missing.actor.equipment = equipment;
    assert.throws(() => projectPhysicalRows(catalog, missing), /equipment/);
  }
});

test("unknown row/action/conditions and ambiguous catalog metadata are not treated as front/no exemption", () => {
  const f = battleRowFixture(), { catalog } = f.compile();
  for (const amend of [
    (r: PhysicalRowRequest) => { r.actor.row = undefined as never; },
    (r: PhysicalRowRequest) => { r.targetRow = undefined as never; },
    (r: PhysicalRowRequest) => { r.abilityId = 999; },
    (r: PhysicalRowRequest) => { r.actor.conditionTypes = null as never; },
    (r: PhysicalRowRequest) => { r.actor.conditionTypes = [0]; },
  ]) { const r = f.request(); amend(r); assert.throws(() => projectPhysicalRows(catalog, r)); }
  const duplicate = structuredClone(catalog); duplicate.abilities.push(duplicate.abilities[0]!);
  assert.throws(() => validateBattleRowCatalog(duplicate), /ability metadata/);
  const drift = structuredClone(catalog); drift.abilities[1]!.ignoreRearguardAttack = false;
  assert.throws(() => validateBattleRowCatalog(drift), /ability metadata/);
  f.tables["content.csv"]!.push({ ...f.tables["content.csv"]![0]! });
  assert.throws(() => f.compile(), /Duplicate/);
});
