import test from "node:test";
import assert from "node:assert/strict";
import { GameSession } from "../src/core/game-session.js";
import { decodeFieldOp } from "../src/compiler/field.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";
import type { Op } from "../src/field/types.js";

const site = {
  script: "party-integration",
  index: 0,
  source: { file: "synthetic", assetPath: "party-integration" },
};
const select = (slot: 0 | 1 | 2, refreshActors = false): Op => ({
  ...site,
  kind: "party",
  command: { kind: "select-slot", slot, refreshActors },
  dependencies: [],
});
const grant: Op = {
  ...site,
  kind: "inventory",
  command: { kind: "grant-item", id: 10, count: 3 },
  result: null,
  dependencies: [],
};
const exit: Op = { ...site, kind: "exit" };
function setup() {
  const f = checkpointFixture();
  const snapshot = f.game.state.snapshot();
  snapshot.party.slots[1][2].id = "b";
  snapshot.party.slots[2][0] = { id: "a", row: "back" };
  f.game.state.restore(snapshot);
  return f;
}

test("party and inventory candidate writes share a generation and publish one owned snapshot", () => {
  const { game } = setup();
  const before = game.state.snapshot();
  const draft = game.state.prepareFieldState();
  const stale = draft.ports.inventory.prepare({ kind: "grant-gil", amount: 5 });
  draft.ports.party
    .prepare({ kind: "select-slot", slot: 1, refreshActors: false })
    .commit();
  assert.throws(stale.commit, /Stale/);
  draft.ports.inventory
    .prepare({ kind: "grant-item", id: 10, count: 3 })
    .commit();
  assert.deepEqual(game.state.snapshot(), before);
  assert.equal(draft.commit(), true);
  assert.equal(draft.commit(), false);
  assert.deepEqual(game.state.activeParty, [
    { id: "b", index: 2, row: "front" },
  ]);
  assert.equal(game.state.snapshot().items[0]!.count, 3);
  draft.ports.party
    .prepare({ kind: "select-slot", slot: 0, refreshActors: false })
    .commit();
  assert.deepEqual(
    game.state.activeParty.map((p) => p.id),
    ["a", "b"],
  );
});

test("party preparation invalidates on inventory, restore and battle ownership without partial publication", () => {
  const { game } = setup();
  const command = {
    kind: "select-slot" as const,
    slot: 1 as const,
    refreshActors: false,
  };
  const party = game.state.fieldParty.prepare(command);
  game.state.changeItems([{ id: 10, count: 1 }], "grant");
  assert.throws(party.commit, /Stale/);
  const draft = game.state.prepareFieldState();
  draft.ports.party.prepare(command).commit();
  game.state.restore(game.state.snapshot());
  assert.equal(draft.commit(), false);
  const late = game.state.fieldParty.prepare(command);
  game.field.startEvent("fight");
  game.advance(10);
  assert.throws(late.commit, /reserved/);
  assert.throws(() => game.state.fieldParty.prepare(command), /reserved/);
  assert.equal(game.state.snapshot().party.selectedSlot, 0);
});

test("source slot switch feeds battle roster, victory and save without changing owned characters or granting stock", () => {
  const { game, field, battle } = setup();
  const before = game.state.snapshot();
  field.scripts.select = [select(1), exit];
  game.field.startEvent("select");
  game.advance(10);
  assert.equal(game.field.stop, null);
  assert.deepEqual(
    game.players.map((p) => p.id),
    ["b"],
  );
  const checkpoint = game.checkpoint();
  const restored = GameSession.restore(checkpoint, field, battle);
  assert.deepEqual(restored.checkpoint(), checkpoint);
  assert.deepEqual(restored.state.snapshot().roster, before.roster);
  restored.field.startEvent("fight");
  restored.advance(10);
  assert.deepEqual(
    restored.battle!.players.map((p) => p.id),
    ["b"],
  );
  const entry = structuredClone(restored.battle!.players);
  restored.battle!.players.forEach((player) => {
    player.hp = 0;
    player.conditionIds = [305];
  });
  restored.advance(10);
  assert.equal(restored.retryBattle(), true);
  assert.deepEqual(restored.battle!.players, entry);
  restored.battle!.enemies.forEach((enemy) => {
    enemy.hp = 0;
  });
  restored.advance(10);
  assert.equal(restored.continueVictory(), true);
  restored.advance(10);
  assert.deepEqual(restored.state.snapshot().roster[0], before.roster[0]);
  assert.deepEqual(restored.state.snapshot().party, checkpoint.owned.party);
  assert.deepEqual(
    restored.state.snapshot().equipmentStock,
    before.equipmentStock,
  );
});

test("map initializer party plus inventory commit together; a failed or stale preparation leaves both intact", () => {
  const f = setup(),
    { game } = f;
  f.target.scripts.init = [select(1), grant, exit];
  game.field.previewMap(2, 1);
  const before = game.state.snapshot(),
    from = game.field;
  const candidate = game.world.prepare(f.world, f.target);
  assert.deepEqual(game.state.snapshot(), before);
  game.state.fieldInventory.prepare({ kind: "grant-gil", amount: 1 }).commit();
  assert.equal(game.world.commit(candidate), false);
  assert.equal(game.field, from);
  assert.equal(game.state.snapshot().party.selectedSlot, 0);
  assert.deepEqual(game.state.snapshot().items, before.items);
  const current = game.state.snapshot();
  f.target.scripts.init = [
    select(1),
    grant,
    {
      ...site,
      kind: "blocked",
      mnemonic: "Unknown",
      reason: "unresolved dependency",
    },
  ];
  assert.throws(
    () => game.world.prepare(f.world, f.target),
    /unresolved dependency/,
  );
  assert.deepEqual(game.state.snapshot(), current);
  f.target.scripts.init = [select(1), grant, exit];
  assert.equal(game.world.commit(game.world.prepare(f.world, f.target)), true);
  game.advance(10);
  assert.equal(game.state.snapshot().party.selectedSlot, 1);
  assert.equal(game.state.snapshot().items[0]!.count, 3);
  const saved = game.checkpoint();
  const restored = GameSession.restore(saved, f.field, f.battle, {
    catalog: f.world,
    map: f.target,
  });
  assert.deepEqual(restored.checkpoint(), saved);
  assert.equal(restored.state.snapshot().items[0]!.count, 3);
});

test("empty and back-row parties are preserved but cannot silently enter the front-row battle profile", () => {
  for (const slot of [1, 2] as const) {
    const { game, field } = setup();
    const snapshot = game.state.snapshot();
    if (slot === 1) snapshot.party.slots[1][2].id = null;
    game.state.restore(snapshot);
    field.scripts.select = [select(slot), exit];
    game.field.startEvent("select");
    game.advance(10);
    assert.equal(game.state.snapshot().party.selectedSlot, slot);
    const before = game.state.snapshot();
    game.field.startEvent("fight");
    game.advance(10);
    assert.equal(game.field.stop?.kind, "unsupported");
    assert.equal(game.battle, null);
    assert.equal(game.state.inBattle, false);
    assert.deepEqual(game.state.snapshot(), before);
  }
});

test("disabled ownership and old owned snapshots cannot bypass the unrecovered roster lifecycle", () => {
  const { game } = setup();
  const before = game.state.snapshot();
  const disabled = structuredClone(before);
  disabled.roster[0]!.enabled = false;
  assert.throws(() => game.state.restore(disabled), /disabled roster/);
  const old = { ...before, formatVersion: 2 } as unknown as typeof before;
  assert.throws(() => game.state.restore(old), /version mismatch/);
  assert.deepEqual(game.state.snapshot(), before);
});

test("missing actor refresh support blocks source organization before either party or appearance changes", () => {
  const { game, field } = setup();
  field.scripts.organize = [
    {
      ...site,
      kind: "party",
      command: {
        kind: "organize-slot",
        slot: 0,
        members: [1001, null, null, null],
        refreshActors: true,
      },
      dependencies: [],
    },
    exit,
  ];
  const before = game.state.snapshot(),
    actor = structuredClone(game.field.player);
  game.field.startEvent("organize");
  assert.equal(game.field.stop?.kind, "unsupported");
  assert.deepEqual(game.state.snapshot(), before);
  assert.deepEqual(structuredClone(game.field.player), actor);
});

test("field decoder admits reviewed party forms and leaves extra operands and JoinCharacter blocked", () => {
  const raw = (mnemonic: string, values: number[]) => ({
    type: 1,
    mnemonic,
    operands: {
      iValues: [...values, ...Array(8 - values.length).fill(0)],
      rValues: Array(8).fill(0),
      sValues: Array(8).fill(""),
    },
  });
  assert.equal(
    decodeFieldOp(raw("ChangePartySlot", [2, 0]), site, {}).kind,
    "party",
  );
  assert.equal(
    decodeFieldOp(raw("ChangePartySlot", [2, 0, 7]), site, {}).kind,
    "blocked",
  );
  assert.equal(
    decodeFieldOp(
      raw("OrganizePartySlot", [1, 1001, -2, -2, -2]),
      site,
      {},
      { "character_status.csv": [{ id: "1001" }] },
    ).kind,
    "party",
  );
  assert.equal(
    decodeFieldOp(raw("JoinCharacter", [1001]), site, {}).kind,
    "blocked",
  );
});
