import test from "node:test";
import assert from "node:assert/strict";
import { GameCommands } from "../src/core/game-commands.js";
import { GameFlow } from "../src/core/game-flow.js";
import { GameEntryLoader } from "../src/core/game-entry-loader.js";
import { CheckpointStorage } from "../src/core/saved-game.js";
import { contentDigest } from "../src/core/content-integrity.js";
import { magicStonesSessionFixture } from "./fixtures/magic-stones-session.js";
import { sourceNewGameFixture, reservedFlag } from "./fixtures/source-new-game.js";

const host = { visible: true, mediaReady: true, overlayOpen: false };
type Game = ReturnType<ReturnType<typeof magicStonesSessionFixture>["make"]>;
const member = (game: Game, id: string) => game.state.snapshot().roster.find(row => row.id === id)!;
const skill = (game: Game, id: string, abilityId = 102) =>
  member(game, id).abilities!.owned.find(row => row.abilityId === abilityId)?.skillLevel ?? 0;
function menu(game: Game) {
  const flow = new GameFlow(game); flow.start(game, { paused: true }); flow.observeHost(host);
  return { flow, commands: new GameCommands(flow, game) };
}

test("controlled fresh initializer owns both actors, empty stones and v14 history without patching a checkpoint seed", () => {
  const f = magicStonesSessionFixture(), game = f.make(), saved = game.checkpoint();
  assert.equal(saved.owned.formatVersion, 14); assert.equal(saved.owned.initialization, "source-new-game");
  assert.ok(saved.owned.nativeState); assert.deepEqual(saved.owned.nativeState.ownedMagicStones, []);
  assert.deepEqual(saved.owned.roster.map(row => [row.id, row.sourceId, row.enabled]),
    [[f.playerIds[0], 2, true], [f.playerIds[1], 3, true]]);
  assert.ok(saved.owned.roster.every(row => row.growth?.history?.length === 0));
  assert.deepEqual(saved.origin, { kind: "source-new-game", sourceContentHash: f.content.contentHash });
  assert.equal(game.field.eventState.read(reservedFlag), 1);
  assert.equal(game.magicStoneMenu(f.playerIds[0]).available, true);
  assert.equal(game.magicStoneMenu(f.playerIds[0]).canEquip, true);
  const old = sourceNewGameFixture();
  assert.equal(old.battle.gameState.magicStones, undefined);
});

test("field acquisition is an ordered held set and equip transfer changes associations without an instant bonus", () => {
  const f = magicStonesSessionFixture(), game = f.make(), before = game.state.snapshot(), { commands } = menu(game);
  const prepared = game.state.fieldInventory.prepare({ kind: "grant-magic-stone", id: 902, count: 3 });
  assert.deepEqual(game.state.snapshot(), before); prepared.commit();
  assert.throws(prepared.commit, /Stale/);
  f.grant(game, 901, 4); f.grant(game, 902, 2);
  assert.deepEqual(game.state.snapshot().nativeState!.ownedMagicStones, [902, 901]);
  assert.equal(commands.menu({ kind: "change-magic-stone", playerId: f.playerIds[0], contentId: 901 }), true);
  assert.equal(commands.menu({ kind: "change-magic-stone", playerId: f.playerIds[1], contentId: 901 }), true);
  const transferred = game.state.snapshot();
  assert.equal(transferred.roster[0]!.magicStoneId, 0); assert.equal(transferred.roster[1]!.magicStoneId, 901);
  assert.equal(transferred.roster[0]!.abilities!.commandIds.includes(7), false);
  assert.equal(transferred.roster[1]!.abilities!.commandIds.includes(7), true);
  for (const [index, row] of transferred.roster.entries()) {
    for (const key of ["hp", "mp", "maxHp", "maxMp", "level", "exp", "equipment", "conditionIds", "ownedJobs"] as const)
      assert.deepEqual(row[key], before.roster[index]![key]);
    assert.deepEqual(row.abilities!.owned, before.roster[index]!.abilities!.owned);
    assert.deepEqual(row.growth!.additional, before.roster[index]!.growth!.additional);
    assert.equal(row.abilities!.owned.some(ability => ability.abilityId === 9101), false);
  }
  assert.deepEqual(game.magicStoneMenu(f.playerIds[0]).stones.find(stone => stone.contentId === 901)!.equippedBy,
    { id: f.playerIds[1], name: member(game, f.playerIds[1]).name });
  f.remove(game, 901, 0);
  assert.equal(member(game, f.playerIds[1]).magicStoneId, 0);
  assert.equal(member(game, f.playerIds[1]).abilities!.commandIds.includes(7), true,
    "Inventory manager clears the ID without the menu command cleanup");
  assert.equal(member(game, f.playerIds[1]).growth!.history!.at(-1)!.kind, "inventory-remove-magic-stone");
  assert.equal(commands.menu({ kind: "change-magic-stone", playerId: f.playerIds[1], contentId: 0 }), false);
  const removed = game.state.snapshot();
  f.remove(game, 901, -1);
  assert.deepEqual(game.state.snapshot(), removed, "Removing a known but unheld stone is a source manager no-op");
  assert.deepEqual(game.state.snapshot().nativeState!.ownedMagicStones, [902]);
  const after = game.state.snapshot();
  assert.throws(() => f.grant(game, 999)); assert.deepEqual(game.state.snapshot(), after);
});

test("prepared or old host commands cannot overwrite another acquisition or an active battle lease", () => {
  const f = magicStonesSessionFixture(), game = f.make(), { flow, commands } = menu(game);
  f.grant(game, 901);
  const prepared = game.state.prepareMagicStoneMenu(f.playerIds[0], 901)!;
  const before = game.state.snapshot(); assert.deepEqual(game.state.snapshot(), before);
  f.grant(game, 902); const changed = game.state.snapshot();
  assert.throws(prepared.commit, /Stale/); assert.deepEqual(game.state.snapshot(), changed);
  flow.observeHost({ ...host, visible: false });
  assert.equal(commands.menu({ kind: "change-magic-stone", playerId: f.playerIds[0], contentId: 901 }), false);
  assert.deepEqual(game.state.snapshot(), changed);
  flow.observeHost(host); assert.equal(commands.menu({ kind: "change-magic-stone", playerId: f.playerIds[0], contentId: 901 }), true);
  flow.pause(false); f.startBattle(game); const leased = game.state.snapshot();
  assert.equal(commands.menu({ kind: "change-magic-stone", playerId: f.playerIds[1], contentId: 901 }), false);
  assert.throws(() => f.grant(game, 903), /battle|idle|borrowed/i);
  assert.deepEqual(game.state.snapshot(), leased);
});

test("battle preview and private return keep learning unpublished until one ordinary result commit", () => {
  const f = magicStonesSessionFixture(), game = f.make(), state = game.state, actor = game.field.player;
  f.grant(game, 901); assert.equal(game.changeMagicStone(f.playerIds[0], 901), true);
  const before = state.snapshot(); f.startBattle(game);
  const preview = f.previewVictory(game);
  assert.equal(preview.magicPoints, 25); assert.deepEqual(state.snapshot(), before);
  assert.equal(skill(game, f.playerIds[0]), 0); assert.equal(game.state.inBattle, true);
  const pending = game.prepareBattleReturn()!; assert.ok(pending);
  assert.deepEqual(state.snapshot(), before); assert.equal(pending.commit(), true); assert.equal(pending.commit(), false);
  assert.equal(game.continueVictory(), false); game.advance(10);
  assert.equal(game.state, state); assert.equal(game.field.player, actor);
  assert.equal(skill(game, f.playerIds[0]), 50); assert.equal(skill(game, f.playerIds[1]), 0);
  assert.equal(member(game, f.playerIds[0]).level, 2); assert.equal(member(game, f.playerIds[0]).exp, 80);
  assert.equal(game.state.snapshot().completedBattles.length, 1);
  const receipt = member(game, f.playerIds[0]).growth!.history!.at(-1)!;
  assert.equal(receipt.kind, "status-up");
  if (receipt.kind === "status-up") {
    assert.equal(receipt.magicPoints, 25); assert.equal(receipt.battleSerial, 0); assert.deepEqual(receipt.steps, []);
  }
  assert.equal(game.menuAbilities(f.playerIds[0]).find(row => row.abilityId === 102)!.available, false);
});

test("second real reward masters ordinary magic and upgrades only with the equipped stone then permits a field spell", () => {
  const f = magicStonesSessionFixture(), game = f.make(); f.grant(game, 901); game.changeMagicStone(f.playerIds[0], 901);
  f.win(game); f.win(game);
  assert.equal(skill(game, f.playerIds[0]), 100); assert.equal(skill(game, f.playerIds[1]), 0);
  assert.deepEqual(game.state.snapshot().roster.map(row => [row.level, row.exp, row.maxHp, row.growth!.additional.hp]),
    [[4, 130, 155, 55], [4, 130, 150, 50]]);
  assert.equal(game.changeMagicStone(f.playerIds[0], 0), true);
  assert.equal(member(game, f.playerIds[0]).abilities!.commandIds.includes(7), true, "Mastered ordinary magic keeps its command");
  const entry = game.menuAbilities(f.playerIds[0]).find(row => row.abilityId === 102)!;
  assert.equal(entry.available, true); assert.equal(entry.cost!.mp, 5);
  const before = game.state.snapshot(), { commands } = menu(game);
  assert.equal(commands.menu({ kind: "use-ability", actorId: f.playerIds[0], abilityId: 102,
    selection: { kind: "single", id: f.playerIds[0] } }), true);
  const after = game.state.snapshot();
  assert.equal(after.roster[0]!.mp, before.roster[0]!.mp - 5); assert.ok(after.roster[0]!.hp > before.roster[0]!.hp);
  assert.ok(after.fieldRandom!.draws > before.fieldRandom!.draws);
  assert.deepEqual(after.roster[0]!.abilities, before.roster[0]!.abilities);
  assert.deepEqual(after.completedBattles, [{ serial: 0, encounterId: 1000, outcome: "victory" },
    { serial: 1, encounterId: 1000, outcome: "victory" }]);
  const checkpoint = game.checkpoint(), replay = f.restore(checkpoint);
  assert.deepEqual(replay.checkpoint(), checkpoint, "Spell resources and RNG share the complete magic-stone save");
  const next = f.startBattle(replay);
  assert.equal(next.canUse(f.playerIds[0], 102, 7), true);
  assert.ok(next.commandMenu(f.playerIds[0]).find(command => command.id === 7)!.abilityIds.includes(102));
  assert.equal(next.canUse(f.playerIds[0], 9101, 7), false, "No summon was granted as an ordinary owned spell");
});

test("save restore republishes the bound session without repeating acquisition, initialization or learning", async () => {
  const f = magicStonesSessionFixture(), game = f.make(); f.grant(game, 901); f.grant(game, 902);
  game.changeMagicStone(f.playerIds[0], 901); f.win(game);
  const { flow, commands } = menu(game), saved = game.checkpoint(), digest = await contentDigest(saved);
  const bytes = new Map<string, string>();
  const storage = new CheckpointStorage({ getItem: key => bytes.get(key) ?? null,
    setItem: (key, value) => { bytes.set(key, value); } }, "framework", "controlled-magic-stones");
  await storage.save(saved, 1); const stored = (await storage.load())!;
  assert.deepEqual(stored.checkpoint, saved);
  const loader = new GameEntryLoader(flow, { discard: () => {} });
  const prepared = loader.begin("load");
  assert.equal(commands.menu({ kind: "change-magic-stone", playerId: f.playerIds[0], contentId: 0 }), false);
  const loaded = await prepared.prepare(async () => ({ session: f.restore(stored.checkpoint), presentation: null, options: { paused: true } }));
  assert.equal(loaded.status, "committed"); const restored = flow.session;
  assert.equal(await contentDigest(restored.checkpoint()), digest);
  assert.notEqual(restored.state, game.state); assert.equal(skill(restored, f.playerIds[0]), 50);
  assert.deepEqual(restored.state.snapshot().nativeState!.ownedMagicStones, [901, 902]);
  assert.equal(restored.field.eventState.read(reservedFlag), 1);
  flow.observeHost(host); assert.equal(commands.menu({ kind: "change-magic-stone", playerId: f.playerIds[1], contentId: 901 }), false);
  assert.equal(await contentDigest(restored.checkpoint()), digest);
  assert.deepEqual(game.checkpoint(), saved);
  f.win(restored); assert.equal(skill(restored, f.playerIds[0]), 100);
  assert.equal(restored.state.snapshot().completedBattles.length, 2);
  assert.equal(member(restored, f.playerIds[0]).growth!.history!.filter(row => row.kind === "status-up").length, 2);
  const complete = restored.checkpoint(), replay = f.restore(complete);
  assert.deepEqual(replay.checkpoint(), complete); assert.equal(skill(replay, f.playerIds[0]), 100);
});

test("ordinary walking escape returns resources once without magic points, skill progress or level growth", () => {
  const f = magicStonesSessionFixture(), game = f.make(); f.grant(game, 901); game.changeMagicStone(f.playerIds[0], 901);
  const before = game.state.snapshot(); f.escape(game);
  const after = game.state.snapshot();
  assert.equal(game.continueEscape(), false); assert.equal(skill(game, f.playerIds[0]), 0);
  assert.equal(after.gil, before.gil); assert.deepEqual(after.nativeState!.ownedMagicStones, [901]);
  for (const [index, row] of after.roster.entries()) {
    assert.equal(row.level, before.roster[index]!.level); assert.equal(row.exp, before.roster[index]!.exp);
    assert.equal(row.magicLearningValue, before.roster[index]!.magicLearningValue);
    assert.deepEqual(row.growth, before.roster[index]!.growth); assert.deepEqual(row.abilities, before.roster[index]!.abilities);
  }
  assert.deepEqual(after.completedBattles, [{ serial: 0, encounterId: 1000, outcome: "escaped" }]);
  assert.deepEqual(f.restore(game.checkpoint()).state.snapshot(), after);
});

test("source roster, held IDs and complete growth receipts reject forged save histories atomically", () => {
  const f = magicStonesSessionFixture(), game = f.make(); f.grant(game, 901); game.changeMagicStone(f.playerIds[0], 901);
  f.win(game); f.win(game); const saved = game.state.snapshot();
  const changes: ((state: typeof saved) => void)[] = [
    state => { state.nativeState = null; }, state => { state.nativeState!.ownedMagicStones = []; },
    state => { state.nativeState!.ownedMagicStones.push(901); }, state => { state.nativeState!.ownedMagicStones.push(999); },
    state => { state.roster[0]!.sourceId = 1; }, state => { state.roster[0]!.growth!.history = []; },
    state => { state.roster[0]!.magicStoneId = 902; },
    state => { const row = state.roster[0]!.growth!.history!.filter(row => row.kind === "status-up").at(-1)!;
      if (row.kind === "status-up") row.magicPoints = 1; },
    state => { const row = state.roster[0]!.growth!.history!.filter(row => row.kind === "status-up").at(-1)!;
      if (row.kind === "status-up") row.battleSerial = 99; },
    state => { const row = state.roster[0]!.growth!.history!.filter(row => row.kind === "status-up").at(-1)!;
      if (row.kind === "status-up") row.steps[0]!.additional.hp++; },
    state => { state.roster[0]!.abilities!.owned.find(row => row.abilityId === 102)!.skillLevel = 99; },
    state => { state.formatVersion = 13; },
  ];
  for (const change of changes) {
    const bad = structuredClone(saved); change(bad);
    assert.throws(() => game.state.restore(bad)); assert.deepEqual(game.state.snapshot(), saved);
  }
  const checkpoint = game.checkpoint(), bad = structuredClone(checkpoint);
  bad.owned.completedBattles[0]!.outcome = "escaped";
  assert.throws(() => f.restore(bad)); assert.deepEqual(game.checkpoint(), checkpoint);
});

test("source roster removal journals its low-level stone clear while retaining global ownership and magic commands", () => {
  const f = magicStonesSessionFixture(), game = f.make(), id = f.playerIds[1];
  f.grant(game, 901); assert.equal(game.changeMagicStone(id, 901), true);
  const before = game.state.snapshot();
  const candidate = game.state.fieldRoster.prepare({ kind: "secede", sourceId: 3,
    removeEquipment: true, refreshActors: true });
  assert.deepEqual(game.state.snapshot(), before);
  candidate.commit();
  const after = game.state.snapshot(), removed = member(game, id);
  assert.equal(removed.enabled, false); assert.equal(removed.magicStoneId, 0);
  assert.equal(removed.abilities!.commandIds.includes(7), true);
  assert.equal(removed.growth!.history!.at(-1)!.kind, "inventory-remove-magic-stone");
  assert.deepEqual(after.nativeState!.ownedMagicStones, [901]);
  assert.deepEqual(removed.abilities!.owned, before.roster.find(row => row.id === id)!.abilities!.owned);
  assert.throws(candidate.commit, /Stale/);
  game.state.restore(after); assert.deepEqual(game.state.snapshot(), after);
});
