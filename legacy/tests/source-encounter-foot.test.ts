import test from "node:test";
import assert from "node:assert/strict";
import { captureSourceEncounterFootBackground } from "../src/core/source-encounter-foot.js";
import type { FieldEntryContextDefinition } from "../src/core/field-entry-context.js";

function fixture() {
  const source = { file: "controlled.bundle", assetPath: "Controlled/package.json", objectId: "-9223372036854775808" };
  const definition: FieldEntryContextDefinition = { kind: "field-entry-context-v1", mapId: 91, beastFieldController: "source-singleton",
    foot: { kind: "uniform-zero", basis: "default-monster-set", monsterSetId: 5, source }, groups: {} };
  return { definition, mapId: 91, entrySynchronized: true,
    player: { id: "actual-player", position: { x: 16, y: 32, z: 48 }, layer: 9 } };
}
test("source default-table BG0 is not fabricated null/master foot information", () => {
  const f = fixture(), before = structuredClone(f), capture = captureSourceEncounterFootBackground(f);
  assert.equal(capture.backgroundId, 0); assert.equal(capture.origin, "default-or-excluded-unprojected");
  assert.equal(capture.fullFootInformation, "not-projected"); assert.deepEqual(capture.player, f.player);
  assert.equal(capture.source.objectId, "-9223372036854775808"); assert.deepEqual(f, before);
  f.player.position.x = 999; f.definition.foot.source.file = "changed";
  assert.equal(capture.player.position.x, 16); assert.equal(capture.source.file, "controlled.bundle");
});
test("absent attribute without a default has a distinct known-null BG0 projection", () => {
  const f = fixture(); f.definition.foot = { kind: "uniform-zero", basis: "no-attribute-asset", monsterSetId: 0,
    source: f.definition.foot.source };
  const capture = captureSourceEncounterFootBackground(f);
  assert.equal(capture.origin, "known-null"); assert.equal(capture.backgroundId, 0);
});
test("a zero beast/qualification value cannot authorize terrain/overwrite selection", () => {
  const f = fixture(); f.definition.foot = { kind: "unresolved", reason: "known qualification zero alone is insufficient",
    source: f.definition.foot.source };
  assert.throws(() => captureSourceEncounterFootBackground(f), /terrain foot background/);
});
test("map identity, source bindings and entry synchronization remain required", () => {
  for (const kind of ["map", "sync", "source", "default", "absent-default"] as const) {
    const f = fixture();
    if (kind === "map") f.mapId++;
    if (kind === "sync") f.entrySynchronized = false;
    if (kind === "source") f.definition.foot.source.objectId = "rounded:9223372036854776000";
    if (kind === "default") (f.definition.foot as Extract<FieldEntryContextDefinition["foot"], { kind: "uniform-zero" }>).monsterSetId = 0;
    if (kind === "absent-default") (f.definition.foot as Extract<FieldEntryContextDefinition["foot"], { kind: "uniform-zero" }>).basis = "no-attribute-asset";
    assert.throws(() => captureSourceEncounterFootBackground(f), /definition|synchronization|binding|evidence/);
  }
});
test("pre-sync native position is retained exactly; malformed or non-float32 poses cannot masquerade as source", () => {
  for (const kind of ["nonfinite", "fraction", "layer", "identity"] as const) {
    const f = fixture();
    if (kind === "nonfinite") f.player.position.x = Infinity;
    if (kind === "fraction") f.player.position.x = .1;
    if (kind === "layer") f.player.layer = -1;
    if (kind === "identity") f.player.id = "";
    assert.throws(() => captureSourceEncounterFootBackground(f), /native player pose/);
  }
});
