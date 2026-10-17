import assert from "node:assert/strict";
import test from "node:test";
import { decodeFieldOp } from "../src/compiler/field.js";
import { analyzeContentDependencies } from "../src/compiler/content-dependencies.js";
import { FieldGame } from "../src/core/field.js";
import { EventState } from "../src/core/event-state.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";
import { ownedConditionGameFixture } from "./fixtures/owned-condition.js";
import type { Op } from "../src/field/types.js";

const script = "controlled-party-query", source = { file: "synthetic", assetPath: "shared-party-query" };
const marker = { category: "MapLocalVariable" as const, index: 0 };
const query = decodeFieldOp({ type: 1, mnemonic: "BranchByNumOfMember", operands: {
  iValues: [0, 0, 3, 0, 0, 0, 0, 0], rValues: Array(8).fill(0), sValues: ["＝", "", "", "", "", "", "", ""],
} }, { script, index: 0, source }, {});
const instructions: Op[] = [query,
  { kind: "calc", left: marker, operator: "←", right: { kind: "immediate", value: 11 }, script, index: 1, source },
  { kind: "exit", script, index: 2, source }, { kind: "nop", script, index: 3, source },
  { kind: "calc", left: marker, operator: "←", right: { kind: "immediate", value: 22 }, script, index: 4, source },
  { kind: "exit", script, index: 5, source }];

test("VM party queries follow published shared state through save/restore without a second roster", () => {
  const { field } = checkpointFixture(), owner = ownedConditionGameFixture();
  field.scripts[script] = structuredClone(instructions);
  const events = EventState.initialized(), options = { puppetRoster: owner.state.fieldPuppetRoster };
  const game = new FieldGame(field, events, undefined, undefined, options);
  assert.equal(game.startEvent(script), true);
  assert.equal(events.read(marker), 11); assert.equal(game.stop, null);
  owner.state.fieldParty.prepare({ kind: "select-slot", slot: 2, refreshActors: false }).commit();
  assert.equal(game.startEvent(script), true);
  assert.equal(events.read(marker), 22); assert.equal(game.stop, null);
  const savedOwner = owner.state.snapshot(), savedField = game.checkpoint();
  const restoredOwner = owner.make(); restoredOwner.restore(JSON.parse(JSON.stringify(savedOwner)));
  const restored = FieldGame.restore(field, JSON.parse(JSON.stringify(savedField)), {
    puppetRoster: restoredOwner.fieldPuppetRoster });
  restoredOwner.fieldParty.prepare({ kind: "select-slot", slot: 0, refreshActors: false }).commit();
  assert.equal(restored.startEvent(script), true);
  assert.equal(restored.eventState.read(marker), 11);
  assert.equal(game.eventState.read(marker), 22); // Distinct restored owner.
});

test("VM failure never executes either branch marker when the live party provider fails", () => {
  const { field } = checkpointFixture(); field.scripts[script] = structuredClone(instructions);
  for (const options of [{}, { puppetRoster: { current: () => { throw new Error("Controlled owner failure"); } } }]) {
    const events = EventState.initialized(); events.write(marker, 99);
    const game = new FieldGame(field, events, undefined, undefined, options);
    game.startEvent(script); assert.ok(game.stop); assert.equal(events.read(marker), 99);
  }
});

test("batch closure validates the query label continuation before content admission", () => {
  const f = checkpointFixture(), map = f.target;
  map.scripts[script] = structuredClone(instructions);
  const analyze = () => analyzeContentDependencies({ catalog: f.world, maps: [map],
    roots: [{ kind: "script", mapId: map.mapId, script }], mapIds: [map.mapId] });
  assert.ok(!analyze().diagnostics.some(d => d.code === "instruction-target-invalid"));
  const op = map.scripts[script]![0]!;
  assert.equal(op.kind, "field-party-query");
  if (op.kind === "field-party-query") op.target = instructions.length - 1;
  assert.ok(analyze().diagnostics.some(d => d.code === "instruction-target-invalid"));
});
