import { itemFixture } from "./fixtures/items.js";
import { fixtureParty } from "./fixtures/party.js";
import { fixtureRosterLifecycle } from "./fixtures/roster-lifecycle.js";
import test from "node:test";
import assert from "node:assert/strict";
import { GameState, type GameStateContent } from "../src/core/game-state.js";
import { GameSession } from "../src/core/game-session.js";
import { BattleGame } from "../src/core/battle.js";
import { fixture } from "./fixtures/battle-content.js";
import type { BattleCatalog } from "../src/core/battle-content.js";
import type { FieldContent, Site } from "../src/field/types.js";

const content: GameStateContent = {
  kind: "game-state-development-v1",
  limits: { gil: 1000, item: 99, hp: 9999, mp: 999, level: 99, exp: 15000000 },
  initialGil: 90,
  initialParty: fixtureParty(["a", "b"]),
  rosterLifecycle: fixtureRosterLifecycle(fixture().players),
  items: {
    10: itemFixture(10),
    20: { ...itemFixture(20, true), itemId: 2 },
  },
  initialItems: [{ id: 20, count: 1 }],
  equipment: { a: [1, 2, 3, 4, 5, 5], b: [1, 2, 3, 4, 5, 5] },
};
function state() {
  const battle = fixture();
  return new GameState(content, battle.players, "fixture", battle.conditions);
}
function session() {
  const battle = fixture();
  battle.fieldSourceSetHash = "fixture";
  const {
    encounterId,
    formation,
    enemies,
    background,
    contentHash: _,
    ...common
  } = battle;
  const catalog: BattleCatalog = {
    kind: "narshe-battle-catalog",
    contentHash: "fixture",
    common,
    gameState: structuredClone(content),
    encounters: {
      [encounterId]: { encounterId, formation, enemies, background },
    },
  };
  const source = { file: "synthetic", assetPath: "room" };
  const site: Site = { script: "start", index: 0, source };
  const field: FieldContent = {
    formatVersion: 1,
    kind: "field-development",
    contentHash: "fixture",
    sourceSetHash: "fixture",
    parentSourceSetHash: "fixture",
    map: {
      id: "fixture",
      width: 3,
      height: 3,
      tileSize: 16,
      layers: [],
      tilesets: [],
      textures: {},
      collisions: { 1: Array(9).fill(0) },
      entities: [],
      source,
    },
    characters: {},
    scripts: {
      start: [
        {
          kind: "encounter",
          party: encounterId,
          continuation: "after",
          ...site,
        },
      ],
      after: [{ kind: "exit", ...site, script: "after" }],
    },
    entry: {
      player: {
        x: 1,
        y: 1,
        layer: 1,
        direction: "up",
        asset: "hero",
        mount: "",
      },
      description: "synthetic",
      evidence: [source],
    },
    limitations: [],
  };
  const game = new GameSession(field, catalog, 499);
  assert.equal(game.field.startEvent("start"), true);
  game.advance(10);
  assert.equal(game.battle?.phase, "active");
  return game;
}
function win(game: GameSession) {
  for (let i = 0; i < 20000 && game.battle!.phase === "active"; i++) {
    for (const actor of game.battle!.ready) {
      const target = game.battle!.targets(actor.id, 10)[0];
      if (target) game.battle!.command(actor.id, 10, target.id);
    }
    game.advance(10);
  }
  assert.equal(game.battle?.phase, "victory");
}

test("a later missing growth dependency cannot publish partial levels or an uncollectable victory", () => {
  const f = fixture();
  f.experience.push({ level: 3, exp: 1 });
  f.growth.g = [{ level: 3, hp: 10, mp: 1 }];
  f.players[1]!.growthGroup = "missing";
  f.conditions.rules.definitions.push({
    id: 301,
    type: 6,
    overlapped: false,
    eraseGroupId: 1,
  });
  f.conditions.rules.eraseRules.push({
    id: 1,
    groupId: 1,
    conditionId: 0,
    type: 2,
    eraseConditionId: 0,
  });
  f.conditions.behaviors.push({
    id: 301,
    kind: "silence",
    name: "Silence",
    untilType: 2,
  });
  f.players[0]!.conditionIds = [301];
  const b = new BattleGame(f, 501);
  b.enemies.forEach((e) => {
    e.hp = 0;
  });
  const before = structuredClone(b.players);
  assert.throws(() => b.advance(10), /Missing level growth/);
  // ATB advances before the attempted outcome; durable progress and conditions do not.
  assert.deepEqual(
    b.players.map((p) => [p.exp, p.level, p.maxHp, p.maxMp, p.conditionIds]),
    before.map((p) => [p.exp, p.level, p.maxHp, p.maxMp, p.conditionIds]),
  );
  assert.equal(b.phase, "active");
  assert.equal(b.previewVictory(), null);
  f.growth.missing = [{ level: 3, hp: 9, mp: 0 }];
  b.advance(10);
  assert.equal(b.phase, "victory");
  assert.deepEqual(
    b.players.map((p) => p.exp),
    [9, 9],
  );
  assert.deepEqual(
    b.players.map((p) => p.maxHp),
    [90, 89],
  );
  assert.deepEqual(b.players[0]!.conditionIds, []);
});

test("roster, equipment and item observations cannot mutate owned state or leak battle-only fields", () => {
  const s = state(),
    before = s.snapshot(),
    view = s.snapshot(),
    party = s.partyPlayers();
  view.roster[0]!.hp = 1;
  view.roster[0]!.equipment[0] = 9;
  view.items[0]!.count = 90;
  party[0]!.conditionIds.push(301);
  party[0]!.atb = 100;
  assert.deepEqual(s.snapshot(), before);
  assert.equal("atb" in before.roster[0]!, false);
  assert.equal("sprites" in before.roster[0]!, false);
});
test("inventory batches cap grants but cannot partially consume, infer an unknown item or lose key identity", () => {
  const s = state();
  s.changeItems(
    [
      { id: 10, count: 100 },
      { id: 20, count: 1 },
    ],
    "grant",
  );
  assert.deepEqual(s.snapshot().items, [
    { id: 10, count: 99 },
    { id: 20, count: 2 },
  ]);
  const before = s.snapshot();
  assert.throws(
    () =>
      s.changeItems(
        [
          { id: 10, count: 90 },
          { id: 20, count: 3 },
        ],
        "consume",
      ),
    /Insufficient/,
  );
  assert.deepEqual(s.snapshot(), before);
  assert.throws(
    () =>
      s.changeItems(
        [
          { id: 10, count: 1 },
          { id: 500, count: 1 },
        ],
        "grant",
      ),
    /Unimplemented/,
  );
  assert.deepEqual(s.snapshot(), before);
  s.changeItems([{ id: 10, count: 99 }], "consume");
  assert.equal(s.snapshot().items.find((i) => i.id === 20)!.count, 2);
});
test("battle borrowing isolates damage, blocks external writes, and retries from the original state", () => {
  const s = state(),
    before = s.snapshot(),
    lease = s.openBattle(1000);
  const players = s.battlePlayers(lease);
  players[0]!.hp = 1;
  assert.equal(s.battlePlayers(lease)[0]!.hp, 80);
  assert.deepEqual(s.snapshot(), before);
  assert.throws(
    () => s.changeItems([{ id: 10, count: 1 }], "grant"),
    /reserved/,
  );
  assert.throws(() => s.restore(before), /reserved/);
  assert.throws(() => s.openBattle(1001), /reserved/);
  s.cancelBattle(lease);
  assert.throws(() => s.battlePlayers(lease), /Stale/);
  assert.equal(s.openBattle(1000).serial, 0);
});
test("victory validates the whole roster then publishes once, preserving inventory and six equipment slots", () => {
  const s = state(),
    before = s.snapshot(),
    lease = s.openBattle(1000),
    players = s.battlePlayers(lease);
  players[0]!.hp = 31;
  players[0]!.exp = 40;
  players[1]!.mp = -1;
  assert.throws(
    () => s.prepareVictory(lease, { players, gil: 100, consumedItems: [] }),
    /integer/,
  );
  assert.deepEqual(s.snapshot(), before);
  players[1]!.mp = 0;
  const commit = s.prepareVictory(lease, {
    players,
    gil: 2000,
    consumedItems: [],
  });
  players[0]!.hp = 1;
  assert.deepEqual(s.snapshot(), before);
  commit();
  assert.equal(s.snapshot().roster[0]!.hp, 31);
  assert.equal(s.gil, 1000);
  assert.equal(s.snapshot().totalGil, 2090);
  assert.deepEqual(s.snapshot().items, before.items);
  assert.deepEqual(
    s.snapshot().roster[0]!.equipment,
    before.roster[0]!.equipment,
  );
  assert.throws(commit, /Stale/);
  assert.throws(
    () => s.prepareVictory(lease, { players, gil: 1, consumedItems: [] }),
    /Stale/,
  );
  assert.deepEqual(s.completedEncounters, [1000]);
});
test("shared-state restore rejects incompatible, incomplete, extra and inconsistent data before mutation", () => {
  const s = state(),
    before = s.snapshot();
  const invalid = [
    (x: typeof before) => {
      x.catalogHash = "another source";
    },
    (x: typeof before) => {
      x.roster[0]!.hp = 0;
    },
    (x: typeof before) => {
      x.roster[0]!.conditionIds = [305];
    },
    (x: typeof before) => {
      x.roster.pop();
    },
    (x: typeof before) => {
      x.party.slots[0][0].id = "unknown";
    },
    (x: typeof before) => {
      Object.assign(x.roster[0]!, { attack: 999999 });
    },
    (x: typeof before) => {
      x.roster[0]!.equipment[0] = 999;
    },
    (x: typeof before) => {
      x.items.push({ id: 20, count: 1 });
    },
    (x: typeof before) => {
      Object.assign(x.items[0]!, { id: "20" });
    },
    (x: typeof before) => {
      x.completedBattles.push({ serial: 2, encounterId: 1000 });
    },
  ];
  for (const mutate of invalid) {
    const x = s.snapshot();
    mutate(x);
    assert.throws(() => s.restore(x));
    assert.deepEqual(s.snapshot(), before);
  }
  const checkpoint = s.snapshot();
  checkpoint.roster[0]!.hp = 30;
  s.restore(JSON.parse(JSON.stringify(checkpoint)));
  checkpoint.roster[0]!.hp = 1;
  assert.equal(s.partyPlayers()[0]!.hp, 30);
});
test("failed field return never consumes a victory or partially updates shared rewards", () => {
  const game = session(),
    before = game.state.snapshot();
  win(game);
  const result = game.battle!.previewVictory();
  const after = game.field.content.scripts.after!;
  delete game.field.content.scripts.after;
  assert.throws(() => game.continueVictory(), /Missing battle continuation/);
  assert.deepEqual(game.state.snapshot(), before);
  assert.deepEqual(game.battle!.previewVictory(), result);
  assert.equal(game.state.inBattle, true);
  game.field.content.scripts.after = after;
  assert.equal(game.continueVictory(), true);
  assert.equal(game.continueVictory(), false);
  assert.equal(game.gil, 90 + result!.gil);
  assert.deepEqual(game.completedEncounters, [1000]);
  assert.equal(game.field.busy, true);
  game.advance(10);
  assert.equal(game.field.busy, false);
  assert.equal(game.state.inBattle, false);
});
test("invalid return-local initialization is preflighted without losing a reward", () => {
  const game = session();
  win(game);
  game.field.content.scriptLocals = { after: { labels: ["x"], values: [NaN] } };
  const before = game.state.snapshot();
  assert.throws(() => game.continueVictory(), /32-bit/);
  assert.deepEqual(game.state.snapshot(), before);
  assert.ok(game.battle!.previewVictory());
});
test("two occurrences of one encounter get separate receipts and share post-battle character state", () => {
  const game = session();
  win(game);
  game.continueVictory();
  game.advance(10);
  const before = game.state.snapshot();
  game.field.startEvent("start");
  game.advance(10);
  assert.deepEqual(
    game.battle!.players.map((p) => [p.id, p.hp, p.mp, p.exp]),
    game.players.map((p) => [p.id, p.hp, p.mp, p.exp]),
  );
  win(game);
  game.continueVictory();
  assert.deepEqual(game.completedEncounters, [1000, 1000]);
  assert.deepEqual(game.state.snapshot().items, before.items);
  assert.deepEqual(
    game.state.snapshot().completedBattles.map((b) => b.serial),
    [0, 1],
  );
});
