import test from "node:test";
import assert from "node:assert/strict";
import { compileFieldBirdViewMoveInstruction } from "../src/compiler/field-bird-view-actors.js";
import { prepareFieldBirdViewMove, projectFieldBirdViewMove, createFieldBirdViewActorPose,
  parseFieldBirdViewActorCheckpoint, parseFieldBirdViewActorPose } from "../src/core/field-bird-view-actors.js";
import { fieldInstructionRequirements } from "../src/core/field-content-admission.js";
import { birdRaw } from "./fixtures/bird-view-actors.js";
const decode = (raw = birdRaw()) => compileFieldBirdViewMoveInstruction(raw).command;
test("MoveBirdView delegates the original Move operands but height-only branches do not interpret unused direction or speed", () => {
  assert.deepEqual(decode(), { kind: "move-bird-view", heightRatio: 0, duration: 0,
    move: { kind: "move", direction: "right", steps: 1, speedId: 0, animation: "" } });
  assert.equal(decode(birdRaw([4, 0, 900], [2, .5], "ignored")).move, null);
  assert.equal(decode(birdRaw([-100, -1, 900])).move, null);
  assert.equal(decode(birdRaw([3, 2, -1], [0, .1], "WalkL")).move!.speedId, null);
  for (const r of [birdRaw([4, 1, 0]), birdRaw([1, 1, 7]), birdRaw([1, 1, 0], [0, -.1]), birdRaw([1, 1, 0, 1])])
    assert.throws(() => decode(r));
});
test("float target clamps before scaling, while the later height clock waits for both duration and actual movement", () => {
  for (const [request, target] of [[-9, 0], [-1, 0], [0, 60], [1, 120], [3, 240], [99, 240], [1e300, 240]])
    assert.equal(prepareFieldBirdViewMove(decode(birdRaw([1, 0, 0], [request!, .5])), { kind: "present", height: 30 }, 4).target, target);
  const command = decode(birdRaw([1, 2, 0], [1, .5])), progress = prepareFieldBirdViewMove(command, { kind: "present", height: 0 }, 4);
  const before = structuredClone(progress);
  assert.deepEqual(projectFieldBirdViewMove(command, progress, { kind: "present", height: 0 }, 4.25, true), { height: 60, ratio: .5, flow: "wait" });
  assert.equal(projectFieldBirdViewMove(command, progress, { kind: "present", height: 60 }, 4.5, true).flow, "wait");
  assert.equal(projectFieldBirdViewMove(command, progress, { kind: "present", height: 120 }, 4.5, false).flow, "next");
  assert.deepEqual(progress, before);
  assert.throws(() => projectFieldBirdViewMove(command, { ...progress, target: 60 }, { kind: "present", height: 0 }, 4.5, false), /original command/);
});
test("proved absent accessors use zero and discard height writes; unknown accessors cannot masquerade as absence", () => {
  const command = decode(birdRaw([4, 0, 0], [1, 0])), progress = prepareFieldBirdViewMove(command, { kind: "absent" }, 0);
  assert.deepEqual(progress, { start: 0, target: 120, startedAt: 0 });
  assert.deepEqual(projectFieldBirdViewMove(command, progress, { kind: "absent" }, .01, false), { height: null, ratio: 1, flow: "next" });
  assert.throws(() => prepareFieldBirdViewMove(command, undefined, 0), /Unknown/);
  assert.throws(() => projectFieldBirdViewMove(command, progress, undefined, .01, false), /Unknown/);
});
test("stable elevation values cannot carry policy, unknown actors, invalid numbers or a different source binding", () => {
  const binding = { mapId: 9, contentHash: "a".repeat(64), actorId: "native:puppet:0" }, pose = createFieldBirdViewActorPose(binding, 60);
  assert.deepEqual(parseFieldBirdViewActorPose(pose, binding), pose);
  assert.throws(() => parseFieldBirdViewActorPose(pose, { ...binding, mapId: 10 }), /owner/);
  for (const value of [-1, 241, NaN, .1]) assert.throws(() => createFieldBirdViewActorPose(binding, value));
  const checkpoint = { kind: "field-bird-view-actor-poses-v1" as const, poses: [{ actorId: binding.actorId, height: 60 }] };
  assert.deepEqual(parseFieldBirdViewActorCheckpoint(checkpoint), checkpoint);
  assert.throws(() => parseFieldBirdViewActorCheckpoint({ ...checkpoint, policy: "forged" } as typeof checkpoint));
  assert.throws(() => parseFieldBirdViewActorCheckpoint({ ...checkpoint, poses: [...checkpoint.poses, ...checkpoint.poses] }));
});
test("height and delegated Move remain separate runtime requirements with exact source provenance", () => {
  const site = { script: "authored", index: 4, source: { file: "authored", assetPath: "authored/move", objectId: "90071992547409937" } };
  const requirements = fieldInstructionRequirements({ ...site, ...compileFieldBirdViewMoveInstruction(birdRaw()) });
  assert.deepEqual(requirements.map(r => r.capability), ["birdViewActors", "scriptMotion"]);
  assert(requirements.every(r => r.site.source.objectId === site.source.objectId));
  assert.deepEqual(fieldInstructionRequirements({ ...site, ...compileFieldBirdViewMoveInstruction(birdRaw([4, 0, 0])) }).map(r => r.capability), ["birdViewActors"]);
});
