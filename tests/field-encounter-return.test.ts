import test from "node:test";
import assert from "node:assert/strict";
import { FieldGame, type FieldEncounterReturnState } from "../src/core/field.js";
import { characterLearningSessionFixture } from "./fixtures/character-learning-session.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";
import type { Op, Site } from "../src/field/types.js";

function sourceReturn() {
  const fixture = characterLearningSessionFixture(), session = fixture.make(), field = session.field;
  assert.equal(field.startEvent("learning"), true);
  assert.equal(field.stop?.kind, "encounter");
  const candidate = (): FieldEncounterReturnState => ({
    puppetRoster: field.options.puppetRoster!.current(),
    partyAppearance: field.options.partyAppearance!.current(),
  });
  return { session, field, candidate, party: 1000 };
}
function state(field: FieldGame) {
  return structuredClone({
    native: field.nativeActorStateFingerprint,
    camera: field.cameraSnapshot,
    appearance: field.partyActorCheckpoint,
    event: field.eventState.snapshot(), stop: field.stop,
    collision: field.collisionState, busy: field.busy,
  });
}

test("source battle return stages one detached candidate and publishes existing actor identities exactly once", () => {
  const t = sourceReturn(), before = state(t.field), owner = t.field.actors;
  const refs = Object.values(owner).map((actor) => ({ actor, native: actor.native!, entity: actor.native!.entity }));
  const candidate = t.candidate();
  let reads = 0, ownedCommits = 0;
  const resume = t.field.prepareEncounterReturn(t.party, () => { reads++; return candidate; });
  assert.equal(reads, 1);
  assert.deepEqual(state(t.field), before, "preparing must not finish the suspended source script");
  candidate.puppetRoster.owned[0]!.sourceId = 99999;
  candidate.partyAppearance!.activeMembers.length = 0;
  resume.validate();
  const port = t.field.options.puppetActors!, read = port.read;
  resume.commitWith(() => {
    ownedCommits++;
    // The real owned commit replaces its old roster. Any reread afterwards
    // would validate the new owner against a stale preparation baseline.
    port.read = () => { throw new Error("Old roster read after owned publication"); };
  });
  port.read = read;
  assert.equal(reads, 1); assert.equal(ownedCommits, 1);
  assert.equal(t.field.actors, owner); assert.equal(t.field.stop, null);
  assert.equal(t.field.cameraSnapshot!.target, "dummy");
  assert.equal(t.field.busy, true, "the continuation is scheduled, not pumped during publication");
  for (const ref of refs) {
    assert.equal(owner[ref.actor.id], ref.actor);
    assert.equal(ref.actor.native, ref.native); assert.equal(ref.native.entity, ref.entity);
  }
  assert.throws(() => resume.commitWith(() => { ownedCommits++; }), /Stale/);
  assert.equal(ownedCommits, 1);
  t.field.advance(10);
  assert.equal(t.field.busy, false); assert.equal(t.field.checkpointReady, true);
  assert.equal(t.field.cameraSnapshot!.target, "player");
});

test("missing candidate appearance and changed party identities refuse source return without publication", () => {
  const t = sourceReturn(), before = state(t.field);
  assert.throws(() => t.field.prepareEncounterReturn(t.party), /candidate owned-state/);
  assert.throws(() => t.field.prepareEncounterReturn(t.party, () => ({ ...t.candidate(), partyAppearance: null })), /appearance/);
  assert.throws(() => t.field.prepareEncounterReturn(t.party, () => {
    const candidate = t.candidate(); candidate.puppetRoster.party[0] = 0; return candidate;
  }), /roster\/party transition/);
  assert.throws(() => t.field.prepareEncounterReturn(t.party, () => {
    const candidate = t.candidate();
    candidate.partyAppearance!.activeMembers[0]!.jobId = 99999;
    candidate.partyAppearance!.parties[0]![0]!.jobId = 99999;
    return candidate;
  }), /asset|appearance|job/i);
  assert.deepEqual(state(t.field), before);
});

test("actor and event changes invalidate a prepared source return before the owned callback", () => {
  for (const mutate of [
    (field: FieldGame) => { field.player.native!.entity.visible = !field.player.native!.entity.visible; },
    (field: FieldGame) => { field.eventState.write({ category: "ScenarioFlag1", index: 40 }, 1); },
  ]) {
    const t = sourceReturn(), resume = t.field.prepareEncounterReturn(t.party, t.candidate);
    resume.validate(); mutate(t.field);
    const modified = state(t.field);
    let calls = 0;
    assert.throws(() => resume.commitWith(() => { calls++; }), /Stale/);
    assert.equal(calls, 0); assert.deepEqual(state(t.field), modified);
  }
});

test("a provider changing event state during validation cannot publish the return", () => {
  const t = sourceReturn(), resume = t.field.prepareEncounterReturn(t.party, t.candidate);
  const port = t.field.options.puppetActors!, read = port.read;
  const before = state(t.field);
  port.read = () => {
    const value = read();
    t.field.eventState.write({ category: "ScenarioFlag1", index: 41 }, 1);
    return value;
  };
  let calls = 0;
  assert.throws(() => resume.commitWith(() => { calls++; }), /Stale battle continuation/);
  assert.equal(calls, 0);
  const after = state(t.field);
  assert.deepEqual({ ...after, event: before.event }, before, "only the offending read callback's own write remains");
});

test("owned-state refusal leaves native actors, camera and suspended tasks unchanged", () => {
  const t = sourceReturn(), before = state(t.field), resume = t.field.prepareEncounterReturn(t.party, t.candidate);
  assert.throws(() => resume.commitWith(() => { throw new Error("Stale owned lease"); }), /Stale owned lease/);
  assert.deepEqual(state(t.field), before);
  assert.throws(resume, /Stale/);
  const retry = t.field.prepareEncounterReturn(t.party, t.candidate);
  retry();
  assert.equal(t.field.stop, null, "a fresh preparation may retry an unpublished return");
});

test("unfinished native movement rejects return before candidate-owned state is read", () => {
  const t = sourceReturn();
  t.field.player.motion = { from: { x: 3, y: 4 }, to: { x: 4, y: 4 }, elapsed: 0, duration: 240, manual: false };
  const before = state(t.field);
  let reads = 0;
  assert.throws(() => t.field.prepareEncounterReturn(t.party, () => { reads++; return t.candidate(); }), /unfinished field activity/);
  assert.equal(reads, 0); assert.deepEqual(state(t.field), before);
});

test("native asynchronous Move blocks encounter entry before borrowing battle state", () => {
  const f = characterLearningSessionFixture();
  type Instruction<T> = T extends Site ? Omit<T, keyof Site> : never;
  const ops: Instruction<Op>[] = [
    { kind: "puppet", slot: 0, actor: "-1001", target: 5 },
    { kind: "exec-puppets", asynchronous: true },
    { kind: "wait", seconds: 0.03 },
    { kind: "encounter", party: 1000, continuation: "after-learning" },
    { kind: "exit" }, { kind: "nop" },
    { kind: "field-script-motion", command: { kind: "move", direction: "right", steps: 2,
      speedId: 1, animation: "WalkR" } },
    { kind: "exit" },
  ];
  f.map.scripts.learning = ops.map((op, index) => ({ ...op, script: "learning", index, source: f.source }) as Op);
  const session = f.make(), before = session.state.snapshot();
  session.field.startEvent("learning");
  for (let i = 0; i < 20 && !session.field.stop; i++) session.advance(10);
  assert.equal(session.field.stop?.kind, "unsupported");
  assert.match(session.field.stop!.message, /field activity/);
  assert.equal(session.battle, null, "cannot start a battle whose supported return cannot finish");
  assert.deepEqual(session.state.snapshot(), before);
  const motion = session.field.actors["native:puppet:0"]!.motion;
  assert.ok(motion); assert.equal(motion.elapsed, 30); assert.equal(motion.duration, 480);
  assert.equal(session.checkpointReady, false);
});

test("legacy encounter return keeps the joint API without reading source-only providers", () => {
  const f = checkpointFixture(), field = new FieldGame(f.field);
  field.content.scripts.after = [{ kind: "exit", script: "after", index: 0, source: field.content.map.source }];
  field.stop = { kind: "encounter", party: 23, continuation: "after", site: null, message: "Controlled encounter" };
  const resume = field.prepareEncounterReturn(23, () => { throw new Error("Unexpected native state read"); });
  let calls = 0; resume.validate(); resume.commitWith(() => { calls++; });
  assert.equal(calls, 1); assert.equal(field.stop, null);
  assert.throws(resume, /Stale/);
});
