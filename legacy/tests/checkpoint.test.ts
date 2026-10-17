import test from "node:test";
import assert from "node:assert/strict";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";
import { GameSession } from "../src/core/game-session.js";
import {
  CheckpointStorage,
  encodeSavedGame,
  decodeSavedGame,
} from "../src/core/saved-game.js";

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
test("framework save slots preserve the existing current and previous progress", async () => {
  const bytes = new Map<string, string>();
  const storage = { getItem: (key: string) => bytes.get(key) ?? null,
    setItem: (key: string, value: string) => { bytes.set(key, value); } };
  const strict = new CheckpointStorage(storage), framework = new CheckpointStorage(storage, "framework");
  const checkpoint = checkpointFixture().game.checkpoint();
  await strict.save(checkpoint, 10);
  await strict.save(checkpoint, 20);
  const before = bytes.get("ffvi-reweb.checkpoint.v1");
  assert.equal(await framework.load(), null);
  await framework.save(checkpoint, 30);
  await framework.save(checkpoint, 40);
  assert.equal(bytes.get("ffvi-reweb.checkpoint.v1"), before);
  assert.equal((await strict.load())!.savedAt, 20);
  assert.equal((await strict.load(true))!.savedAt, 10);
  assert.equal((await framework.load())!.savedAt, 40);
  assert.equal((await framework.load(true))!.savedAt, 30);
});
test("battle preferences survive save, next encounter and retry without changing source content", () => {
  const f = checkpointFixture();
  const original = structuredClone(f.battle);
  f.game.setBattlePreferences({ mode: "wait", speedIndex: 4 });
  const copy = GameSession.restore(f.game.checkpoint(), f.field, f.battle);
  assert.deepEqual(copy.battlePreferences, { mode: "wait", speedIndex: 4 });
  const exposed = copy.battlePreferences;
  exposed.mode = "active";
  assert.equal(copy.battlePreferences.mode, "wait");
  copy.field.startEvent("fight");
  copy.advance(10);
  assert.equal(copy.battle!.preferences.mode, "wait");
  assert.equal(copy.battle!.timingState.atbSpeed, 2);
  copy.setBattlePreferences({ mode: "active", speedIndex: 0 });
  assert.equal(copy.battle!.preferences.mode, "active");
  assert.equal(copy.battle!.timingState.atbSpeed, 0.5);
  assert.throws(() => copy.setBattlePreferences({ mode: "bad" as "active", speedIndex: 2 }));
  assert.equal(copy.battlePreferences.mode, "active");
  for (const member of copy.battle!.players) {
    member.hp = 0;
    member.conditionIds = [305];
  }
  copy.advance(10);
  assert.equal(copy.battle!.phase, "defeat");
  assert.equal(copy.retryBattle(), true);
  assert.equal(copy.battle!.preferences.mode, "active");
  assert.equal(copy.battle!.preferences.speedIndex, 0);
  assert.deepEqual(f.battle, original);
});

test("checkpoint rejects unknown preferences and the previous schema before changing the session", () => {
  const f = checkpointFixture();
  const valid = f.game.checkpoint();
  for (const preferences of [null, {}, { mode: "turbo" }, { mode: "wait", speed: 2 }]) {
    const bad = structuredClone(valid);
    Object.assign(bad, { battlePreferences: preferences });
    assert.throws(() => GameSession.restore(bad, f.field, f.battle));
    assert.deepEqual(f.game.checkpoint(), valid);
  }
  const old = structuredClone(valid);
  Object.assign(old, { formatVersion: 2 });
  assert.throws(() => GameSession.restore(old, f.field, f.battle), /version mismatch/);
});

test("checkpoint carries party, quantities, flags, groups, doors and looping media without replaying field initialization", () => {
  const f = checkpointFixture(),
    { game } = f;
  game.field.startEvent("groups");
  game.field.hiddenEntities.add("npc");
  game.field.eventState.write({ category: "ScenarioFlag1", index: 4 }, 1);
  game.state.changeItems([{ id: 10, count: 3 }], "grant");
  assert.equal(game.field.move("right"), false); // Open door first.
  assert.equal(game.checkpointReady, false);
  assert.throws(() => game.checkpoint(), /Cannot save/);
  game.advance(80);
  assert.equal(game.field.openTriggers.blocks("door"), false);
  game.field.tileAnimations.play("region", true, 1);
  game.field.actors.npc!.animation!.play("Default", true, 1);
  game.field.bgm.play(1, 0, 0.5, 1, game.field.content.bgm);
  game.advance(237.25);
  const checkpoint = game.checkpoint();
  const restored = GameSession.restore(
    JSON.parse(JSON.stringify(checkpoint)),
    f.field,
    f.battle,
  );
  assert.deepEqual(restored.checkpoint(), checkpoint);
  assert.equal(restored.field.flags.ScenarioFlag1![4], true);
  assert.deepEqual(
    restored.field.eventState.snapshot().global,
    Array(16).fill(null),
  );
  assert.equal(restored.field.openTriggers.blocks("door"), false);
  checkpoint.owned.items[0]!.count = 98;
  checkpoint.world.field.actors[0]!.x = 5;
  assert.equal(restored.state.snapshot().items[0]!.count, 3);
  assert.equal(restored.field.player.x, 1);
  game.advance(500);
  for (const ms of [47, 153, 300]) restored.advance(ms);
  assert.deepEqual(restored.checkpoint(), game.checkpoint());
  assert.equal(restored.field.move("right"), true);
});
test("save is unavailable during movement, pending transitions, battles and unconsumed victories", () => {
  const f = checkpointFixture(),
    { game } = f;
  assert.equal(game.field.move("down"), true);
  assert.throws(() => game.checkpoint(), /Cannot save/);
  game.advance(240);
  game.field.previewMap(2, 1);
  assert.throws(() => game.checkpoint(), /Cannot save/);
  const other = checkpointFixture().game;
  other.field.startEvent("fight");
  other.advance(10);
  assert.throws(() => other.checkpoint(), /Cannot save/);
  win(other);
  assert.throws(() => other.checkpoint(), /Cannot save/);
  other.continueVictory();
  assert.throws(() => other.checkpoint(), /Cannot save/);
  other.advance(10);
  assert.equal(other.checkpointReady, true);
});
test("world-map restore skips initializer but preserves variables, positions and subsequent entry behavior", () => {
  const f = checkpointFixture(),
    { game } = f;
  game.field.eventState.write({ category: "ScenarioFlag1", index: 8 }, 0);
  game.field.eventState.write({ category: "ScenarioVariable", index: 0 }, 99);
  game.field.previewMap(2, 1);
  const prepared = game.world.prepare(f.world, f.target);
  assert.equal(game.world.commit(prepared), true);
  game.advance(10);
  assert.equal(game.field.flags.ScenarioFlag1![8], true);
  game.field.move("down");
  game.advance(240);
  const checkpoint = game.checkpoint();
  const copy = GameSession.restore(checkpoint, f.field, f.battle, {
    catalog: f.world,
    map: f.target,
  });
  assert.deepEqual(copy.checkpoint(), checkpoint);
  assert.equal(copy.field.player.y, 2);
  assert.equal(copy.field.flags.ScenarioFlag1![8], true);
  assert.equal(
    copy.field.eventState.read({ category: "ScenarioVariable", index: 0 }),
    99,
  );
  assert.throws(
    () => GameSession.restore(checkpoint, f.field, f.battle),
    /dependencies/,
  );
  assert.throws(
    () =>
      GameSession.restore(checkpoint, f.field, f.battle, {
        catalog: { ...f.world, contentHash: "different" },
        map: f.target,
      }),
    /dependencies/,
  );
  copy.field.previewMap(2, 1);
  copy.world.commit(copy.world.prepare(f.world, f.target));
  copy.advance(10);
  assert.equal(copy.field.flags.ScenarioFlag1![8], false); // A real reentry runs the initializer exactly once.
});
test("restored victory receipts and encounter seed produce the same next battle without awarding twice", () => {
  const f = checkpointFixture(),
    { game } = f;
  game.field.startEvent("fight");
  game.advance(10);
  win(game);
  game.continueVictory();
  game.advance(17.5);
  const copy = GameSession.restore(game.checkpoint(), f.field, f.battle);
  assert.equal(copy.continueVictory(), false);
  assert.equal(copy.gil, game.gil);
  for (const host of [copy, game]) {
    host.field.startEvent("fight");
    host.advance(1000);
  }
  assert.deepEqual(copy.battle!.combatants, game.battle!.combatants);
  assert.deepEqual(copy.battle!.events, game.battle!.events);
});
test("invalid checkpoint identities, actors, audio, triggers and versions reject before replacing an existing session", () => {
  const f = checkpointFixture(),
    original = f.game.checkpoint();
  f.game.field.bgm.play(1, 0, 0, 0, f.field.bgm);
  const valid = f.game.checkpoint();
  const changes: ((s: typeof valid) => void)[] = [
    (s) => {
      s.battleCatalogHash = "wrong";
    },
    (s) => {
      Object.assign(s, { formatVersion: 3 });
    },
    (s) => {
      s.encounterSerial = 1;
    },
    (s) => {
      s.world.field.activeGroups.push("unknown");
    },
    (s) => {
      s.world.field.hiddenEntities.push("unknown");
    },
    (s) => {
      s.world.field.actors.pop();
    },
    (s) => {
      s.world.field.actors[0]!.animation!.duration = -1;
    },
    (s) => {
      Object.assign(s.world.field.actors[0]!.animation!, { key: ["Front"] });
    },
    (s) => {
      Object.assign(s.world.field.actors[0]!, { direction: ["down"] });
    },
    (s) => {
      s.world.field.actors[0]!.layer = 99;
    },
    (s) => {
      s.world.field.tiles.cells["0:8"]!.scale = 0;
    },
    (s) => {
      s.world.field.doors.opened = ["npc"];
    },
    (s) => {
      s.world.field.bgm.voices[0]!.track = 999;
    },
    (s) => {
      s.world.field.bgm.channels[0] = 90;
    },
    (s) => {
      Object.assign(s.world.field.eventState, { futureField: true });
    },
  ];
  for (const change of changes) {
    const bad = structuredClone(valid);
    change(bad);
    assert.throws(() => GameSession.restore(bad, f.field, f.battle));
    assert.deepEqual(f.game.checkpoint(), valid);
  }
  assert.notDeepEqual(valid, original);
});
test("save file digest catches changed payloads and versions; storage keeps prior data on quota or concurrent change", async () => {
  const f = checkpointFixture(),
    checkpoint = f.game.checkpoint();
  const encoded = await encodeSavedGame(checkpoint, 1000);
  assert.deepEqual((await decodeSavedGame(encoded)).checkpoint, checkpoint);
  const edited = JSON.parse(encoded);
  edited.checkpoint.owned.gil++;
  await assert.rejects(
    () => decodeSavedGame(JSON.stringify(edited)),
    /changed/,
  );
  edited.formatVersion = 2;
  await assert.rejects(
    () => decodeSavedGame(JSON.stringify(edited)),
    /version/,
  );
  let raw: string | null = null,
    quota = false;
  const storage = {
    getItem: () => raw,
    setItem: (_: string, next: string) => {
      if (quota) throw new Error("QuotaExceeded");
      raw = next;
    },
  };
  const store = new CheckpointStorage(storage);
  assert.equal(await store.load(), null);
  await store.save(checkpoint, 1000);
  const first = raw;
  await assert.rejects(
    () =>
      store.save(
        { ...checkpoint, sourceSetHash: "x".repeat(4 * 1024 * 1024) },
        1500,
      ),
    /Oversized/,
  );
  assert.equal(
    raw,
    first,
    "Refuse a file too large for our reader before replacing the slot",
  );
  f.game.state.changeItems([{ id: 10, count: 1 }], "grant");
  quota = true;
  await assert.rejects(() => store.save(f.game.checkpoint(), 2000), /Quota/);
  assert.equal(raw, first);
  quota = false;
  await store.save(f.game.checkpoint(), 2000);
  assert.equal((await store.load())!.savedAt, 2000);
  assert.equal((await store.load(true))!.savedAt, 1000);
  const pending = store.save(checkpoint, 3000);
  raw = first;
  await assert.rejects(() => pending, /changed/);
  assert.equal(raw, first);
  raw = "unreadable prior slot";
  await assert.rejects(() => store.load());
  await store.save(checkpoint, 4000);
  assert.equal(JSON.parse(raw!).previous, "unreadable prior slot");
  assert.equal((await store.load())!.savedAt, 4000);
});
