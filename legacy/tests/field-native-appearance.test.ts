import test from "node:test";
import assert from "node:assert/strict";
import { compileFieldNativeAnimationKeys } from "../src/compiler/field-native-appearance.js";
import { createFieldActorFactoryCandidate } from "../src/core/field-actor-factory.js";
import { createNativeFieldActorProjections, readNativeFieldActors, type NativeFieldActor } from "../src/core/field-native-actors.js";
import { prepareNativeFieldActorAppearance, replaceNativeFieldActorAnimation, type NativeFieldAppearanceHost } from "../src/core/field-native-appearance.js";
import type { FieldPartyActorRenderStep } from "../src/core/field-party-actors.js";
import { fieldActorFactoryFixture } from "./fixtures/field-actor-factory.js";

function setup() {
  const f = fieldActorFactoryFixture(), candidate = createFieldActorFactoryCandidate(f.input);
  const owner: Record<string, NativeFieldActor> = Object.fromEntries(
    createNativeFieldActorProjections(candidate, f.map.mapRange, f.partyCatalog).map((actor) => [actor.id, actor]));
  const raw = Object.fromEntries(Object.entries(f.characters).map(([name, c]) => [name, { animation: {
    source: c.source, data: { animation: Object.keys(c.animations).map((name) => ({ name })) },
  } }]));
  const keys = compileFieldNativeAnimationKeys(f.partyCatalog, raw);
  let reads = 0;
  const host: NativeFieldAppearanceHost = {
    readActors: () => { reads++; return owner; }, readCatalog: () => { reads++; return f.partyCatalog; },
    readCharacters: () => { reads++; return f.characters; }, readProviders: () => { reads++; return f.input.providers; },
    readAnimationKeys: () => { reads++; return keys; },
  };
  const step = (changes: [string, number][]): FieldPartyActorRenderStep => ({ media: { asset: "bravo", mount: null }, plan: {
    selectedLeaderIndex: 0, savedLeaderIndex: 0,
    changes: changes.map(([actorId, id]) => ({ actorId, asset: f.partyCatalog.assets[id]!, mode: "replace", reason: "puppet" })),
    playerAssetCache: null, cameraOffset: { x: 0, y: 16 }, colliderChanges: [], companionConditionTypes: null,
  } });
  const snapshot = () => ({ actors: readNativeFieldActors(owner, null).actors.map((actor) => ({ ...actor,
    animation: actor.animation?.snapshot() ?? null })),
    assets: Object.values(owner).map((actor) => ({ id: actor.id, fieldAssetId: actor.native.fieldAssetId, charaZOffset: actor.native.charaZOffset })) });
  return { f, raw, keys, owner, host, step, snapshot, reads: () => reads };
}

test("asset refresh uses new animation duration/mode/flip and retains only source time/play", () => {
  const t = setup(), old = t.owner["-1001"]!.animation!;
  old.play("wave", true, 2); old.advance(1125);
  assert.deepEqual(old.snapshot(), { key: "wave", duration: 0.25, mode: 1, flip: false, elapsed: 0.875, loops: 1, playing: true });
  const media = t.f.characters.charlie!;
  media.animations.wave = { ...media.animations.wave!, duration: 0.75, mode: 0, flip: true };
  const next = replaceNativeFieldActorAnimation(old, media, "up", t.keys.assets.charlie!.keys);
  assert.deepEqual(next.snapshot(), { key: "wave", duration: 0.75, mode: 0, flip: true, elapsed: 0.875, loops: 0, playing: true });
  next.advance(0);
  assert.equal(next.playing, false); assert.equal(next.snapshot()!.elapsed, 0.75);
  assert.equal(old.playing, true); assert.equal(old.snapshot()!.elapsed, 0.875);
});

test("missing old key uses direction then Default at time zero without changing zero direction", () => {
  const t = setup(), old = t.owner["-1001"]!.animation!, media = t.f.characters.charlie!;
  old.play("wave", true, 1); old.advance(125); delete media.animations.wave;
  const keys = () => Object.keys(media.animations);
  assert.deepEqual(replaceNativeFieldActorAnimation(old, media, "right", keys()).snapshot(), {
    key: "WalkR", duration: 0.5, mode: 0, flip: false, elapsed: 0, playing: false, loops: 0,
  });
  delete media.animations.WalkR;
  assert.equal(replaceNativeFieldActorAnimation(old, media, "right", keys()).snapshot()!.key, "Default");
  assert.equal(replaceNativeFieldActorAnimation(old, media, null, keys()).snapshot()!.key, "Default");
  delete media.animations.Default;
  assert.throws(() => replaceNativeFieldActorAnimation(old, media, null, keys()), /fallback animation/);
});

test("new playingMode controls field progression independently of the copied old base-loop flag", () => {
  const t = setup(), old = t.owner["-1001"]!.animation!, media = t.f.characters.charlie!;
  old.play("wave", false, 1); old.advance(125);
  media.animations.wave!.mode = 1; media.animations.wave!.duration = 0.25;
  const next = replaceNativeFieldActorAnimation(old, media, "up", t.keys.assets.charlie!.keys);
  assert.equal(next.snapshot()!.mode, 1); assert.equal(next.snapshot()!.loops, 0);
  // Native old.isLoop=false is copied, but LastFieldEntity.UpdateAnim branches
  // on new playingMode, so this still takes its one-loop transition.
  next.advance(250);
  assert.equal(next.snapshot()!.loops, 1); assert.equal(next.snapshot()!.elapsed, 0.125); assert.equal(next.playing, true);
  old.stop(0.5);
  const stopped = replaceNativeFieldActorAnimation(old, media, "up", t.keys.assets.charlie!.keys);
  const before = stopped.snapshot(); stopped.advance(1000); assert.deepEqual(stopped.snapshot(), before);
});

test("a present but invalid old key blocks instead of silently falling back", () => {
  const t = setup(), old = t.owner["-1001"]!.animation!, media = t.f.characters.charlie!;
  old.play("wave", true, 1); media.animations.wave!.frames[0]!.sprite = "absent";
  assert.throws(() => replaceNativeFieldActorAnimation(old, media, "up", t.keys.assets.charlie!.keys), /Missing actor animation sprite/);
});

test("existing null-pose animation is initialized while an absent old instance remains unselected", () => {
  const t = setup(), hidden = t.owner["native:puppet:0"]!, empty = t.owner["native:party:0"]!;
  assert.equal(hidden.direction, null); assert.equal(hidden.animation!.snapshot(), null);
  assert.equal(empty.animation, null);
  const publication = prepareNativeFieldActorAppearance(t.host, [t.step([[hidden.id, 3], [empty.id, 3]])]);
  publication.validate(); publication.commit();
  assert.equal(hidden.animation!.snapshot()!.key, "Default"); assert.equal(hidden.animation!.snapshot()!.elapsed, 0);
  assert.equal(hidden.animation!.playing, false); assert.equal(hidden.direction, null); assert.equal(hidden.native.entity.visible, false);
  assert.equal(empty.animation!.snapshot(), null); assert.equal(empty.direction, null); assert.equal(empty.native.entity.visible, false);
});

test("the ordered batch keeps actor/native/entity/position/view identities and all unrelated fields", () => {
  const t = setup(), player = t.owner["-1001"]!, puppet = t.owner["native:puppet:0"]!;
  const before = t.snapshot(), entity = player.native.entity, position = entity.position, view = entity.viewBinding;
  const native = player.native, animation = player.animation, z = native.charaZOffset;
  t.f.partyCatalog.assets[3]!.shadowType = 0;
  const pending = prepareNativeFieldActorAppearance(t.host, [t.step([[player.id, 3], [puppet.id, 3]])]);
  assert.deepEqual(t.snapshot(), before);
  pending.validate(); const reads = t.reads(); pending.commit();
  assert.equal(t.reads(), reads, "commit does not query providers or an already committed owned roster");
  assert.equal(t.owner["-1001"], player); assert.equal(player.native, native); assert.equal(native.entity, entity);
  assert.equal(entity.position, position); assert.equal(entity.viewBinding, view); assert.equal(native.charaZOffset, z);
  assert.notEqual(player.animation, animation); assert.equal(player.asset, "charlie"); assert.equal(puppet.asset, "charlie");
  assert.equal(entity.shadowVisible, false); assert.equal(puppet.native.entity.shadowVisible, false);
  assert.deepEqual({ ...entity, animation: null, shadowVisible: true }, { ...before.actors[0], animation: null, shadowVisible: true });
  assert.throws(() => pending.commit(), /requires current validation/);
});

test("multiple plans read previous candidate media and animation, never the unchanged live owner", () => {
  const t = setup(), player = t.owner["-1001"]!;
  player.animation!.play("wave", true, 1); player.animation!.advance(125);
  delete t.f.characters.charlie!.animations.wave;
  t.keys.assets.charlie!.keys = t.keys.assets.charlie!.keys.filter((key) => key !== "wave");
  const pending = prepareNativeFieldActorAppearance(t.host, [t.step([[player.id, 3]]), t.step([[player.id, 2]])]);
  assert.equal(player.animation!.snapshot()!.key, "wave"); pending.validate(); pending.commit();
  assert.equal(player.asset, "bravo"); assert.equal(player.animation!.snapshot()!.key, "WalkB");
  assert.equal(player.animation!.snapshot()!.elapsed, 0); assert.equal(player.animation!.playing, false);
});

test("a failure in the last plan leaves all earlier actor/media changes unpublished", () => {
  const t = setup(), before = t.snapshot(), animation = t.owner["-1001"]!.animation;
  delete t.f.characters.alpha;
  assert.throws(() => prepareNativeFieldActorAppearance(t.host, [t.step([["-1001", 3]]), t.step([["native:puppet:0", 1]])]), /Missing native appearance media/);
  assert.deepEqual(t.snapshot(), before); assert.equal(t.owner["-1001"]!.animation, animation);
});

test("stale pose, playback, asset identity and actor replacement reject before publication", () => {
  for (const kind of ["position", "playback", "asset", "owner", "entity", "offset"] as const) {
    const t = setup(), pending = prepareNativeFieldActorAppearance(t.host, [t.step([["-1001", 3]])]);
    const p = t.owner["-1001"]!;
    if (kind === "position") p.x += 1;
    if (kind === "playback") p.animation!.play("wave", false, 1);
    if (kind === "asset") p.native.fieldAssetId = 1;
    if (kind === "owner") t.owner[p.id] = { ...p };
    if (kind === "entity") p.native.entity = { ...p.native.entity };
    if (kind === "offset") p.native.charaZOffset = 0;
    const changed = t.snapshot();
    assert.throws(() => pending.validate(), /Stale native appearance/); assert.deepEqual(t.snapshot(), changed);
    assert.throws(() => pending.commit(), /requires current validation/);
  }
});

test("changed source media and material providers cannot reuse a prepared candidate", () => {
  for (const kind of ["media-content", "media-identity", "view", "frozen"] as const) {
    const t = setup(), before = t.snapshot(), pending = prepareNativeFieldActorAppearance(t.host, [t.step([["-1001", 3]])]);
    if (kind === "media-content") t.f.characters.charlie!.animations.WalkB!.duration = 2;
    if (kind === "media-identity") t.f.characters.charlie = structuredClone(t.f.characters.charlie!);
    if (kind === "view") t.f.input.providers.mapRenderContext = "f".repeat(64);
    if (kind === "frozen") Object.freeze(t.owner["-1001"]!.native);
    assert.throws(() => pending.validate(), /Stale|material binding|writable/); assert.deepEqual(t.snapshot(), before);
  }
});

test("unbound asset metadata, riding and custom shadows retain explicit publication gates", () => {
  for (const kind of ["asset", "rider", "riding", "shadow"] as const) {
    const t = setup(), step = t.step([["-1001", 3]]), before = t.snapshot();
    if (kind === "asset") step.plan.changes[0]!.asset = { ...step.plan.changes[0]!.asset, asset: "alpha" };
    if (kind === "rider") step.plan.changes[0]!.mode = "rider";
    if (kind === "riding") step.media.mount = "armor";
    if (kind === "shadow") t.f.partyCatalog.assets[3]!.shadowType = 2;
    assert.throws(() => prepareNativeFieldActorAppearance(t.host, [step]), /Unbound|riding|shadow/);
    assert.deepEqual(t.snapshot(), before);
  }
});

test("caller edits cannot replace the captured batch intent and unvalidated commits fail", () => {
  const t = setup(), step = t.step([["-1001", 3]]), pending = prepareNativeFieldActorAppearance(t.host, [step]);
  step.plan.changes.length = 0;
  assert.throws(() => pending.commit(), /requires current validation/);
  pending.validate(); pending.commit(); assert.equal(t.owner["-1001"]!.asset, "charlie");
});

test("uncompiled source keys do not become absent keys or a successful direction fallback", () => {
  const t = setup(), player = t.owner["-1001"]!;
  player.animation!.play("wave", true, 1); delete t.f.characters.charlie!.animations.wave;
  const before = t.snapshot();
  assert.throws(() => prepareNativeFieldActorAppearance(t.host, [t.step([[player.id, 3]])]), /Uncompiled native appearance source animation: wave/);
  assert.deepEqual(t.snapshot(), before);
  delete t.f.characters.charlie!.animations.WalkB;
  t.keys.assets.charlie!.keys = t.keys.assets.charlie!.keys.filter((key) => key !== "wave");
  assert.throws(() => prepareNativeFieldActorAppearance(t.host, [t.step([[player.id, 3]])]), /Uncompiled native appearance source animation: WalkB/);
});

test("raw key compiler binds every source key independently of usable playback and rejects ambiguity", () => {
  const t = setup();
  assert.deepEqual(t.keys.assets.charlie!.keys, ["Default", "WalkB", "WalkL", "WalkR", "wave"]);
  const raw = structuredClone(t.raw);
  raw.charlie!.animation.data.animation.push({ name: "unsupported-pose" });
  const index = compileFieldNativeAnimationKeys(t.f.partyCatalog, raw);
  assert.ok(index.assets.charlie!.keys.includes("unsupported-pose"));
  assert.notEqual(index.assets.charlie!.contentHash, t.keys.assets.charlie!.contentHash);
  raw.charlie!.animation.data.animation.push({ name: "unsupported-pose" });
  assert.throws(() => compileFieldNativeAnimationKeys(t.f.partyCatalog, raw), /Ambiguous/);
  delete raw.charlie;
  assert.throws(() => compileFieldNativeAnimationKeys(t.f.partyCatalog, raw), /source object/);
});
