import test from "node:test";
import assert from "node:assert/strict";
import { ActorAnimation } from "../src/core/actor-animation.js";
import { projectConditionLeaderAffect } from "../src/core/condition-leader.js";
import { projectFieldPuppetActorEffects, type FieldPuppetHostSnapshot,
  type FieldPuppetHostProviders } from "../src/core/field-puppet-effects.js";

function fixture() {
  const source = { file: "synthetic", assetPath: "condition-leader" };
  const media = { source, sprites: { body: { file: "body.png", width: 16, height: 24,
    pivot: [0.5, 0] as [number, number], sha256: "synthetic", source } },
    animations: Object.fromEntries(["Default", "next"].map(key => [key, {
      frames: [{ sprite: "body", x: 0, y: 0, alpha: 1, flip: false }], duration: .5,
      mode: 0, next: key === "Default" ? "next" : "", flip: false }])) };
  const snapshot: FieldPuppetHostSnapshot = { camera: null, actors: ["old", "new"].map((id, index) => {
    const animation = new ActorAnimation(media); animation.cue("Default", -1);
    return { id, character: true, position: { x: index * 16, y: index * -8, z: 0 },
      layer: 9 + index, direction: index ? "right" : "left", animation, visible: !index,
      fadeAlpha: index ? 0 : 1, childEntityObject: "absent", moving: false, riding: false,
      riderAssetId: null, rideOnEntity: "idle", bodyOpaque: true, shadowVisible: true,
      viewBinding: { map: "fixture", layer: 9 + index }, transparentTextures: { first: null, second: null } };
  }) };
  const providers: FieldPuppetHostProviders = { mapRenderContext: "fixture", transportationType: 1,
    footAttribute: () => 0, upperTexture: null, ceilTexture: null };
  return { snapshot, providers };
}
const serial = (s: FieldPuppetHostSnapshot) => s.actors.map(a => ({ ...a, animation: a.animation?.snapshot() }));

test("false source visual flag returns before actor/media/active-provider work", () => {
  assert.deepEqual(projectConditionLeaderAffect({ keepBadStatusVisual: false, before: null }),
    { result: "flag-disabled", effects: [] });
  assert.throws(() => projectConditionLeaderAffect({ keepBadStatusVisual: undefined, before: null }), /Unknown.*flag/);
});
test("true requires its captured old instance and exact activity provider", () => {
  assert.throws(() => projectConditionLeaderAffect({ keepBadStatusVisual: true, before: null }), /captured/);
  assert.throws(() => projectConditionLeaderAffect({ keepBadStatusVisual: true,
    before: { actor: "old", activeAndEnabled: "unknown" }, afterActor: "old" }), /active\/enabled/);
});
test("native inactive return does not query or require the new alias", () => {
  assert.deepEqual(projectConditionLeaderAffect({ keepBadStatusVisual: true,
    before: { actor: "old", activeAndEnabled: false } }), { result: "previous-inactive", effects: [] });
});
test("active old instance cannot turn a missing post-refresh alias into a no-op", () => {
  assert.throws(() => projectConditionLeaderAffect({ keepBadStatusVisual: true,
    before: { actor: "old", activeAndEnabled: true }, afterActor: null }), /post-refresh/);
});
test("transfer executes direct world pose/layer and cue without copying direction or reapplying material", () => {
  const f = fixture(), before = serial(f.snapshot);
  const plan = projectConditionLeaderAffect({ keepBadStatusVisual: true,
    before: { actor: "old", activeAndEnabled: true }, afterActor: "new" });
  const next = projectFieldPuppetActorEffects(plan.effects, f.snapshot, f.providers);
  assert.deepEqual(serial(f.snapshot), before);
  assert.equal(next.actors[0]!.visible, false); assert.equal(next.actors[1]!.visible, true);
  assert.deepEqual(next.actors[1]!.position, next.actors[0]!.position);
  assert.equal(next.actors[1]!.layer, next.actors[0]!.layer);
  assert.equal(next.actors[1]!.direction, "right");
  assert.equal(next.actors[1]!.viewBinding!.layer, 10, "native direct layer write does not refresh material properties");
  assert.equal(next.actors[1]!.animation!.snapshot()!.key, "next");
});
test("same-leader still hides/shows and cues the same-key successor", () => {
  const f = fixture();
  const plan = projectConditionLeaderAffect({ keepBadStatusVisual: true,
    before: { actor: "old", activeAndEnabled: true }, afterActor: "old" });
  assert.equal(plan.effects.length, 5);
  const next = projectFieldPuppetActorEffects(plan.effects, f.snapshot, f.providers);
  assert.equal(next.actors[0]!.visible, true); assert.equal(next.actors[0]!.fadeAlpha, 1);
  assert.equal(next.actors[0]!.animation!.snapshot()!.key, "next");
  assert.equal(f.snapshot.actors[0]!.animation!.snapshot()!.key, "Default");
});
test("late cue failure or unknown children preserves every original actor and playback", () => {
  const f = fixture(), plan = projectConditionLeaderAffect({ keepBadStatusVisual: true,
    before: { actor: "old", activeAndEnabled: true }, afterActor: "new" });
  f.snapshot.actors[1]!.animation = null;
  const before = serial(f.snapshot);
  assert.throws(() => projectFieldPuppetActorEffects(plan.effects, f.snapshot, f.providers), /animation\/media/);
  assert.deepEqual(serial(f.snapshot), before);
  const other = fixture(); other.snapshot.actors[0]!.childEntityObject = "unknown";
  const original = serial(other.snapshot);
  assert.throws(() => projectFieldPuppetActorEffects(plan.effects, other.snapshot, other.providers), /child/);
  assert.deepEqual(serial(other.snapshot), original);
});
