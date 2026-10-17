import test from "node:test";
import assert from "node:assert/strict";
import { PlayGame } from "./game.js";

function fixture(entities, groups = {}) {
  const game = new PlayGame({ data: { programs: {}, fieldAssets: {} } });
  Object.assign(game, {
    mapId: 19,
    map: { width: 40, height: 45, entities, groups },
    triggered: new Set(),
  });
  Object.assign(game.player, { x: 20, y: 10, layer: 1 });
  return game;
}

test("source defense deployment retires preparation bodies while retaining the battle group", () => {
  const preview = { id: "57", kind: 6, x: 20, y: 11, layer: 1, npc: { collision: true } };
  const controls = { ...preview, id: "52", kind: 5, npc: undefined, collision: true };
  const goal = { ...preview, id: "64", x: 20, y: 7, asset: "mo_ff6_p017" };
  const game = fixture([], {
    ev_e_0250: { entities: [preview, controls] },
    ev_e_0257: { entities: [goal] },
  });
  game.groups = new Set(["entity_default", "ev_e_0250", "ev_e_0257"]);
  game.refreshActors();
  assert.equal(game.canMove(20, 11), false);
  game.syscall({ locals: [], pc: 0 }, "パーティ配置：幻獣防衛戦", [], []);
  assert.equal(game.canMove(20, 11), true);
  assert.equal(game.groups.has("ev_e_0250"), false);
  assert.equal(game.groups.has("ev_e_0257"), true);
  assert.equal(game.actors.get("57").visible, false, "no preview sprite remains after deployment");
  assert.equal(game.actors.get("64").visible, true);
  assert.equal(game.rts.protectedId, 15, "the source character ID remains Banon");
});

test("defense enemies find the protected character through PR field asset mapping", () => {
  const enemy = { id: "38", kind: 6, x: 20, y: 9, layer: 1, npc: { moveType: 3 } };
  const game = fixture([enemy]);
  game.data.fieldAssets[15] = { character_id: 15, asset_name: "mo_ff6_p017" };
  Object.assign(game.player, { x: 36, y: 36 });
  game.refreshActors();
  game.actors.set("64", { id: 64, x: 20, y: 7, layer: 1, asset: "mo_ff6_p017", visible: true });
  game.actors.set("decoy", { id: 65, x: 5, y: 5, layer: 1, asset: "mo_ff6_p015", visible: true });
  game.rts = { active: true, protectedId: 15, loseOnContact: true };
  game.tickNpc(0.65);
  assert.equal(game.actors.get("38").x, 20);
  assert.equal(game.actors.get("38").y, 8);
  assert(game.over, "reaching the real protected character ends the defense");
});
