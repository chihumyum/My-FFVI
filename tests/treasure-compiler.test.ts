import test from "node:test";
import assert from "node:assert/strict";
import { compileEntityGroup } from "../src/compiler/entity-group.js";
import { decodeFieldOp } from "../src/compiler/field.js";
import { treasureEntityAsset, treasureInstruction, treasureSource, treasureTables } from "./fixtures/treasure-inventory.js";

test("treasure entities preserve collision and source reward while ordinary interaction is a stopped action", () => {
  for (const collision of [true, false]) {
    const group = compileEntityGroup("chests", treasureEntityAsset({ collision }), treasureTables());
    assert.deepEqual(group.blockers, []);
    const entity = group.entities[0]!;
    assert.equal(entity.id, "42");
    assert.equal(entity.kind, 7);
    assert.equal(entity.x, 2); assert.equal(entity.y, 2);
    assert.equal(entity.mapObject!.collision, collision);
    assert.deepEqual(entity.mapObject!.talkMounts, ["", "synthetic-armor"]);
    assert.equal(entity.mapObject!.acceptDirection, 15);
    assert.equal(entity.mapObject!.interaction.kind, "blocked");
    assert.equal(entity.treasure!.entityId, 42);
    assert.equal(entity.treasure!.presentation.soundId, 909);
    assert.deepEqual(entity.treasure!.reward, { kind: "grant-item", id: 101, count: 1 });
    assert.equal(entity.source.objectId, "9223372036854775806");
    assert.equal(entity.source.pointer, "/layers/0/objects/0");
  }
});

test("anonymous native treasures retain entityId zero without inventing a targetable native identity", () => {
  const group = compileEntityGroup("chests", treasureEntityAsset({ entity_id: 0 }), treasureTables());
  assert.deepEqual(group.blockers, []);
  assert.equal(group.entities[0]!.id, "chests:0:0");
  assert.equal(group.entities[0]!.treasure!.entityId, 0);
  const op = decodeFieldOp(treasureInstruction([0, 0, 1]), { script: "open", index: 0, source: treasureSource }, {});
  assert.equal(op.kind, "blocked");
});

test("unrecovered treasure geometry, trigger conditions and reward dependencies retain group blockers", () => {
  for (const [properties, geometry] of [
    [{ asset_id: 3 }, {}], [{ birdview_puppet: true }, {}], [{ gimmick: true }, {}],
    [{ target_transportation_ids: "6" }, {}], [{ collision: undefined }, {}],
    [{ content_id: 901 }, {}], [{ content_num: 100 }, {}], [{ talk_target_transportation_ids: "99" }, {}],
    [{}, { width: 32 }], [{}, { x: 33 }], [{}, { visible: false }], [{}, { gid: 0 }],
  ] as const) {
    const group = compileEntityGroup("chests", treasureEntityAsset(properties, geometry), treasureTables());
    assert.ok(group.blockers.length > 0, JSON.stringify({ properties, geometry }));
    assert.equal(group.blockers[0]!.source.pointer, "/layers/0/objects/0");
  }
});

test("field VM compiler admits only the exact silent after path and retains a source-addressed message stop", () => {
  const site = { script: "open", index: 4, source: { ...treasureSource, pointer: "/Mnemonics/4" } };
  assert.deepEqual(decodeFieldOp(treasureInstruction([42, 97, 1]), site, {}), {
    ...site, kind: "treasure-box", entityId: 42, after: true, message: false, actionSoundId: 0,
  });
  for (const value of [0, 2, -1]) {
    const blocked = decodeFieldOp(treasureInstruction([42, 0, value]), site, {});
    assert.equal(blocked.kind, "blocked");
    if (blocked.kind !== "blocked") throw new Error("Expected message blocker");
    assert.match(blocked.reason, /message tasks/);
    assert.equal(blocked.source.pointer, "/Mnemonics/4");
  }
  const unsupported = treasureInstruction([42, 0, 1]); unsupported.type = 2;
  assert.equal(decodeFieldOp(unsupported, site, {}).kind, "blocked");
});
