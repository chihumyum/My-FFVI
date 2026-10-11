import test from "node:test";
import assert from "node:assert/strict";
import { GameSession, type GameCheckpoint } from "../src/core/game-session.js";
import { encodeSavedGame, decodeSavedGame } from "../src/core/saved-game.js";
import { equipmentGameFixture } from "./fixtures/equipment-game.js";

const startingStock = [
  { id: 101, count: 1 },
  { id: 102, count: 1 },
  { id: 201, count: 2 },
  { id: 301, count: 2 },
  { id: 401, count: 2 },
  { id: 501, count: 1 },
];
function setup(options: { capped?: boolean } = {}) {
  const fixture = equipmentGameFixture(options);
  return {
    ...fixture,
    game: new GameSession(fixture.field, fixture.catalog, 314),
  };
}
function startBattle(game: GameSession) {
  game.field.startEvent("fight");
  game.advance(10);
  assert.equal(game.battle?.phase, "active");
  return game.battle!;
}
/** The only injected battle outcome is enemy HP. Growth, rewards, equipment and
 * the field handoff still execute through the real shared-state transaction. */
function controlledVictory(game: GameSession) {
  for (const enemy of game.battle!.enemies) enemy.hp = 0;
  game.advance(10);
  assert.equal(game.battle!.phase, "victory");
}

test("equipment ownership includes inactive roster members and serializes competition for the last copy", () => {
  const { game } = setup();
  const initial = game.state.snapshot();
  assert.deepEqual(initial.equipmentStock, startingStock);
  assert.ok(
    game.state.equipmentInventory.every((entry) => entry.available === 0),
  );
  initial.party.slots[0][1].id = null;
  game.state.restore(initial);

  assert.equal(game.changeEquipment("a", 5, 5), true);
  assert.deepEqual(
    game.state.equipmentInventory.find((entry) => entry.id === 501),
    {
      id: 501,
      count: 1,
      equipped: 0,
      available: 1,
    },
  );
  assert.ok(
    game.state.equipmentChoices("a", 5).some((choice) => choice.id === 501),
  );
  assert.ok(
    game.state.equipmentChoices("b", 5).some((choice) => choice.id === 501),
  );
  assert.equal(game.changeEquipment("b", 5, 501), true);
  assert.deepEqual(
    game.state.activeParty.map((p) => p.id),
    ["a"],
  );
  const beforeSecondClaim = game.state.snapshot();
  assert.throws(
    () => game.changeEquipment("a", 5, 501),
    /No available equipment copy/,
  );
  assert.deepEqual(game.state.snapshot(), beforeSecondClaim);
  assert.equal(
    game.state.equipmentInventory.find((entry) => entry.id === 501)!.available,
    0,
  );

  assert.equal(game.changeEquipment("b", 5, 5), true);
  assert.equal(game.changeEquipment("a", 5, 501), true);
  assert.deepEqual(game.state.snapshot().equipmentStock, startingStock);
  assert.deepEqual(
    game.state.snapshot().roster.map((p) => p.equipment),
    initial.roster.map((p) => p.equipment),
  );
  const beforeNoop = game.state.snapshot();
  assert.equal(game.changeEquipment("a", 5, 501), false);
  assert.deepEqual(game.state.snapshot(), beforeNoop);
});

test("job, slot and identity qualification failures leave equipment, resources and total stock atomic", () => {
  const { field, catalog } = equipmentGameFixture();
  catalog.gameState.equipmentSystem!.catalog.definitions[102]!.jobIds = [2];
  const game = new GameSession(field, catalog, 314);
  assert.equal(game.changeEquipment("b", 2, 1), true);
  const before = game.state.snapshot();
  const invalid: [() => unknown, RegExp][] = [
    [() => game.changeEquipment("a", 1, 102), /Equipment job mismatch/],
    [() => game.changeEquipment("a", 3, 101), /Equipment slot mismatch/],
    [() => game.changeEquipment("a", 7, 501), /Invalid equipment integer/],
    [() => game.changeEquipment("unknown", 5, 501), /Unknown equipment owner/],
    [() => game.changeEquipment("a", 5, 999), /Unknown equipment content/],
  ];
  for (const [attempt, expected] of invalid) {
    assert.throws(attempt, expected);
    assert.deepEqual(game.state.snapshot(), before);
    assert.deepEqual(game.state.snapshot().equipmentStock, startingStock);
  }
  assert.ok(
    !game.state.equipmentChoices("a", 1).some((choice) => choice.id === 102),
  );
});

test("a conflicting ordinary hand change publishes both slots and frees exactly the displaced copies", () => {
  const { game } = setup();
  assert.equal(game.changeEquipment("b", 1, 1), true);
  const choice = game.state
    .equipmentChoices("a", 1)
    .find((entry) => entry.id === 201);
  assert.deepEqual(choice!.changes, [
    { slot: 1, from: 101, to: 201 },
    { slot: 2, from: 201, to: 1 },
  ]);
  const beforePreview = game.state.snapshot();
  assert.deepEqual(beforePreview.roster[0]!.equipment.slice(0, 2), [101, 201]);
  assert.equal(game.changeEquipment("a", 1, 201), true);
  assert.deepEqual(
    game.state.snapshot().roster[0]!.equipment.slice(0, 2),
    [201, 1],
  );
  assert.deepEqual(
    game.state.equipmentInventory.find((entry) => entry.id === 201),
    {
      id: 201,
      count: 2,
      equipped: 1,
      available: 1,
    },
  );
  assert.deepEqual(
    game.state.equipmentInventory.find((entry) => entry.id === 101),
    {
      id: 101,
      count: 1,
      equipped: 0,
      available: 1,
    },
  );
  assert.deepEqual(game.state.snapshot().equipmentStock, startingStock);
  assert.equal(game.changeEquipment("a", 1, 101), true);
  assert.equal(game.changeEquipment("a", 2, 201), true);
  assert.equal(game.changeEquipment("b", 1, 201), true);
  assert.deepEqual(game.state.snapshot().equipmentStock, startingStock);
  assert.ok(
    game.state.equipmentInventory.every((entry) => entry.available === 0),
  );
});

test("battle borrows equipped parameters and retry restores the unchanged entry projection", () => {
  const { game, catalog } = setup();
  assert.equal(game.changeEquipment("b", 2, 1), true);
  assert.equal(game.changeEquipment("a", 1, 102), true);
  const ownedBeforeBattle = game.state.snapshot();
  // Explicit fixture arithmetic: base attack 20 + weapon 40; magic 40 + 2 + 7.
  assert.equal(game.players[0]!.physical!.attack, 60);
  assert.equal(game.players[0]!.magic, 49);
  assert.equal(game.players[0]!.maxHp, 130);
  assert.equal(game.players[1]!.physical!.attack, 20);
  assert.equal(catalog.common.players[0]!.physical!.attack, 20);
  const battle = startBattle(game);
  const entryPlayers = structuredClone(battle.players);
  assert.equal(entryPlayers[0]!.physical!.attack, 60);
  assert.equal(entryPlayers[0]!.magic, 49);
  assert.equal(game.changeEquipment("a", 1, 101), false);
  assert.throws(
    () => game.state.changeEquipment("a", 1, 101),
    /reserved by an active battle/,
  );
  assert.deepEqual(game.state.equipmentChoices("a", 1), []);
  assert.throws(() => game.checkpoint(), /Cannot save/);

  for (const player of battle.players) {
    player.hp = 0;
    player.conditionIds = [305];
  }
  game.advance(10);
  assert.equal(battle.phase, "defeat");
  assert.deepEqual(game.state.snapshot(), ownedBeforeBattle);
  assert.equal(game.retryBattle(), true);
  assert.deepEqual(game.battle!.players, entryPlayers);
  assert.deepEqual(game.state.snapshot(), ownedBeforeBattle);
  assert.deepEqual(game.state.snapshot().equipmentStock, startingStock);
});

test("victory keeps uncapped growth inputs so removing HP/MP equipment after capped growth loses no progress", () => {
  const { game, field, catalog } = setup({ capped: true });
  const sourceContexts = structuredClone(
    catalog.gameState.equipmentSystem!.contexts,
  );
  const before = game.state.snapshot();
  const battle = startBattle(game);
  controlledVictory(game);
  // Natural growth is 95 + 15 HP and 8 + 4 MP, capped at 100/10 before gear.
  assert.deepEqual(
    battle.players.map((p) => [p.level, p.exp, p.maxHp, p.maxMp]),
    [
      [3, 9, 100, 10],
      [3, 9, 100, 10],
    ],
  );
  assert.deepEqual(game.state.snapshot(), before);
  assert.equal(game.changeEquipment("a", 5, 5), false);
  assert.equal(game.continueVictory(), true);
  assert.equal(game.continueVictory(), false);
  game.advance(10);
  assert.equal(game.changeEquipment("a", 5, 5), true);
  assert.deepEqual(
    game.players.map((p) => [p.level, p.maxHp, p.maxMp]),
    [
      [3, 100, 10],
      [3, 100, 10],
    ],
  );
  assert.deepEqual([game.players[0]!.hp, game.players[0]!.mp], [100, 10]);
  assert.equal(game.gil, 104);
  assert.deepEqual(game.state.snapshot().completedBattles, [
    { serial: 0, encounterId: 1000 },
  ]);
  assert.deepEqual(game.state.snapshot().equipmentStock, startingStock);
  assert.equal(
    game.state.equipmentInventory.find((entry) => entry.id === 501)!.available,
    1,
  );
  assert.deepEqual(catalog.gameState.equipmentSystem!.contexts, sourceContexts);

  const checkpoint = game.checkpoint();
  const restored = GameSession.restore(checkpoint, field, catalog);
  assert.deepEqual(restored.checkpoint(), checkpoint);
  assert.equal(restored.changeEquipment("a", 5, 501), true);
  assert.equal(restored.changeEquipment("a", 5, 5), true);
  assert.deepEqual(
    [restored.players[0]!.maxHp, restored.players[0]!.maxMp],
    [100, 10],
  );
  assert.equal(restored.continueVictory(), false);
  assert.equal(restored.gil, 104);
});

test("growth and subsequent equipment changes recompute dying from unchanged current HP", () => {
  const { game } = setup();
  const owned = game.state.snapshot();
  // 17/130 is above 1/8, 17/145 below it, then 17/135 above it again.
  owned.roster[0]!.hp = 17;
  game.state.restore(owned);
  assert.deepEqual(game.players[0]!.conditionIds, []);
  const battle = startBattle(game);
  controlledVictory(game);
  assert.deepEqual(
    [battle.players[0]!.hp, battle.players[0]!.maxHp],
    [17, 145],
  );
  assert.deepEqual(battle.players[0]!.conditionIds, [304]);
  assert.equal(game.continueVictory(), true);
  game.advance(10);
  assert.deepEqual(game.players[0]!.conditionIds, [304]);
  assert.equal(game.changeEquipment("a", 5, 5), true);
  assert.deepEqual([game.players[0]!.hp, game.players[0]!.maxHp], [17, 135]);
  assert.deepEqual(game.players[0]!.conditionIds, []);
  assert.equal(game.changeEquipment("a", 5, 501), true);
  assert.deepEqual(game.players[0]!.conditionIds, [304]);
});

test("saved equipment restores exactly and a valid save checksum cannot admit impossible stock or derived maxima", async () => {
  const { game, field, catalog } = setup();
  assert.equal(game.changeEquipment("a", 5, 5), true);
  assert.equal(game.changeEquipment("b", 5, 501), true);
  const checkpoint = game.checkpoint();
  const saved = await decodeSavedGame(await encodeSavedGame(checkpoint, 1000));
  const restored = GameSession.restore(saved.checkpoint, field, catalog);
  assert.deepEqual(restored.checkpoint(), checkpoint);
  assert.deepEqual(restored.players, game.players);
  assert.deepEqual(
    restored.state.equipmentInventory,
    game.state.equipmentInventory,
  );
  const invalid: [string, (s: GameCheckpoint) => void, RegExp][] = [
    [
      "worn copies exceed stock",
      (s) => {
        s.owned.equipmentStock.find((entry) => entry.id === 201)!.count = 1;
      },
      /exceeds owned count/,
    ],
    [
      "negative stock",
      (s) => {
        s.owned.equipmentStock[0]!.count = -1;
      },
      /Invalid equipment integer/,
    ],
    [
      "fractional stock",
      (s) => {
        s.owned.equipmentStock[0]!.count = 1.5;
      },
      /Invalid equipment integer/,
    ],
    [
      "stock limit",
      (s) => {
        s.owned.equipmentStock[0]!.count = 100;
      },
      /Invalid equipment integer/,
    ],
    [
      "duplicate stock",
      (s) => {
        s.owned.equipmentStock.push({ ...s.owned.equipmentStock[0]! });
      },
      /Duplicate or empty equipment stock/,
    ],
    [
      "empty-slot stock",
      (s) => {
        s.owned.equipmentStock.push({ id: 1, count: 1 });
      },
      /Duplicate or empty equipment stock/,
    ],
    [
      "unknown stock",
      (s) => {
        s.owned.equipmentStock.push({ id: 999, count: 1 });
      },
      /Unknown equipment content/,
    ],
    [
      "forged resource maximum",
      (s) => {
        s.owned.roster[0]!.maxHp--;
        s.owned.roster[0]!.hp = s.owned.roster[0]!.maxHp;
      },
      /disagrees with equipment\/growth/,
    ],
    [
      "illegal slot",
      (s) => {
        s.owned.roster[0]!.equipment[2] = 101;
      },
      /Equipment slot mismatch/,
    ],
    [
      "old owned-state version",
      (s) => {
        Object.assign(s.owned, { formatVersion: 1 });
      },
      /source\/version mismatch/,
    ],
  ];
  for (const [label, change, expected] of invalid) {
    const forged = structuredClone(checkpoint);
    change(forged);
    const envelope = await decodeSavedGame(await encodeSavedGame(forged, 1000));
    assert.throws(
      () => GameSession.restore(envelope.checkpoint, field, catalog),
      expected,
      label,
    );
    assert.throws(
      () => game.state.restore(envelope.checkpoint.owned),
      expected,
      label,
    );
    assert.deepEqual(game.checkpoint(), checkpoint, label);
  }
  // Save objects and projections are copies, never writable aliases into a session.
  saved.checkpoint.owned.equipmentStock[0]!.count = 99;
  saved.checkpoint.owned.roster[0]!.equipment[0] = 1;
  assert.deepEqual(restored.checkpoint(), checkpoint);
});

test("GameSession rejects equipment changes during movement, an event, battle and pending victory continuation", () => {
  const { game } = setup();
  const before = game.state.snapshot();
  assert.equal(game.field.move("down"), true);
  assert.equal(game.changeEquipment("a", 5, 5), false);
  assert.deepEqual(game.state.snapshot(), before);
  game.advance(240);
  assert.equal(game.changeEquipment("a", 5, 5), true);
  assert.equal(game.changeEquipment("a", 5, 501), true);

  game.field.startEvent("waiting");
  assert.equal(game.checkpointReady, false);
  const beforeEvent = game.state.snapshot();
  assert.equal(game.changeEquipment("a", 5, 5), false);
  assert.deepEqual(game.state.snapshot(), beforeEvent);
  game.advance(1000);
  assert.equal(game.checkpointReady, true);
  assert.equal(game.changeEquipment("a", 5, 5), true);
  assert.equal(game.changeEquipment("a", 5, 501), true);

  const beforeBattle = game.state.snapshot();
  startBattle(game);
  assert.equal(game.changeEquipment("a", 5, 5), false);
  assert.deepEqual(game.state.snapshot(), beforeBattle);
  controlledVictory(game);
  assert.equal(game.changeEquipment("a", 5, 5), false);
  assert.equal(game.continueVictory(), true);
  assert.equal(game.changeEquipment("a", 5, 5), false);
  game.advance(10);
  assert.equal(game.changeEquipment("a", 5, 5), true);
});

test("missing later recipient equipment-growth dependency aborts the whole victory projection", () => {
  const { field, catalog } = equipmentGameFixture();
  catalog.common.players[1]!.growthGroup = "later";
  catalog.common.growth.later = [{ level: 3, hp: 15, mp: 4 }];
  catalog.gameState.equipmentSystem!.growth.later = [];
  const game = new GameSession(field, catalog, 314);
  const owned = game.state.snapshot();
  const battle = startBattle(game);
  const before = structuredClone(battle.players);
  for (const enemy of battle.enemies) enemy.hp = 0;
  assert.throws(
    () => game.advance(10),
    /Missing or ambiguous equipment growth dependency/,
  );
  assert.equal(battle.phase, "active");
  assert.equal(battle.previewVictory(), null);
  // ATB advances one tick, but no recipient may retain a partial reward/projection.
  assert.deepEqual(
    battle.players.map(({ atb: _, ...p }) => p),
    before.map(({ atb: _, ...p }) => p),
  );
  assert.deepEqual(game.state.snapshot(), owned);
});
