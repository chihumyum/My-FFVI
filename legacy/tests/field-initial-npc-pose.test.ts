import test from "node:test";
import assert from "node:assert/strict";
import { compileFieldEntityPoseBlockers } from "../src/compiler/field-initial-npc-pose.js";
import { compileFieldNativeNpc } from "../src/compiler/field-native-npc.js";
import { missingFieldNpcInitialPoses, missingFieldPoses } from "../src/core/character-media.js";
import { prepareFieldNativeNpcGroup } from "../src/core/field-native-npc.js";
import type { FieldEntity } from "../src/field/types.js";
import { fieldActorFactoryFixture } from "./fixtures/field-actor-factory.js";

function fixture() {
  const f = fieldActorFactoryFixture(), asset = Object.keys(f.characters)[0]!, characters = structuredClone(f.characters);
  const original = characters[asset]!, pose = structuredClone(original.animations.WalkB!);
  characters[asset] = { ...original, animations: { WalkB: { ...pose, next: "" } } };
  const source = { file: "synthetic.bundle", assetPath: "Room/entity_default.json", pointer: "/layers/0/objects/0" };
  const compiled = compileFieldNativeNpc({ group: "entity_default", object: { x: 48, y: 80, width: 16, height: 16 },
    entity: { id: "71", kind: 6, layer: 1, source }, properties: { entity_id: 71, asset_id: 11,
      direction: 1, move_type: 0, turn_around: true }, tables: { "mapobject.csv": [{ id: 11, asset_name: asset, shadow_type: 1 }] } });
  assert.ok(compiled.definition); assert.deepEqual(compiled.blockers, []);
  const entity: FieldEntity = { id: "71", kind: 6, x: 3, y: 4, width: 1, height: 1, layer: 1, direction: "up", asset,
    source, script: null, collision: 1, destinationLayer: null, nativeNpc: compiled.definition };
  const prepare = { definitions: [compiled.definition], factory: f.factory, characters, mapRange: f.map.mapRange,
    providers: f.input.providers, existingActorIds: ["-1001"] };
  return { ...f, asset, characters, entity, prepare, definition: compiled.definition };
}

test("a source Wait NPC with only its initial direction uses its real pose while party four-direction qualification stays strict", () => {
  const f = fixture(), before = structuredClone(f.characters);
  assert.deepEqual(compileFieldEntityPoseBlockers([f.entity], f.characters), []);
  assert.deepEqual(compileFieldEntityPoseBlockers([f.entity], f.characters, "legacy-four-directions-v1").map(b => b.reason),
    ["Default", "WalkL", "WalkR"].map(key => `Missing character pose ${f.asset}/${key}`));
  const actor = prepareFieldNativeNpcGroup(f.prepare).actors[0]!;
  assert.equal(actor.entity.animation!.snapshot()!.key, "WalkB"); assert.equal(actor.entity.animation!.playing, false);
  assert.deepEqual(missingFieldPoses(f.characters[f.asset]), ["Default", "WalkL", "WalkR"]);
  assert.deepEqual(f.characters, before, "An NPC contract cannot insert aliases into the shared media");
});

test("the entire authored next chain is required and the second stopped source Look really selects the authored next pose", () => {
  const f = fixture(), c = f.characters[f.asset]!, base = c.animations.WalkB!;
  c.animations.WalkB = { ...base, next: "WalkB-S" };
  c.animations["WalkB-S"] = { ...base, next: "WalkB-tail" };
  assert.deepEqual(missingFieldNpcInitialPoses(c, "up"), ["WalkB-tail"]);
  assert.throws(() => prepareFieldNativeNpcGroup(f.prepare), /Missing actor animation WalkB-tail/);
  c.animations["WalkB-tail"] = { ...base, next: "WalkB" };
  assert.deepEqual(compileFieldEntityPoseBlockers([f.entity], f.characters), []);
  const actor = prepareFieldNativeNpcGroup(f.prepare).actors[0]!;
  assert.equal(actor.entity.animation!.snapshot()!.key, "WalkB-S"); assert.equal(actor.entity.animation!.playing, false);
  c.sprites.unused = structuredClone(Object.values(c.sprites)[0]!);
  delete c.sprites[c.animations["WalkB-tail"]!.frames[0]!.sprite];
  assert.deepEqual(missingFieldNpcInitialPoses(c, "up"), ["WalkB", "WalkB-S", "WalkB-tail"]);
  assert.throws(() => prepareFieldNativeNpcGroup(f.prepare), /Missing actor animation sprite/);
});

test("an absent initial pose remains a real failure and a later NPC cannot partially publish its valid predecessor", () => {
  const f = fixture(), prior = prepareFieldNativeNpcGroup(f.prepare).actors[0]!, animation = prior.entity.animation!.snapshot(),
    invalid = { ...f.definition, entityId: "72", sourceEntityId: 72, sourceDirection: 8 as const, direction: "left" as const };
  assert.deepEqual(missingFieldNpcInitialPoses(f.characters[f.asset], "left"), ["WalkL"]);
  assert.throws(() => prepareFieldNativeNpcGroup({ ...f.prepare, definitions: [f.definition, invalid] }), /Missing actor animation WalkL/);
  assert.deepEqual(prior.entity.animation!.snapshot(), animation); assert.equal(prior.entity.id, "71");
  const blocked = compileFieldEntityPoseBlockers([{ ...f.entity, direction: "left" }], f.characters);
  assert.equal(blocked[0]!.reason, `Missing character pose ${f.asset}/WalkL`); assert.equal(blocked[0]!.source, f.entity.source);
});

test("invalid source duration and playback modes cannot acquire a ready group through the narrower initial-key contract", () => {
  for (const invalid of [{ duration: 0 }, { mode: 2 }, { duration: Number.MAX_VALUE }]) {
    const f = fixture(), c = f.characters[f.asset]!;
    Object.assign(c.animations.WalkB!, invalid);
    const blockers = compileFieldEntityPoseBlockers([f.entity], f.characters);
    assert.equal(blockers.length, 1); assert.match(blockers[0]!.reason, /Invalid NPC initial pose/);
    assert.throws(() => prepareFieldNativeNpcGroup(f.prepare), /actor animation/);
  }
});

test("kind10 and other entity contracts do not inherit the NPC initialization rule or authorize another controller", () => {
  const f = fixture(), animated = { ...f.entity, kind: 10 }, other = { ...f.entity, kind: 2 };
  assert.deepEqual(compileFieldEntityPoseBlockers([animated], f.characters).map(b => b.reason), [`Missing character pose ${f.asset}/Default`]);
  assert.equal(compileFieldEntityPoseBlockers([other], f.characters).length, 3);
  assert.throws(() => compileFieldEntityPoseBlockers([f.entity], f.characters, "guessed-policy" as never), /Unknown/);
  const result = compileFieldNativeNpc({ group: "entity_default", object: { x: 48, y: 80, width: 16, height: 16 },
    entity: f.entity, properties: { entity_id: 71, asset_id: 11, direction: 1, move_type: 1 },
    tables: { "mapobject.csv": [{ id: 11, asset_name: f.asset, shadow_type: 1 }] } });
  assert.equal(result.definition, null); assert.match(result.blockers.join(), /autonomous/);
});
