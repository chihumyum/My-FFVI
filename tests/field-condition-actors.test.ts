import test from "node:test";
import assert from "node:assert/strict";
import { compileFieldNativeAnimationKeys } from "../src/compiler/field-native-appearance.js";
import { createFieldActorFactoryCandidate, fieldPuppetContextFromActors } from "../src/core/field-actor-factory.js";
import { prepareFieldConditionActors, type FieldConditionActorsHost } from "../src/core/field-condition-actors.js";
import { createNativeFieldActorProjections, readNativeFieldActors, type NativeFieldActor } from "../src/core/field-native-actors.js";
import { FieldPartyActors } from "../src/core/field-party-actors.js";
import { startFieldActorVisibility, tickFieldActorVisibility,
  type FieldActorVisibilityState } from "../src/core/field-actor-visibility.js";
import type { FieldPuppetActorCatalog } from "../src/core/field-puppet-actors.js";
import type { OwnedConditionAppearanceStep } from "../src/core/owned-condition.js";
import { fieldActorFactoryFixture } from "./fixtures/field-actor-factory.js";

const writeVisibility = (target: FieldActorVisibilityState, value: FieldActorVisibilityState) => {
  Object.assign(target, { visible: value.visible, fadeAlpha: value.fadeAlpha, visibilityFade: value.visibilityFade ?? null });
};

function setup() {
  const f = fieldActorFactoryFixture(), candidate = createFieldActorFactoryCandidate(f.input);
  const owner: Record<string, NativeFieldActor> = Object.fromEntries(
    createNativeFieldActorProjections(candidate, f.map.mapRange, f.partyCatalog).map(actor => [actor.id, actor]));
  // Controlled state after ordinary source initialization: characteristics
  // selects the resident Corps puppet, rather than the player representation.
  owner["native:puppet:0"]!.native.entity.visible = true;
  const party = new FieldPartyActors(f.partyCatalog, f.entry.checkpoint, 1);
  const puppetCatalog: FieldPuppetActorCatalog = { kind: "field-puppet-actors-v1", memberCount: 4,
    characteristics: true, corpsOrder: [0, 1, 2, 3], residents: [], conditionChanges: [], miscHash: "b".repeat(64) };
  const roster = { owned: [{ ownedId: 17, sourceId: 2, enabled: true, conditionTypes: [] as number[] }],
    party: [17, 0, 0, 0] as [number, number, number, number] };
  const raw = Object.fromEntries(Object.entries(f.characters).map(([name, c]) => [name,
    { animation: { source: c.source, data: { animation: Object.keys(c.animations).map(name => ({ name })) } } }]));
  const keys = compileFieldNativeAnimationKeys(f.partyCatalog, raw);
  let reads = 0;
  const host: FieldConditionActorsHost = {
    keepBadStatusVisual: true,
    readActors: () => { reads++; return owner; }, readPartyActors: () => { reads++; return party; },
    readCatalog: () => { reads++; return f.partyCatalog; },
    readPuppetContext: () => { reads++; return { catalog: puppetCatalog, context: fieldPuppetContextFromActors({
      catalog: puppetCatalog, checkpoint: party.checkpoint(), bindings: candidate.bindings,
      snapshot: readNativeFieldActors(owner, candidate.snapshot.camera), ...roster,
      entities: [], restorePartyInstruction: "absent" }) }; },
    readBindings: () => { reads++; return candidate.bindings; }, readMapRange: () => { reads++; return f.map.mapRange; },
    readCharacters: () => { reads++; return f.characters; }, readAnimationKeys: () => { reads++; return keys; },
    readProviders: () => { reads++; return f.input.providers; },
    readCamera: () => { reads++; return candidate.snapshot.camera; }, readCameraOffset: () => { reads++; return { x: 0, y: 0 }; },
    readActiveAndEnabled: (_, entity) => { reads++; return entity.visible; }, transportationId: 1,
  };
  const step = (): OwnedConditionAppearanceStep => ({ targetId: f.party.activeMembers[0]!.id,
    appearance: structuredClone(f.party), setDummy: false, affectLeader: true, puppetRoster: structuredClone(roster) });
  const snapshot = () => ({ party: party.checkpoint(), actors: readNativeFieldActors(owner, candidate.snapshot.camera).actors
    .map(actor => ({ ...actor, animation: actor.animation?.snapshot() ?? null })),
    assets: Object.values(owner).map(actor => actor.native.fieldAssetId) });
  return { f, candidate, owner, party, puppetCatalog, roster, host, step, snapshot, reads: () => reads };
}

test("same leader captures before refresh, observes refreshed activity, and still Hide/Show/Cues", () => {
  const t = setup(), player = t.owner["native:puppet:0"]!, old = player.animation!;
  old.play("wave", true, 1); old.advance(125);
  t.f.characters.bravo!.animations.wave!.next = "WalkL";
  let observations = 0;
  t.host.readActiveAndEnabled = (id, draft) => {
    observations++; assert.equal(id, player.id); assert.equal(player.animation, old);
    assert.notEqual(draft.animation, old, "activity follows private Refresh");
    assert.equal(draft.animation!.snapshot()!.elapsed, .125);
    return true;
  };
  const initial = t.snapshot(), pending = prepareFieldConditionActors(t.host, [t.step()]);
  assert.deepEqual(t.snapshot(), initial); assert.equal(observations, 1);
  assert.deepEqual(pending.audit.map(row => [row.beforeActor, row.afterActor, row.result]), [[player.id, player.id, "transfer"]]);
  assert.equal(pending.audit[0]!.effects.length, 5);
  pending.validate(); const reads = t.reads(); pending.commit();
  assert.equal(t.reads(), reads, "commit cannot re-read now-replaced owned/provider state");
  assert.equal(player.animation!.snapshot()!.key, "WalkL");
  assert.equal(player.animation!.snapshot()!.elapsed, .5, "native Cue(-1) selects the duration endpoint");
  assert.equal(player.native.entity.visible, true); assert.equal(player.native.entity.fadeAlpha, 1);
  assert.throws(() => pending.commit(), /requires current validation/);
});

test("each target carries prior cue into the next Refresh instead of flattening refreshes first", () => {
  const t = setup(), player = t.owner["native:puppet:0"]!;
  player.animation!.play("wave", true, 1);
  t.f.characters.bravo!.animations.wave!.next = "WalkL";
  t.f.characters.bravo!.animations.WalkL!.next = "WalkR";
  const pending = prepareFieldConditionActors(t.host, [t.step(), t.step()]);
  pending.validate(); pending.commit();
  assert.equal(player.animation!.snapshot()!.key, "WalkR");
  assert.equal(pending.audit.length, 2);
});

test("flag-disabled path still resolves old alias and refreshes but never queries activity", () => {
  const t = setup(), player = t.owner["-1001"]!;
  t.host.keepBadStatusVisual = false;
  t.host.readActiveAndEnabled = () => { throw new Error("must not observe disabled activity"); };
  player.animation!.play("wave", true, 1); player.animation!.advance(125);
  const pending = prepareFieldConditionActors(t.host, [t.step()]);
  assert.equal(pending.audit[0]!.result, "flag-disabled");
  pending.validate(); pending.commit(); assert.equal(player.animation!.snapshot()!.elapsed, .125);
  const bad = setup(); bad.host.keepBadStatusVisual = false; bad.roster.party[0] = 0;
  assert.throws(() => prepareFieldConditionActors(bad.host, [bad.step()]), /occupied Corps/);
});

test("inactive captured old actor short circuits after refresh without resolving unknown next stand-in", () => {
  const t = setup(), step = t.step();
  // Source-proven absence of 665/666 behavior is not fabricated. The early
  // return is legitimate only when the captured old instance is inactive.
  t.puppetCatalog.conditionChanges = [{ type: 665, residentCharacterId: 202 }];
  step.puppetRoster!.owned[0]!.conditionTypes = [665];
  t.host.readActiveAndEnabled = () => false;
  const pending = prepareFieldConditionActors(t.host, [step]);
  assert.equal(pending.audit[0]!.result, "previous-inactive"); assert.equal(pending.audit[0]!.afterActor, null);
  pending.validate(); pending.commit();
});

test("unknown activity or missing provider never inherits source eligibility from visible", () => {
  for (const missing of [false, true]) {
    const t = setup(), before = t.snapshot();
    if (missing) delete t.host.readActiveAndEnabled; else t.host.readActiveAndEnabled = () => "unknown";
    assert.throws(() => prepareFieldConditionActors(t.host, [t.step()]), /activity provider|active\/enabled provider/);
    assert.deepEqual(t.snapshot(), before);
  }
});

test("active post-refresh stand-ins remain explicit gates and do not publish the earlier refresh", () => {
  const t = setup(), step = t.step(), before = t.snapshot();
  t.puppetCatalog.conditionChanges = [{ type: 665, residentCharacterId: 202 }];
  step.puppetRoster!.owned[0]!.conditionTypes = [665];
  assert.throws(() => prepareFieldConditionActors(t.host, [step]), /condition.*stand-in|condition.*host|stand-in/i);
  assert.deepEqual(t.snapshot(), before);
});

test("a last-target media failure preserves all owners and allows a clean retry", () => {
  const t = setup(), first = t.step(), last = t.step(), before = t.snapshot();
  last.appearance.activeMembers[0]!.sourceId = 99999;
  assert.throws(() => prepareFieldConditionActors(t.host, [first, last]), /appearance|asset/i);
  assert.deepEqual(t.snapshot(), before);
  const retry = prepareFieldConditionActors(t.host, [first, t.step()]); retry.validate(); retry.commit();
  assert.equal(retry.audit.length, 2);
});

test("last activity/provider rejection invalidates both owner writes before commit", () => {
  const t = setup(), before = t.snapshot(); let fail = false;
  t.host.readActiveAndEnabled = () => { if (fail) throw new Error("activity provider rejected"); return true; };
  const pending = prepareFieldConditionActors(t.host, [t.step()]); fail = true;
  assert.throws(() => pending.validate(), /activity provider rejected/);
  assert.throws(() => pending.commit(), /requires current validation/); assert.deepEqual(t.snapshot(), before);
  fail = false; pending.validate(); pending.commit();
});

test("same-value actor replacement, party revision, media and source-context drift reject", () => {
  for (const kind of ["actor", "party", "media", "context", "activity"] as const) {
    const t = setup(), pending = prepareFieldConditionActors(t.host, [t.step()]);
    if (kind === "actor") t.owner["-1001"] = { ...t.owner["-1001"]! };
    if (kind === "party") t.party.restore(t.party.checkpoint());
    if (kind === "media") t.f.characters.bravo = structuredClone(t.f.characters.bravo!);
    if (kind === "context") t.roster.owned[0]!.conditionTypes.push(5);
    if (kind === "activity") t.host.readActiveAndEnabled = () => true;
    const changed = t.snapshot();
    assert.throws(() => pending.validate(), /Stale/);
    assert.throws(() => pending.commit(), /requires current validation/); assert.deepEqual(t.snapshot(), changed);
  }
});

test("provider mutation during final validation cannot install a prepared actor/party batch", () => {
  const t = setup(); let mutate = false;
  t.host.readActiveAndEnabled = () => {
    if (mutate) { mutate = false; t.owner["-1001"]!.native.entity.position.x += 1; }
    return true;
  };
  const pending = prepareFieldConditionActors(t.host, [t.step()]), beforeParty = t.party.checkpoint(); mutate = true;
  assert.throws(() => pending.validate(), /Stale/);
  assert.throws(() => pending.commit(), /requires current validation/); assert.deepEqual(t.party.checkpoint(), beforeParty);
});

test("caller edits cannot replace the captured whole batch, no unvalidated commit is accepted", () => {
  const t = setup(), step = t.step(), pending = prepareFieldConditionActors(t.host, [step]);
  step.puppetRoster!.party[0] = 0; step.appearance.activeMembers.length = 0;
  assert.throws(() => pending.commit(), /requires current validation/);
  pending.validate(); pending.commit(); assert.equal(pending.audit[0]!.result, "transfer");
});

test("post-target roster inventory changes and missing exact context cannot be silently invented", () => {
  const t = setup(), step = t.step(), before = t.snapshot();
  delete step.puppetRoster;
  assert.throws(() => prepareFieldConditionActors(t.host, [step]), /exact post-target puppet roster/);
  const changed = t.step(); changed.puppetRoster!.owned[0]!.enabled = false;
  assert.throws(() => prepareFieldConditionActors(t.host, [changed]), /owned identities/);
  assert.deepEqual(t.snapshot(), before);
});

test("a refreshed leader alias transfers the previously captured instance without Look/material refresh", () => {
  const t = setup(), old = t.owner["native:puppet:0"]!, next = t.owner["native:puppet:1"]!;
  t.roster.owned.push({ ownedId: 18, sourceId: 3, enabled: true, conditionTypes: [] }); t.roster.party[1] = 18;
  old.native.entity.position = { x: 12, y: 34, z: 56 };
  old.native.entity.direction = "left"; old.native.entity.layer = 9;
  old.native.entity.viewBinding = { map: t.f.input.providers.mapRenderContext, layer: 9,
    properties: t.f.input.providers.applyViewProperties(9)! };
  old.animation!.play("wave", true, 1);
  next.native.entity.direction = "right";
  const targetView = structuredClone(next.native.entity.viewBinding);
  // Explicit candidate exercises the ordinary existing saved-leader planner:
  // the caller, rather than this actor helper, owns eligibility/party selection.
  const step = t.step(), member = { ...step.appearance.activeMembers[0]!, id: "controlled-second", index: 1 as const,
    sourceId: 3, jobId: 7 };
  step.appearance.activeMembers = [member]; step.appearance.parties[0] = [member];
  const pending = prepareFieldConditionActors(t.host, [step]);
  assert.equal(pending.audit[0]!.beforeActor, old.id); assert.equal(pending.audit[0]!.afterActor, next.id);
  pending.validate(); pending.commit();
  assert.equal(old.native.entity.visible, false); assert.equal(next.native.entity.visible, true);
  assert.deepEqual(next.native.entity.position, { x: 12, y: 34, z: 56 }); assert.equal(next.native.entity.layer, 9);
  assert.equal(next.native.entity.direction, "right"); assert.deepEqual(next.native.entity.viewBinding, targetView);
  assert.equal(next.animation!.snapshot()!.key, "wave");
});

test("true same-instance Affect cancels an existing fade while preserving the timer-captured entity", () => {
  const t = setup(), actor = t.owner["native:puppet:0"]!, entity = actor.native.entity;
  writeVisibility(entity, tickFieldActorVisibility(startFieldActorVisibility(entity, false, 2, 10), 10.5));
  assert.equal(entity.fadeAlpha, .75); assert.ok(entity.visibilityFade);
  actor.animation!.play("wave", true, 1);
  const pending = prepareFieldConditionActors(t.host, [t.step()]);
  assert.ok(entity.visibilityFade, "prepare cannot consume the live fade");
  pending.validate(); pending.commit();
  assert.equal(actor.native.entity, entity, "existing delayed callbacks keep their original instance");
  assert.equal(entity.visibilityFade, null); assert.equal(entity.fadeAlpha, 1); assert.equal(entity.visible, true);
});

test("flag-disabled refresh retains the existing fade and original native/entity identity", () => {
  const t = setup(), actor = t.owner["native:puppet:0"]!, native = actor.native, entity = native.entity;
  writeVisibility(entity, tickFieldActorVisibility(startFieldActorVisibility(entity, false, 2, 10), 10.5));
  const fade = structuredClone(entity.visibilityFade), alpha = entity.fadeAlpha;
  t.host.keepBadStatusVisual = false;
  const pending = prepareFieldConditionActors(t.host, [t.step()]); pending.validate(); pending.commit();
  assert.equal(actor.native, native); assert.equal(actor.native.entity, entity);
  assert.deepEqual(entity.visibilityFade, fade); assert.equal(entity.fadeAlpha, alpha); assert.equal(entity.visible, true);
});

test("an external actor fade tick invalidates the prepared condition transaction", () => {
  const t = setup(), actor = t.owner["native:puppet:0"]!, entity = actor.native.entity;
  writeVisibility(entity, startFieldActorVisibility(entity, false, 2, 10));
  const pending = prepareFieldConditionActors(t.host, [t.step()]), beforeParty = t.party.checkpoint();
  writeVisibility(entity, tickFieldActorVisibility(entity, 10.5)); const changed = t.snapshot();
  assert.throws(() => pending.validate(), /Stale/); assert.throws(() => pending.commit(), /requires current validation/);
  assert.deepEqual(t.snapshot(), changed); assert.deepEqual(t.party.checkpoint(), beforeParty);
});

test("read-only activity cannot add actor writes or same-value identity replacement to the draft", () => {
  for (const kind of ["position", "playback", "same-pose-object", "same-animation-object"] as const) {
    const t = setup(), before = t.snapshot();
    t.host.readActiveAndEnabled = (_, readonlyEntity) => {
      const entity = readonlyEntity as typeof t.owner[string]["native"]["entity"];
      if (kind === "position") entity.position.x += 1;
      if (kind === "playback") entity.animation!.play("wave", true, 1);
      if (kind === "same-pose-object") entity.position = { ...entity.position };
      if (kind === "same-animation-object") entity.animation = entity.animation!.clone();
      return true;
    };
    assert.throws(() => prepareFieldConditionActors(t.host, [t.step()]), /observation mutated its actor draft/);
    assert.deepEqual(t.snapshot(), before);
  }
});
