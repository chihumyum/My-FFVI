import assert from "node:assert/strict";
import test from "node:test";
import { GameSession } from "../src/core/game-session.js";
import { NewGameFieldEntry } from "../src/core/new-game-field-entry.js";
import { sourceNewGameFixture } from "./fixtures/source-new-game.js";
import { fieldMenuReadyFixture } from "./fixtures/field-menu-ready.js";

function assertMenuBlocked(game: GameSession) {
  const before = game.state.snapshot();
  assert.equal(game.menuReady, false);
  assert.equal(game.checkpointReady, false);
  assert.equal(game.useMenuItem(10, "a"), false);
  assert.equal(game.changeEquipment("a", 5, 5), false);
  assert.deepEqual(game.state.snapshot(), before);
  assert.throws(() => game.checkpoint(), /Cannot save/);
}

test("an ordinary empty map keeps both menu and checkpoint availability", () => {
  const f = fieldMenuReadyFixture(false), { game } = f;
  assert.equal(game.menuReady, true); assert.equal(game.checkpointReady, true);
  assert.equal(game.useMenuItem(10, "a"), true);
  assert.equal(game.changeEquipment("a", 5, 5), true);
  const checkpoint = game.checkpoint();
  const restored = GameSession.restore(checkpoint, f.field, f.catalog, undefined, f.runtime);
  assert.equal(restored.menuReady, true); assert.equal(restored.checkpointReady, true);
  assert.deepEqual(restored.checkpoint(), checkpoint);
});

test("stable effects permit owned menu transactions without permitting an unsupported save", () => {
  const { game, control } = fieldMenuReadyFixture(), effects = structuredClone(control.state), commits = control.commits;
  assert.equal(game.field.menuReady, true); assert.equal(game.menuReady, true);
  assert.equal(game.checkpointReady, false); assert.throws(() => game.checkpoint(), /Cannot save/);
  assert.equal(game.useMenuItem(10, "a"), true);
  assert.equal(game.players.find((p) => p.id === "a")!.hp, 110);
  assert.deepEqual(game.state.snapshot().items, [{ id: 10, count: 1 }]);
  assert.equal(game.changeEquipment("a", 5, 5), true);
  assert.equal(game.state.equipmentInventory.find((item) => item.id === 501)!.available, 1);
  assert.deepEqual(control.state, effects); assert.equal(control.commits, commits);
  assert.equal(game.checkpointReady, false);
});

test("an empty next map keeps menus despite shared effect history and retires the old menu lease", () => {
  const { game, control, world, target } = fieldMenuReadyFixture(), old = game.field;
  game.field.previewMap(2, 1);
  assert.equal(game.world.commit(game.world.prepare(world, target)), true);
  game.advance(20);
  assert.equal(old.menuReady, false, "a retired map must never advertise a current owned-state interaction");
  assert.equal(game.field.fieldEffectsSnapshot, null);
  assert.equal(control.state.instanceCount, 1); assert.deepEqual(control.state.players, []);
  assert.equal(game.menuReady, true); assert.equal(game.checkpointReady, false);
  assert.equal(game.useMenuItem(10, "a"), true);
  assert.equal(game.changeEquipment("a", 5, 5), true);
  assert.throws(() => game.checkpoint(), /Cannot save/);
});

for (const gate of ["movement", "script", "dialogue", "fade", "stopped", "unsynchronized-entry", "map-transition"] as const) {
  test(`effect save restrictions do not relax the ${gate} menu gate`, () => {
    const { game } = fieldMenuReadyFixture(true, (field) => {
      if (gate === "unsynchronized-entry") field.entry.synchronization = { kind: "map-entry" };
    });
    if (gate === "movement") assert.equal(game.field.move("down"), true);
    if (gate === "script") game.field.startEvent("waiting");
    if (gate === "dialogue") game.field.startEvent("dialogue");
    if (gate === "fade") game.field.fader.start({ kind: "field-fade", direction: "out", seconds: 1, color: { r: 0, g: 0, b: 0, a: 1 } });
    if (gate === "stopped") game.field.startEvent("blocked");
    if (gate === "map-transition") game.field.previewMap(2, 1);
    assertMenuBlocked(game);
    if (gate === "movement" || gate === "script") {
      game.advance(gate === "movement" ? 240 : 1000);
      assert.equal(game.menuReady, true); assert.equal(game.checkpointReady, false);
    }
  });
}

test("battle ownership and pending victory continuation still exclude every menu mutation", () => {
  const { game } = fieldMenuReadyFixture();
  game.field.startEvent("fight"); game.advance(10);
  assert.equal(game.battle?.phase, "active"); assertMenuBlocked(game);
  for (const enemy of game.battle!.enemies) enemy.hp = 0;
  game.advance(10);
  assert.equal(game.battle!.phase, "victory"); assertMenuBlocked(game);
  assert.equal(game.continueVictory(), true); assertMenuBlocked(game);
  game.advance(10);
  assert.equal(game.menuReady, true); assert.equal(game.checkpointReady, false);
});

test("fresh native preparation cannot enable menus before its title and entry protocol completes", () => {
  const f = sourceNewGameFixture(), entry = new NewGameFieldEntry(f.content.entry, f.presentation);
  const start = entry.prepareStart(f.fade, { active: true, callbacks: "absent" }); start.commit();
  let fade = start.fade; fade.advance(0.5);
  for (let i = 0; i < 3; i++) { const step = entry.prepareResume(fade, true)!; step.commit(); fade = step.fade; }
  const game = GameSession.prepareNewGame(f.content, f.world, f.map, f.battle, fade, f.presentation);
  assert.equal(game.menuReady, false); assert.equal(game.checkpointReady, false);
  const launch = entry.prepareLaunch(fade, game.newGamePreparation(true)); game.launchNewGame(launch.launch); launch.commit();
  assert.equal(game.menuReady, false);
  game.advance(10);
  assert.equal(game.menuReady, true); assert.equal(game.checkpointReady, true);
});
