import test from "node:test";
import assert from "node:assert/strict";
import { appearanceFixture } from "./fixtures/battle-appearance.js";
import { createBattleAppearanceState, reconcileBattleAppearance, projectBattleAppearanceFrame,
  selectMagitekCharaSize, battleAppearanceQuads } from "../src/core/battle-appearance.js";

const frame = (key = "default", bodyFrame = 0, armorFrame = 0) => ({ key, bodyFrame, armorFrame });
test("source Magitek Start saves posture once, death/revival retains it, removal restores it", () => {
  const { actor, catalog, sprites } = appearanceFixture();
  const initial = createBattleAppearanceState(actor), before = structuredClone(initial);
  const started = reconcileBattleAppearance(catalog, actor, initial, [153]);
  assert.equal(started.nowCharaSize, 203); assert.equal(started.magitek?.backCharaSize, 3);
  const living = projectBattleAppearanceFrame(catalog, actor, started, frame(), sprites);
  const dead = reconcileBattleAppearance(catalog, actor, living.state, [105, 153]);
  const fallen = projectBattleAppearanceFrame(catalog, actor, dead, frame("down"), sprites);
  assert.equal(fallen.projection.body.sprite, actor.bodySprites.down);
  assert.equal(fallen.projection.armor?.sprite, catalog.armorSprites.mount);
  assert.deepEqual(fallen.projection.body.position, { x: 0, y: 20 });
  assert.equal(dead.magitek?.backCharaSize, 3);
  const revived = reconcileBattleAppearance(catalog, actor, fallen.state, [153]);
  assert.equal(revived.nowCharaSize, 203);
  const removed = reconcileBattleAppearance(catalog, actor, revived, []);
  assert.equal(removed.nowCharaSize, 3); assert.equal(removed.magitek, null);
  assert.deepEqual(removed.position, { x: 0, y: 0 });
  assert.deepEqual(projectBattleAppearanceFrame(catalog, actor, removed, frame(), sprites).projection.armor, null);
  assert.deepEqual(initial, before);
});
test("Start re-entry clears animation cache and restores source offsets after explicit removal", () => {
  const { actor, catalog, sprites } = appearanceFixture();
  let state = reconcileBattleAppearance(catalog, actor, createBattleAppearanceState(actor), [153]);
  state = projectBattleAppearanceFrame(catalog, actor, state, frame(), sprites).state;
  state = reconcileBattleAppearance(catalog, actor, state, []);
  state = reconcileBattleAppearance(catalog, actor, state, [153]);
  assert.equal(state.backSpriteIndex, -1); assert.equal(state.backAnimKey, "");
  assert.equal(projectBattleAppearanceFrame(catalog, actor, state, frame(), sprites).projection.body.textureOffset.y, .25);
});
test("body and armor use independent indices and short vector tables retain prior entries", () => {
  const { actor, catalog, sprites } = appearanceFixture();
  const start = reconcileBattleAppearance(catalog, actor, createBattleAppearanceState(actor), [153]);
  const first = projectBattleAppearanceFrame(catalog, actor, start, frame("move", 0, 1), sprites);
  const next = projectBattleAppearanceFrame(catalog, actor, first.state, frame("move", 1, 2), sprites);
  assert.equal(next.projection.body.sprite, actor.bodySprites.walk1);
  assert.equal(next.projection.armor?.sprite, catalog.armorSprites.mount2);
  assert.deepEqual(next.state.textureOffset, { x: .125, y: .25 });
  assert.deepEqual(next.state.position, { x: 3, y: 26 });
  const previous = structuredClone(next.state);
  assert.throws(() => projectBattleAppearanceFrame(catalog, actor, next.state, frame("move", 2, 0), sprites), /body frame/);
  assert.throws(() => projectBattleAppearanceFrame(catalog, actor, next.state, frame("move", 0, 4), sprites), /armor frame/);
  assert.deepEqual(next.state, previous);
});
test("missing media and unimplemented transforms are atomic blockers", () => {
  const { actor, catalog, sprites } = appearanceFixture();
  const start = reconcileBattleAppearance(catalog, actor, createBattleAppearanceState(actor), [153]);
  const before = structuredClone(start), broken = structuredClone(sprites);
  delete broken[catalog.armorSprites.mount!];
  assert.throws(() => projectBattleAppearanceFrame(catalog, actor, start, frame(), broken), /Missing.*media/);
  assert.throws(() => reconcileBattleAppearance(catalog, actor, start, [153, 181]), /transformed/);
  assert.throws(() => reconcileBattleAppearance(catalog, actor, start, [153, 153]), /Multiple/);
  assert.throws(() => reconcileBattleAppearance(catalog, actor, start, [999]), /Unknown/);
  assert.deepEqual(start, before);
});
test("complete active-607 posture selection distinguishes source Mog and Kappa providers", () => {
  const rules = appearanceFixture().catalog.sizeRules;
  assert.equal(selectMagitekCharaSize(rules, 2, [607]), 202);
  assert.equal(selectMagitekCharaSize(rules, 2, [607, 681]), 211);
  assert.equal(selectMagitekCharaSize({ ...rules, mog: 0 }, 2, [607, 681]), 202);
  assert.equal(selectMagitekCharaSize(rules, 2, [607, 601]), 250);
  assert.equal(selectMagitekCharaSize(rules, 2, [607, 601, 681]), 250);
});
test("right source aliases select different media without a second implicit mirror", () => {
  const { actor, catalog, sprites } = appearanceFixture();
  const start = reconcileBattleAppearance(catalog, actor, createBattleAppearanceState(actor), [153]);
  const { projection } = projectBattleAppearanceFrame(catalog, actor, start, frame("right"), sprites);
  assert.equal(projection.body.sprite, actor.bodySprites.right);
  assert.equal(projection.armor?.sprite, catalog.armorSprites.mountRight);
  assert.equal(projection.orientation, "source-alias");
});
test("UV offset clips source feet and moves the sampled body within the mesh, preserving Clamp edges", () => {
  const quads = battleAppearanceQuads({ sprite: "synthetic", width: 32, height: 32,
    position: { x: 0, y: 24 }, textureOffset: { x: 0, y: .25 } });
  assert.deepEqual(quads, [
    { source: { x: 0, y: 0, width: 32, height: 1 }, destination: { x: -16, y: -56, width: 32, height: 8 } },
    { source: { x: 0, y: 0, width: 32, height: 24 }, destination: { x: -16, y: -48, width: 32, height: 24 } },
  ]);
  const ordinary = battleAppearanceQuads({ sprite: "synthetic", width: 32, height: 32,
    position: { x: 0, y: 0 }, textureOffset: { x: 0, y: 0 } });
  assert.deepEqual(ordinary, [{ source: { x: 0, y: 0, width: 32, height: 32 },
    destination: { x: -16, y: -32, width: 32, height: 32 } }]);
});
