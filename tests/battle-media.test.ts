import test from "node:test";
import assert from "node:assert/strict";
import { battleMediaUrls } from "../src/core/game-content.js";
import { GameSession } from "../src/core/game-session.js";
import { GameFlow } from "../src/core/game-flow.js";
import { GameBattleHandoff } from "../src/core/game-battle-handoff.js";
import { fixture } from "./fixtures/battle-content.js";
import { participantFixture, participantLoop } from "./fixtures/battle-participant-game.js";
import { playerSessionFixture } from "./fixtures/battle-player-game.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";
import { appearanceFixture } from "./fixtures/battle-appearance.js";

const sprite = (file: string) => ({ file, width: 32, height: 32 });
const ready = { visible: true, mediaReady: true, overlayOpen: false };

test("encounter media includes registered late enemies and deduplicates files without reading unrelated library entries", () => {
  const content = participantFixture(), late = content.participants!.enemyDefinitions[341]!;
  content.sprites = { synthetic: sprite("entry.png"), late: sprite("late.png"),
    mount: sprite("late.png"), unrelated: { file: "broken-unused.png", width: 0, height: 0 } };
  late.sprites = { idle: "late", mount: "mount" };
  assert.deepEqual(battleMediaUrls(content), ["entry.png", "late.png"]);
  delete content.sprites.late;
  assert.throws(() => battleMediaUrls(content), /Missing battle media reference: late/);
});

test("every exact owned appearance pose and armor frame is prepared before a player can change appearance", () => {
  const content = fixture(), appearance = appearanceFixture();
  content.sprites.synthetic = sprite("entry.png"); content.battleAppearance = appearance.catalog;
  const player = { ...content.players[0]!, appearance: appearance.actor };
  for (const [key, geometry] of Object.entries(appearance.sprites))
    content.sprites[key] = { file: key + ".png", width: geometry.width, height: geometry.height };
  const required = battleMediaUrls(content, [player]);
  assert.deepEqual(new Set(required), new Set(["entry.png", ...Object.keys(appearance.sprites).map(key => key + ".png")]));
  const missing = appearance.actor.bodySprites.walk1!; delete content.sprites[missing];
  assert.throws(() => battleMediaUrls(content, [player]), /Missing battle media reference/);
});

test("the prepared lease supplies late owned players while unrelated unborrowed templates create no dependency", () => {
  for (const borrow of [false, true]) {
    const f = playerSessionFixture(), guest = f.battle.common.players.find(player => player.sourceId === 33)!;
    guest.sprites.idle = "guest"; f.battle.common.sprites.guest = sprite("guest.png");
    if (!borrow) {
      delete f.battle.encounters[1000]!.playerParticipants;
      f.battle.encounters[1000]!.lifecycle = { kind: "battle-lifecycle-v1", mode: "script", scriptId: 1,
        program: participantLoop() };
    }
    const game = new GameSession(f.field, f.battle, 31, { battleHandoff: "prepared" });
    game.field.startEvent("fight"); const before = game.state.snapshot(), pending = game.prepareBattleStart()!;
    assert.equal(pending.mediaUrls.includes("guest.png"), borrow);
    const mutated = pending.mediaUrls as string[]; mutated.push("invented.png");
    assert.equal(pending.mediaUrls.includes("invented.png"), false);
    pending.discard(); assert.deepEqual(game.state.snapshot(), before); assert.equal(game.state.inBattle, false);
    assert.throws(() => pending.mediaUrls, /Stale battle lease/);
  }
});

test("missing required media fails the host preparation without publishing battle or consuming owned resources", async () => {
  const f = checkpointFixture(), game = new GameSession(f.field, f.battle, 31, { battleHandoff: "prepared" }),
    flow = new GameFlow(game);
  flow.start(); flow.advance(0, ready); game.field.startEvent("fight");
  const request = game.field.stop, before = game.state.snapshot();
  const handoff = new GameBattleHandoff(flow, { prepareStart: async candidate => [...candidate.mediaUrls],
    prepareReturn: async () => [], discard: () => {} });
  const failed = await handoff.start(); assert.equal(failed.status, "failed");
  if (failed.status !== "failed") assert.fail("Missing media should fail");
  assert.match(String(failed.error), /Missing battle media reference/);
  assert.equal(game.battle, null); assert.equal(game.state.inBattle, false); assert.equal(game.field.stop, request);
  assert.deepEqual(game.state.snapshot(), before); assert.equal(flow.busy, false);
  f.battle.common.sprites.synthetic = sprite("repaired.png");
  const repaired = await handoff.start(); assert.equal(repaired.status, "committed");
  if (repaired.status !== "committed") assert.fail("Repaired media should publish");
  assert.deepEqual(repaired.presentation, ["repaired.png"]); assert.equal(game.field.stop, request);
  assert.deepEqual(game.state.snapshot(), before); assert.equal(game.state.inBattle, true);
});
