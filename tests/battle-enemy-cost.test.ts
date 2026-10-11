import test from "node:test";
import assert from "node:assert/strict";
import { ControlledBattleGame as BattleGame } from "./fixtures/controlled-battle.js";
import { BattleGame as SourceBattleGame } from "../src/core/battle.js";
import { fixture } from "./fixtures/battle-content.js";
import { syntheticAI } from "./fixtures/battle-ai.js";
import { battleEntryRuntimeFixture } from "./fixtures/battle-entry-runtime.js";
import { abilityCostFixture } from "./fixtures/ability-cost.js";

function enemyCostFixture() {
  const content = fixture();
  content.enemies = [content.enemies[0]!];
  content.enemies[0]!.hp = 500;
  content.players.forEach((player) => { player.hp = 500; });
  content.abilities[13]!.cost = 3;
  content.initialAtb = { player: [0, 0], enemy: [100, 100] };
  return content;
}

test("ordinary level-zero enemy abilities execute below their fee and clamp actual payment at zero", () => {
  for (const startingMp of [0, 2, 3, 5]) {
    const content = enemyCostFixture();
    content.enemies[0]!.mp = startingMp;
    const battle = new BattleGame(content, 1723);
    assert.equal(battle.abilityCost("e1", 13)!.mp, 3, "the projected fee does not become available MP");
    assert.equal(battle.canUse("e1", 13), true);
    battle.advance(410);
    assert.equal(battle.action?.source.id, 13);
    assert.equal(battle.action?.resolved, true);
    assert.equal(battle.enemies[0]!.mp, Math.max(0, startingMp - 3));
    assert.ok(battle.players.some((player) => player.hp < 500));
    const mp = battle.enemies[0]!.mp;
    battle.advance(500);
    assert.equal(battle.enemies[0]!.mp, mp, "finishing the presentation never pays again");
    assert.equal(battle.enemyAIState("e1")!.turnCounter, 1);
  }
});

test("the next enemy AI decision sees the committed MP after partial payment", () => {
  const content = enemyCostFixture();
  content.enemies[0]!.mp = 2;
  content.enemies[0]!.abilities = [10, 13];
  content.abilities[10]!.power = 1;
  content.enemies[0]!.ai = syntheticAI([
    ["Nop"], ["SyncAI"], ["IsCheckMp", [0, 7], [], ["≦"]],
    ["StartTable", [0]], ["Act", [13]], ["EndTable"], ["JumpBattleAI", [0]],
    ["Nop"], ["StartTable", [1]], ["Act", [10]], ["EndTable"], ["JumpBattleAI", [0]],
  ]);
  const battle = new BattleGame(content, 1729);
  battle.advance(410);
  assert.equal(battle.action?.source.id, 13);
  assert.equal(battle.enemies[0]!.mp, 0);
  battle.advance(500);
  battle.enemies[0]!.atb = 100;
  battle.advance(10);
  assert.equal(battle.action?.source.id, 10);
});

test("a controlled enemy self-target recovery pays before recovery, never overwriting or doubling payment", () => {
  for (const startingMp of [0, 2, 5]) {
    const content = enemyCostFixture();
    content.enemies[0]!.mp = 20;
    content.enemies[0]!.abilities.push(11);
    const recovery = content.abilities[11]!;
    recovery.cost = 3;
    recovery.power = 5;
    recovery.plan!.targeting = { ...recovery.plan!.targeting, relation: "self", defaultRelation: "ally" };
    recovery.plan!.effects = [{ slot: 1, kind: "recovery", resource: "mp", calculation: "fixed" }];
    const battle = new BattleGame(content, 1733);
    const actor = battle.enemies[0]!;
    actor.mp = startingMp; actor.atb = 0; actor.queued = true;
    // Controlled executor input: this tests the shared payment transaction, not
    // admission of a new enemy AI self-target selection provider.
    battle.action = { kind: "normal", actor: actor.id, source: { kind: "ability", id: 11 },
      commandId: null, selection: { kind: "single", id: actor.id }, targetIds: [actor.id],
      charge: 0, elapsed: 390, resolved: false, results: [] };
    battle.advance(10);
    assert.equal(battle.action!.resolved, true);
    assert.equal(battle.action!.results.length, 1);
    assert.equal(battle.enemies[0]!.mp, Math.max(0, startingMp - 3) + 5);
    const mp = battle.enemies[0]!.mp;
    battle.advance(500);
    assert.equal(battle.enemies[0]!.mp, mp);
  }
});

test("an insufficient enemy payment and numerical failure retry as one deterministic frame", () => {
  const content = enemyCostFixture();
  content.enemies[0]!.mp = 2;
  const broken = new BattleGame(content, 1741), clean = new BattleGame(structuredClone(content), 1741);
  broken.advance(400); clean.advance(400);
  const targetId = broken.action!.targetIds[0]!;
  const target = broken.players.find((player) => player.id === targetId)!;
  const defense = target.defense;
  target.defense = 256;
  const before = structuredClone({ units: broken.combatants, action: broken.action, events: broken.events,
    time: broken.time, queue: broken.pendingActions, ai: broken.enemyAIState("e1") });
  assert.throws(() => broken.advance(10), /outside supported/);
  assert.deepEqual({ units: broken.combatants, action: broken.action, events: broken.events,
    time: broken.time, queue: broken.pendingActions, ai: broken.enemyAIState("e1") }, before);
  assert.equal(broken.enemies[0]!.mp, 2);
  broken.players.find((player) => player.id === targetId)!.defense = defense;
  broken.advance(0); clean.advance(10);
  assert.deepEqual(broken.combatants, clean.combatants);
  assert.deepEqual(broken.action, clean.action);
  assert.deepEqual(broken.events, clean.events);
  assert.equal(broken.enemies[0]!.mp, 0);
});

test("player insufficient MP remains ineligible both before selection and after queueing", () => {
  const content = fixture();
  content.abilities[10]!.cost = 3;
  const battle = new BattleGame(content, 1747), actor = battle.players[0]!;
  actor.mp = 2;
  assert.equal(battle.canUse(actor.id, 10), false);
  assert.equal(battle.command(actor.id, 10, "e1"), false);
  actor.mp = 3;
  assert.equal(battle.command(actor.id, 10, "e1"), true);
  actor.mp = 2;
  battle.advance(410);
  assert.equal(battle.players[0]!.mp, 2);
  assert.equal(battle.enemies[0]!.hp, 10);
  assert.equal(battle.action, null);
});

test("unknown hand eligibility preserves confirmed duplicate relic records and independent item use", () => {
  const { content, inventory } = battleEntryRuntimeFixture();
  const relic = structuredClone(abilityCostFixture().catalog.definitions[701]!);
  relic.jobIds = [12];
  const qualification = inventory.qualification!;
  qualification.equipmentCatalog.definitions[701] = relic;
  qualification.equipmentStock.push({ id: 701, count: 2, equipped: 2 }, { id: 102, count: 1, equipped: 0 });
  qualification.members[0]!.equipment.splice(4, 2, 701, 701);
  qualification.equipmentCatalog.characters[1000]!.hasTwoSwordStyle = true;
  content.battleEntry!.items.push({ id: 701, type: 3, listType: 0, throwFlag: 0, battleFunctionGroupId: 0 });
  content.battleRows!.equipment.push({ contentId: 701, weapon: null });
  content.players[0]!.ownedAbilities!.abilities.owned.push(
    structuredClone(relic.abilityCost!.ability), structuredClone(relic.abilityCost!.ability));
  content.battleAbilities!.abilities.push({ id: relic.abilityCost!.ability.abilityId, typeId: 0, groupId: 0, range: 0 });
  content.abilities[11]!.cost = 3;
  const before = structuredClone({ content, inventory });
  const battle = new SourceBattleGame(content, 1753, undefined, inventory);
  assert.equal(battle.itemQualification("a").canChangeEquipment, null);
  assert.equal(battle.commandMenu("a").find((command) => command.id === 3)!.available, true);
  assert.equal(battle.canUseItem("a", 10001, 3), true);
  assert.equal(battle.abilityCost("a", 10)!.mp, 0);
  assert.equal(battle.abilityCost("a", 11), null);
  assert.equal(battle.canUse("a", 13, 1), true);
  assert.deepEqual({ content, inventory }, before);
  const malformed = structuredClone(content);
  malformed.players[0]!.ownedAbilities!.abilities.owned.pop();
  assert.throws(() => new SourceBattleGame(malformed, 1753, undefined, inventory), /passive.*mismatch/);
});
