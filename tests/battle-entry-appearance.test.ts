import assert from "node:assert/strict";
import test from "node:test";
import { BattleGame } from "../src/core/battle.js";
import { battleEntryAppearanceFixture } from "./fixtures/battle-entry-runtime.js";
import { recoveryItemFixture } from "./fixtures/items.js";

const pose = (key = "default") => ({ key, bodyFrame: 0, armorFrame: 0 });

test("Magitek entry prepares source size and all host media before admitting a battle", () => {
  const { content, inventory } = battleEntryAppearanceFixture();
  const before = structuredClone(content);
  const battle = new BattleGame(content, 61, undefined, inventory);
  assert.deepEqual(battle.players[0]!.appearanceState!.magitek, { conditionId: 53, backCharaSize: 1 });
  assert.equal(battle.players[0]!.appearanceState!.nowCharaSize, 11);
  const projection = battle.appearanceFrame("a", pose())!;
  assert.equal(projection.body.sprite, "a:Idle_00");
  assert.equal(projection.armor!.sprite, "armor");
  assert.deepEqual(projection.body.position, { x: 0, y: 12 });
  assert.deepEqual(content, before);
  delete content.sprites["b:Down_00"];
  assert.throws(() => new BattleGame(content, 61, undefined, inventory), /Missing battle appearance media/);
});

test("both right-facing host poses preflight every actor and armor before battle entry", () => {
  for (const missing of ["b:IdleR_00", "a:DyingR_00", "armor-right"]) {
    const { content, inventory } = battleEntryAppearanceFixture();
    delete content.sprites[missing];
    assert.throws(() => new BattleGame(content, 61, undefined, inventory), /Missing battle appearance media/);
  }
});

test("607 is rejected when its behavior lacks an appearance actor or catalog", () => {
  const { content, inventory } = battleEntryAppearanceFixture();
  delete content.players[1]!.appearance;
  assert.throws(() => new BattleGame(content, 61, undefined, inventory), /Missing source battle appearance/);
  const other = battleEntryAppearanceFixture();
  delete other.content.battleAppearance;
  assert.throws(() => new BattleGame(other.content, 61, undefined, other.inventory), /Missing source battle appearance/);
});

test("death and revival retain armor backup; explicit source-condition removal dismounts once", () => {
  const { content, inventory } = battleEntryAppearanceFixture();
  inventory.definitions[10001] = recoveryItemFixture(10001, [305], true);
  inventory.definitions[10005] = recoveryItemFixture(10005, [53]);
  inventory.stacks.push({ id: 10005, count: 1 });
  const battle = new BattleGame(content, 61, undefined, inventory);
  battle.appearanceFrame("a", pose());
  battle.players[0]!.hp = 0;
  battle.advance(10);
  assert.ok(battle.players[0]!.conditionIds.includes(53));
  assert.ok(battle.players[0]!.conditionIds.includes(305));
  assert.equal(battle.appearanceFrame("a", pose("down"))!.armor!.sprite, "armor");
  assert.equal(battle.players[0]!.appearanceState!.magitek!.backCharaSize, 1);
  assert.equal(battle.commandItem("b", 10001, { kind: "single", id: "a" }, 3), true);
  battle.advance(910);
  assert.ok(battle.players[0]!.hp > 0);
  assert.ok(battle.players[0]!.conditionIds.includes(53));
  assert.equal(battle.players[0]!.appearanceState!.magitek!.backCharaSize, 1);
  battle.players[0]!.atb = 100;
  assert.equal(battle.commandItem("a", 10005, { kind: "single", id: "a" }, 3), true);
  battle.advance(410);
  assert.equal(battle.players[0]!.conditionIds.includes(53), false);
  assert.equal(battle.players[0]!.appearanceState!.magitek, null);
  assert.equal(battle.players[0]!.appearanceState!.nowCharaSize, 1);
  const normal = battle.appearanceFrame("a", pose())!;
  assert.equal(normal.armor, null);
  assert.deepEqual(normal.body.textureOffset, { x: 0, y: 0 });
  assert.deepEqual(normal.body.position, { x: 0, y: 0 });
  assert.equal(battle.commandMenu("a").find((c) => c.id === 26), undefined);
  assert.equal(battle.commandMenu("a").find((c) => c.id === 1)!.available, true);
});

test("a later actor appearance failure rolls back effects, resource cost and earlier appearance candidates", () => {
  const { content, inventory } = battleEntryAppearanceFixture(false);
  delete content.players[1]!.appearance;
  const ability = content.abilities[10]!;
  ability.plan!.effects = [{ slot: 1, kind: "add-condition", conditionId: 53, fixedHit: true, accuracy: 100 }];
  ability.plan!.targeting = { ...ability.plan!.targeting, relation: "ally", modes: ["side"], defaultMode: "side" };
  const battle = new BattleGame(content, 61, undefined, inventory);
  assert.equal(battle.command("a", 10, { kind: "side", side: "player" }, 7), true);
  battle.advance(400);
  const before = structuredClone(battle.combatants), time = battle.time;
  assert.throws(() => battle.advance(10), /Missing source battle appearance/);
  assert.deepEqual(battle.combatants, before);
  assert.equal(battle.time, time);
  assert.equal(battle.action!.resolved, false);
});

test("failed frame projection cannot corrupt the renderer pose cache", () => {
  const { content, inventory } = battleEntryAppearanceFixture();
  const battle = new BattleGame(content, 61, undefined, inventory);
  battle.appearanceFrame("a", pose());
  const before = structuredClone(battle.players[0]!.appearanceState);
  assert.throws(() => battle.appearanceFrame("a", { ...pose("down"), armorFrame: 2 }), /armor frame/);
  assert.deepEqual(battle.players[0]!.appearanceState, before);
  assert.equal(battle.appearanceFrame("e1", pose()), null, "legacy enemy art is a separate host path");
});
