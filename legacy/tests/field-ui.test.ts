import test from "node:test";
import assert from "node:assert/strict";
import { FieldUiState, parseSourceLocation } from "../src/core/field-ui.js";
import { compileFieldUiInstruction } from "../src/compiler/field-ui.js";
import { fieldInstructionRequirements, assessFieldRequirements } from "../src/core/field-content-admission.js";
import type { Op } from "../src/field/types.js";
const title = (area = "Area", name = "Town") => ({ kind: "title" as const, location: { areaId: "AREA", locationId: "TOWN" }, area, title: name });
test("replacing a title preserves the old Integrator callback; title and callback clocks have one owner", () => {
  const ui = new FieldUiState("source");
  ui.prepare(title()).commit(); ui.advance(1000); ui.prepare(title("Second", "Later")).commit();
  ui.advance(990); assert.equal(ui.snapshot().title?.area, "Second");
  ui.advance(10); assert.equal(ui.snapshot().title, null); assert.equal(ui.active, true);
  ui.advance(1000); assert.equal(ui.active, false);
  const restored = FieldUiState.restore(ui.snapshot(), "source", true); assert.deepEqual(restored.snapshot(), ui.snapshot());
  assert.throws(() => FieldUiState.restore(ui.snapshot(), "another"), /identity/);
});
test("the four commands preserve Gimmick11/Event12 and all-map requests separately", () => {
  const ui = new FieldUiState("source");
  assert.equal(ui.snapshot().mainGameState, null);
  ui.prepare({ kind: "minimap" }).commit(); assert.deepEqual([ui.snapshot().mainGameState, ui.snapshot().view], [11, "navi"]);
  ui.prepare({ kind: "event" }).commit(); assert.deepEqual([ui.snapshot().mainGameState, ui.snapshot().view], [12, "navi"]);
  ui.prepare({ kind: "all" }).commit(); assert.deepEqual([ui.snapshot().mainGameState, ui.snapshot().view], [12, "all"]);
  const old = ui.prepare(title()); ui.advance(10); assert.throws(() => old.commit(), /Stale/);
  ui.prepare(title()).commit(); assert.throws(() => FieldUiState.restore(ui.snapshot(), "source", true), /Active/);
});
test("source title localization and empty IDs retain exact identities and reject controls/unknown operands", () => {
  const raw = { type: 1, mnemonic: "ShowMapTitle", operands: { iValues: Array(8).fill(0), rValues: Array(8).fill(0), sValues: ["AREA", "", "", "", "", "", "", ""] } };
  assert.deepEqual(compileFieldUiInstruction(raw, { system_zhc: { AREA: "世界" } }), { kind: "source-field-ui", command: { kind: "title", location: { areaId: "AREA", locationId: "" }, area: "世界", title: "" } });
  assert.throws(() => compileFieldUiInstruction(raw, {}), /Missing localized/);
  assert.throws(() => compileFieldUiInstruction({ ...raw, type: 2 }, {}), /MainCore/);
  assert.throws(() => compileFieldUiInstruction(raw, { system_zhc: { AREA: "<UNK>" } }), /control/);
  assert.throws(() => parseSourceLocation({ areaId: "ok", locationId: "bad\n" }), /identity/);
  for (const selector of ["UI非表示", "マップUI全て表示", "ミニマップ表示"]) {
    const sys = { ...raw, mnemonic: "SysCall", operands: { ...raw.operands, sValues: [selector, ...Array(7).fill("")] } };
    assert.equal(compileFieldUiInstruction(sys, {}).kind, "source-field-ui");
    assert.throws(() => compileFieldUiInstruction({ ...sys, operands: { ...sys.operands, iValues: [1, ...Array(7).fill(0)] } }, {}), /numeric/);
  }
});
test("full batch dependencies retain unknown UI and missing persistent location instead of granting a decoded operation", () => {
  const op: Op = { kind: "source-field-ui", command: title(), script: "source", index: 0, source: { file: "source.bundle", assetPath: "Map/source.json" } };
  const requirements = fieldInstructionRequirements(op);
  assert.deepEqual(requirements.map(row => row.capability), ["sourceFieldUi", "sourceLocation"]);
  assert.equal(assessFieldRequirements(requirements, { providers: {}, actorKind: "unknown" }).status, "conditional");
  assert.equal(assessFieldRequirements(requirements, { providers: { sourceFieldUi: "available", sourceLocation: "missing" }, actorKind: "unknown" }).status, "blocked");
  assert.equal(assessFieldRequirements(requirements, { providers: { sourceFieldUi: "available", sourceLocation: "available" }, actorKind: "unknown" }).status, "ready");
  assert.deepEqual(fieldInstructionRequirements({ ...op, command: { kind: "event" } }).map(row => row.capability), ["sourceFieldUi"]);
});
test("active title continuation retains both clocks and rejects absent, expired, reordered or unbounded callbacks", () => {
  const ui = new FieldUiState("source");
  ui.prepare(title()).commit(); ui.advance(1000); ui.prepare(title("Second", "Later")).commit();
  const saved = ui.snapshot(), restored = FieldUiState.restore(saved, "source");
  ui.advance(1000); restored.advance(1000); assert.deepEqual(restored.snapshot(), ui.snapshot());
  assert.equal(restored.snapshot().title, null); assert.equal(restored.active, true);
  for (const timers of [[], [2000], [3000, 2000], [1000, 3000], [3000, 3001], [3000, 9000]]) {
    assert.throws(() => FieldUiState.restore({ ...saved, closeTimers: timers }, "source"));
  }
  restored.advance(1000); assert.equal(restored.active, false);
});
