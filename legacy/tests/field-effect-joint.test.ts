import assert from "node:assert/strict";
import test from "node:test";
import type { Op, Site } from "../src/field/types.js";
import { FieldCameraHost } from "../src/core/field-camera-host.js";
import { FieldEffectMap } from "../src/core/field-effect-map.js";
import { FieldEffects, createFieldEffectState, type FieldEffectOperation,
  type FieldEffectPlan, type FieldEffectRuntimeHost } from "../src/core/field-effects.js";
import { effectCatalog, effectDefinition } from "./fixtures/field-effects.js";
import { fieldMenuReadyFixture } from "./fixtures/field-menu-ready.js";

type Instruction<T> = T extends Site ? Omit<T, keyof Site> : never;
const source = { file: "synthetic", assetPath: "joint-ready.json" };
const script = (name: string, ops: Instruction<Op>[]): Op[] => ops.map((op, index) => ({ ...op, script: name, index, source }) as Op);
const mixed = script("mixed", [
  { kind: "puppet", slot: 0, actor: "0", target: 5 },
  { kind: "puppet", slot: 1, actor: "101", target: 7 },
  { kind: "exec-puppets", asynchronous: false }, { kind: "wait", seconds: 0 }, { kind: "exit" },
  { kind: "wait", seconds: 1 }, { kind: "exit" },
  { kind: "wait", seconds: 1 }, { kind: "exit" },
]);

test("Ready validates FX before jointly publishing camera visibility and puppet state", () => {
  const f = fieldMenuReadyFixture(true, (field) => { field.scripts.mixed = mixed; });
  const prepare = f.runtime.fieldEffects.prepare;
  let validations = 0;
  f.runtime.fieldEffects.prepare = (plan) => {
    const transaction = prepare(plan), before = f.game.field.cameraSnapshot!.dummy.visibility;
    return { validate: () => {
      transaction.validate(); validations++;
      assert.deepEqual(f.game.field.cameraSnapshot!.dummy.visibility, before, "FX must validate against the pre-Ready camera");
    }, commit: transaction.commit };
  };
  const commits = f.control.commits;
  f.game.field.startEvent("mixed");
  assert.equal(f.game.field.stop, null);
  assert.ok(validations > 0);
  assert.equal(f.game.field.cameraSnapshot!.dummy.visibility.activeSelf, true);
  assert.equal(f.control.commits, commits + 1);
  assert.equal(f.game.field.busy, true);
});

test("group FX setup validates before the new tile bindings become visible", () => {
  const f = fieldMenuReadyFixture(true, (field) => {
    const tile = structuredClone(field.map.entities.find((entity) => entity.id === "region")!);
    tile.id = "event-region";
    field.map.groups!.later!.entities.push(tile);
  });
  const prepare = f.runtime.fieldEffects.prepare;
  f.runtime.fieldEffects.prepare = (plan) => {
    const transaction = prepare(plan), before = f.game.field.tileAnimations.has("event-region");
    return { validate: () => {
      transaction.validate();
      assert.equal(f.game.field.tileAnimations.has("event-region"), before, "FX must validate against the pre-group tile bindings");
    }, commit: transaction.commit };
  };
  const commits = f.control.commits;
  f.game.field.startEvent("groups");
  assert.equal(f.game.field.stop, null);
  assert.equal(f.game.field.tileAnimations.has("event-region"), true);
  assert.equal(f.game.field.activeGroups.has("later"), true);
  assert.equal(f.control.commits, commits + 1);
});

function jointHost() {
  const control = { state: createFieldEffectState(), commits: 0, validations: 0,
    validate: () => {}, plans: [] as FieldEffectPlan[] };
  const validate = () => { control.validations++; control.validate(); };
  const prepare = (plans: readonly FieldEffectPlan[]) => {
    const copy = structuredClone(plans);
    return { validate, commit: () => {
      for (const plan of copy) {
        assert.deepEqual(plan.before, control.state);
        control.state = structuredClone(plan.after);
        control.plans.push(plan);
      }
      control.commits++;
    } };
  };
  const host: FieldEffectRuntimeHost = { prepare: (plan) => prepare([plan]),
    observe: () => { throw new Error("This transaction fixture cannot simulate particles"); },
    beginCandidate: () => ({ validate, prepare: (batch) => prepare(batch.plans) }),
  };
  return { control, owner: new FieldEffects(effectCatalog(), host) };
}
const create = (id: string): FieldEffectOperation => ({ kind: "create", id,
  definition: effectDefinition(), position: { x: 5, y: 6, z: 49 } });

for (const kind of ["live", "private", "lease"] as const) {
  test(`${kind} joint publication rejects false, locks reentry and never validates after the joined owner`, () => {
    const { owner, control } = jointHost(), candidate = kind === "private" ? owner.fork() : null;
    const lease = kind === "lease" ? new FieldEffectMap("controlled-map", owner, ["a", "rejected"]) : null;
    const access = candidate ?? lease ?? owner;
    const before = access.snapshot(), rejected = access.prepare([create("rejected")]);
    assert.equal(rejected.commitWith(() => false), false);
    assert.deepEqual(access.snapshot(), before);
    assert.equal(control.commits, 0);
    assert.throws(() => rejected.commit(), /Stale/);
    const prepared = access.prepare([create("a")]);
    let ownedPublished = false;
    control.validate = () => assert.equal(ownedPublished, false, "host checks precede the joined owner");
    assert.equal(prepared.commitWith(() => {
      assert.throws(() => access.prepare([]), /Stale|busy|in progress/);
      if (lease) assert.throws(() => lease.retire(lease.snapshot()), /in progress/);
      assert.deepEqual(access.snapshot(), before, "a locked owner remains readable");
      ownedPublished = true;
      return true;
    }), true);
    assert.deepEqual(access.snapshot().boards.map((board) => board.id), ["a"]);
    control.validate = () => {};
    assert.throws(() => prepared.commit(), /Stale/);
    if (candidate) {
      assert.deepEqual(owner.snapshot(), before);
      assert.equal(control.commits, 0);
      candidate.seal().commit();
      assert.equal(control.plans.length, 1, "a rejected local preparation does not enter the batch");
    }
    assert.equal(control.commits, 1);
  });
}

function cameraHost() {
  const { field } = fieldMenuReadyFixture(false);
  return new FieldCameraHost(field.cameraHost!, {
    readPlayer: () => ({ cell: { x: 1, y: 1 }, logicalLayer: 12, direction: "down" }),
    readScrollOffset: () => ({ x: 0, y: 0 }),
  });
}

test("a stale camera rejects a joint Ready before actors or the FX host can publish", () => {
  const camera = cameraHost(), { owner, control } = jointHost();
  const effect = owner.prepare([create("a")]), staleCamera = camera.prepareVisibility(true);
  camera.prepareVisibility(false).commit();
  const cameraBefore = camera.snapshot(), effectsBefore = owner.snapshot();
  let actorsPublished = 0;
  assert.throws(() => effect.commitWith(() => staleCamera.commitWith(() => {
    actorsPublished++; return true;
  })), /Stale field camera/);
  assert.equal(actorsPublished, 0);
  assert.equal(control.commits, 0);
  assert.deepEqual(camera.snapshot(), cameraBefore);
  assert.deepEqual(owner.snapshot(), effectsBefore);
  assert.throws(() => effect.commit(), /Stale/);
});

test("camera publication locks reentrant mutation and false leaves its snapshot unchanged", () => {
  const camera = cameraHost(), before = camera.snapshot(), prepared = camera.prepareVisibility(true);
  assert.equal(prepared.commitWith(() => {
    assert.throws(() => camera.prepareVisibility(false), /publication is already in progress/);
    assert.deepEqual(camera.snapshot(), before);
    return false;
  }), false);
  assert.deepEqual(camera.snapshot(), before);
  assert.throws(() => prepared.commit(), /Stale/);
  camera.prepareVisibility(true).commit();
  assert.equal(camera.snapshot().dummy.visibility.activeSelf, true);
});

test("invalid group tile bindings reject before FX, actor and entity publication", () => {
  const f = fieldMenuReadyFixture(true, (field) => {
    const tile = structuredClone(field.map.entities.find((entity) => entity.id === "region")!);
    tile.id = "invalid-region";
    tile.tileAnimation!.cells![0]!.index = -1;
    field.map.groups!.later!.entities.push(tile);
  });
  const effects = structuredClone(f.control.state), commits = f.control.commits;
  const actors = Object.keys(f.game.field.actors), entities = f.game.field.entities.map((entity) => entity.id);
  f.game.field.startEvent("groups");
  assert.equal(f.game.field.stop!.kind, "unsupported");
  assert.match(f.game.field.stop!.message, /Invalid tile animation cell/);
  assert.equal(f.game.field.tileAnimations.has("invalid-region"), false);
  assert.equal(f.game.field.activeGroups.has("later"), false);
  assert.deepEqual(Object.keys(f.game.field.actors), actors);
  assert.deepEqual(f.game.field.entities.map((entity) => entity.id), entities);
  assert.deepEqual(f.control.state, effects);
  assert.equal(f.control.commits, commits);
});
