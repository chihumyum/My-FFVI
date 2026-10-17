import test from "node:test";
import assert from "node:assert/strict";
import { GameSession, type PreparedSessionBattleReturn } from "../src/core/game-session.js";
import type { BattleHandoffContent } from "../src/core/battle-handoff-content.js";
import { NewGameFieldEntry } from "../src/core/new-game-field-entry.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";
import { playerSessionFixture } from "./fixtures/battle-player-game.js";
import { walkEncounterFixture } from "./fixtures/walk-encounter-game.js";
import { sourceNewGameFixture } from "./fixtures/source-new-game.js";

function setup(data: Pick<ReturnType<typeof checkpointFixture>, "field" | "battle"> = checkpointFixture()) {
  const game = new GameSession(data.field, data.battle, 627, { battleHandoff: "prepared" });
  assert.equal(game.field.startEvent("fight"), true);
  game.advance(10);
  assert.equal(game.field.stop?.kind, "encounter"); assert.equal(game.battle, null);
  return { ...data, game };
}
function start(game: GameSession) {
  const candidate = game.prepareBattleStart(); assert.ok(candidate);
  assert.equal(candidate.commit(), true); assert.ok(game.battle);
  return game.battle;
}
function win(game: GameSession) {
  for (let frame = 0; frame < 20000 && game.battle?.phase === "active"; frame++) {
    for (const actor of game.battle.ready) {
      const target = game.battle.targets(actor.id, 10)[0];
      if (target) game.battle.command(actor.id, 10, target.id);
    }
    game.advance(10);
  }
  assert.equal(game.battle?.phase, "victory");
}
function defeat(game: GameSession) {
  for (const player of game.battle!.players) { player.hp = 0; player.conditionIds = [305]; }
  for (let n = 0; n < 20 && game.battle?.phase === "active"; n++) game.advance(10);
  assert.equal(game.battle?.phase, "defeat");
}
function fieldSnapshot(game: GameSession) {
  return { owned: game.state.snapshot(), events: game.field.eventState.snapshot(), time: game.field.time,
    fade: game.field.fader.snapshot(), bgm: game.field.bgm.snapshot(), environment: game.field.environment.snapshot(),
    sound: game.field.se.snapshot(), stop: structuredClone(game.field.stop) };
}

test("synchronous compatibility preserves admitted ticks after entry across frame partitions", () => {
  const whole = checkpointFixture(), split = checkpointFixture();
  const a = new GameSession(whole.field, whole.battle, 627);
  const b = new GameSession(split.field, split.battle, 627);
  assert.equal(a.field.startEvent("fight"), true); assert.equal(b.field.startEvent("fight"), true);
  a.advance(60);
  for (let n = 0; n < 6; n++) b.advance(10);
  assert.ok(a.battle); assert.ok(b.battle);
  assert.equal(a.battle.time, 50);
  assert.equal(b.battle.time, 50);
  assert.deepEqual(a.battle.players, b.battle.players);
  assert.deepEqual(a.battle.enemies, b.battle.enemies);
  assert.deepEqual(a.state.snapshot(), b.state.snapshot());
});

test("prepared start holds the exact encounter and shared lease without constructing or advancing an active battle", () => {
  const { game } = setup(), request = game.field.stop, before = fieldSnapshot(game);
  game.field.bgm.play(1, 0, 0, 0, game.field.content.bgm);
  const audio = game.field.bgm.snapshot(), candidate = game.prepareBattleStart(); assert.ok(candidate);
  assert.equal(candidate.kind, "start"); assert.equal(candidate.publicationStarted, false);
  assert.equal(game.battle, null); assert.equal(game.state.inBattle, true);
  assert.equal(game.menuReady, false); assert.equal(game.checkpointReady, false);
  assert.equal(game.prepareBattleStart(), null);
  game.advance(60000); game.advance(9);
  assert.equal(game.battle, null); assert.equal(game.field.stop, request);
  assert.equal(game.field.time, before.time); assert.deepEqual(game.field.bgm.snapshot(), audio);
  assert.deepEqual(game.state.snapshot(), before.owned);
  candidate.validate(); assert.equal(candidate.commit(), true);
  assert.equal(candidate.publicationStarted, true); assert.equal(game.battle!.time, 0);
  game.advance(1); assert.equal(game.battle!.time, 0, "host preparation elapsed is never caught up in battle");
  assert.equal(candidate.commit(), false); candidate.discard();
  assert.throws(candidate.validate, /Stale session battle handoff/);
});

test("public request and content views never alias the host, selected catalog or private battle entry", () => {
  const { game, battle } = setup(), request = game.field.stop, candidate = game.prepareBattleStart(); assert.ok(candidate);
  const view = candidate.content; view.players[0]!.hp = 1; view.enemies.length = 0; view.abilities = {};
  candidate.request.party = 9999; candidate.request.continuation = "missing";
  game.battleStartRequest!.party = 9999;
  assert.notEqual(candidate.request, request); assert.notEqual(candidate.content, view);
  assert.equal(candidate.request.party, 1000); assert.equal(candidate.request.continuation, "after");
  battle.common.players[0]!.hp = 1;
  assert.equal(candidate.commit(), true);
  assert.equal(game.battle!.players[0]!.hp, 80); assert.equal(game.battle!.enemies.length, 2);
  assert.equal(game.field.stop, request);
});

test("discard is idempotent, cancels only a new start lease and cannot cancel a newer candidate", () => {
  const { game } = setup(), request = game.field.stop, before = game.state.snapshot();
  const old = game.prepareBattleStart(); assert.ok(old); old.discard(); old.discard();
  assert.equal(game.state.inBattle, false); assert.equal(game.battle, null); assert.equal(game.field.stop, request);
  const next = game.prepareBattleStart(); assert.ok(next); assert.equal(game.state.inBattle, true);
  old.discard(); assert.equal(old.commit(), false); assert.equal(game.state.inBattle, true);
  assert.equal(next.commit(), true); assert.deepEqual(game.state.snapshot(), before);
});

test("a replaced identical request is stale by reference and cannot silently redirect a prepared start", () => {
  const { game } = setup(), candidate = game.prepareBattleStart(); assert.ok(candidate);
  const replacement = structuredClone(game.field.stop); game.field.stop = replacement;
  assert.throws(candidate.validate, /Stale session battle handoff/);
  assert.equal(candidate.commit(), false); assert.equal(candidate.publicationStarted, false);
  assert.equal(game.state.inBattle, false); assert.equal(game.field.stop, replacement); assert.equal(game.battle, null);
  assert.equal(game.prepareBattleStart()!.commit(), true);
});

test("constructor failure at commit releases its private lease and retains a scripted request for an unchanged-seed retry", () => {
  const data = checkpointFixture(); data.battle.encounters[1000]!.enemies[0]!.conditionIds = [9999];
  const { game } = setup(data), request = game.field.stop, before = game.state.snapshot();
  const failed = game.prepareBattleStart(); assert.ok(failed);
  assert.equal(game.battle, null); assert.equal(game.state.inBattle, true);
  assert.throws(failed.commit, /condition|Unknown/i); assert.equal(failed.publicationStarted, false);
  assert.equal(game.field.stop, request); assert.equal(game.state.inBattle, false); assert.equal(game.battle, null);
  assert.deepEqual(game.state.snapshot(), before); assert.match(game.encounterPreparationError!, /condition|Unknown/i);
  assert.equal(game.retryEncounterPreparation(), false, "prepared sessions do not use the synchronous compatibility entry");
  data.battle.encounters[1000]!.enemies[0]!.conditionIds = [];
  const retry = game.prepareBattleStart(); assert.ok(retry); failed.discard(); assert.equal(retry.commit(), true);
  const control = setup(); start(control.game);
  assert.deepEqual(game.battle!.combatants, control.game.battle!.combatants);
  win(game); assert.equal(game.prepareBattleReturn()!.commit(), true);
  game.advance(10);
  assert.equal(game.checkpoint().encounterSerial, 1);
});

test("unavailable scripted content remains retryable before any owned lease is opened", () => {
  const data = checkpointFixture(), encounter = data.battle.encounters[1000]!;
  delete data.battle.encounters[1000];
  const { game } = setup(data), request = game.field.stop, before = game.state.snapshot();
  assert.throws(() => game.prepareBattleStart(), /unavailable.*1000/);
  assert.equal(game.field.stop, request); assert.equal(game.state.inBattle, false); assert.deepEqual(game.state.snapshot(), before);
  data.battle.encounters[1000] = encounter;
  assert.equal(game.prepareBattleStart()!.commit(), true); assert.equal(game.encounterPreparationError, null);
});

test("defeat retry retains the same lease, entry seed, borrowed roster and shared state while discard keeps the defeated battle", () => {
  const { game } = setup(playerSessionFixture([{ kind: "add-player", sourceId: 33 }])), owned = game.state.snapshot();
  const initial = start(game), initialPlayers = structuredClone(initial.players), shared = initial.eventSharedEntry;
  game.advance(40); assert.ok(initial.players.some(player => player.sourceId === 33));
  defeat(game);
  const retry = game.prepareBattleRetry(); assert.ok(retry); assert.equal(retry.kind, "retry");
  const time = initial.time; game.advance(60000);
  assert.equal(initial.time, time); assert.equal(game.battle, initial);
  retry.discard(); assert.equal(game.battle, initial); assert.equal(game.state.inBattle, true);
  assert.equal(game.retryBattle(), false);
  initial.content.playerParticipants!.groups.splice(0); initial.content.playerParticipants!.sourceIds.splice(0);
  const next = game.prepareBattleRetry(); assert.ok(next); retry.discard(); assert.equal(next.commit(), true);
  assert.notEqual(game.battle, initial); assert.deepEqual(game.battle!.players, initialPlayers);
  assert.deepEqual(game.battle!.eventSharedEntry, shared); assert.equal(game.battle!.playerExecution!.nextGeneration, 1);
  assert.deepEqual(game.state.snapshot(), owned);
  game.advance(40); assert.ok(game.battle!.players.some(player => player.sourceId === 33));
  win(game); assert.equal(game.prepareBattleReturn()!.commit(), true);
  game.advance(10);
  assert.equal(game.checkpoint().encounterSerial, 1); assert.equal(game.state.snapshot().completedBattles.length, 1);
});

test("victory preparation and discard retain the terminal result, then commit resources, receipt and continuation once", () => {
  const { game } = setup(), before = game.state.snapshot(), request = game.field.stop;
  start(game); win(game); const terminal = game.battle!;
  const candidate = game.prepareBattleReturn(); assert.ok(candidate);
  assert.equal(candidate.kind, "return"); assert.equal(candidate.outcome, "victory");
  assert.equal(game.continueVictory(), false); assert.equal(game.continueEscape(), false);
  game.battleReturnRequest!.request.continuation = "missing"; candidate.request.party = 99;
  const waiting = fieldSnapshot(game), time = terminal.time; game.advance(60000);
  assert.deepEqual(fieldSnapshot(game), waiting); assert.equal(terminal.time, time);
  assert.deepEqual(game.state.snapshot(), before); assert.equal(game.field.stop, request);
  candidate.discard(); assert.equal(game.battle, terminal); assert.ok(terminal.previewVictory());
  const next = game.prepareBattleReturn(); assert.ok(next); candidate.discard();
  assert.equal(next.commit(), true); assert.equal(next.publicationStarted, true);
  assert.equal(game.battle, null); assert.equal(game.state.inBattle, false); assert.equal(game.field.stop, null);
  assert.equal(game.state.snapshot().completedBattles.length, 1); assert.equal(game.gil, before.gil + 14);
  assert.equal(next.commit(), false); assert.equal(game.prepareBattleReturn(), null);
  assert.notEqual(game.field.flags.ScenarioFlag1?.[1], true, "return schedules rather than executes the continuation");
  game.advance(10); assert.equal(game.field.flags.ScenarioFlag1?.[1], true);
});

test("return preparation failure and later validation failure preserve the result and allow a fresh candidate", () => {
  const { game } = setup(), before = game.state.snapshot(); start(game); win(game);
  const terminal = game.battle!, field = game.field, request = field.stop, script = field.content.scripts.after!;
  delete field.content.scripts.after;
  assert.throws(() => game.prepareBattleReturn(), /Missing battle continuation/);
  assert.equal(game.battle, terminal); assert.equal(game.state.inBattle, true); assert.deepEqual(game.state.snapshot(), before);
  field.content.scripts.after = script;
  const prepare = field.prepareEncounterReturn;
  let fail = true;
  field.prepareEncounterReturn = function(...args) {
    const publication = prepare.apply(this, args), validate = publication.validate;
    publication.validate = () => { if (fail) throw new Error("Controlled late actor validation"); validate(); };
    return publication;
  };
  const candidate = game.prepareBattleReturn(); assert.ok(candidate);
  assert.throws(candidate.commit, /Controlled late actor validation/); assert.equal(candidate.publicationStarted, false);
  assert.equal(game.battle, terminal); assert.equal(field.stop, request); assert.equal(game.state.inBattle, true);
  assert.deepEqual(game.state.snapshot(), before);
  fail = false; const retry = game.prepareBattleReturn(); assert.ok(retry); candidate.discard();
  assert.equal(retry.commit(), true); assert.equal(game.state.snapshot().completedBattles.length, 1);
});

test("terminal resources changed after preparation make that candidate stale without publishing its receipt", () => {
  const { game } = setup(), before = game.state.snapshot(); start(game); win(game);
  const terminal = game.battle!, candidate = game.prepareBattleReturn(); assert.ok(candidate);
  terminal.players[0]!.mp--;
  assert.throws(candidate.validate, /Stale session battle handoff/); assert.equal(candidate.commit(), false);
  assert.equal(game.battle, terminal); assert.equal(game.state.inBattle, true); assert.deepEqual(game.state.snapshot(), before);
  assert.equal(game.prepareBattleReturn()!.commit(), true);
  assert.equal(game.players[0]!.mp, terminal.players[0]!.mp);
});

test("cancellation inside commitWith's final checks is still reversible before the owned callback", () => {
  const { game } = setup(), before = game.state.snapshot(); start(game); win(game);
  const field = game.field, request = field.stop, terminal = game.battle!, prepare = field.prepareEncounterReturn;
  let candidate: PreparedSessionBattleReturn | null = null;
  field.prepareEncounterReturn = function(...args) {
    const publication = prepare.apply(this, args), commit = publication.commitWith;
    publication.commitWith = owned => { candidate!.discard(); commit(owned); };
    return publication;
  };
  candidate = game.prepareBattleReturn(); assert.ok(candidate);
  assert.equal(candidate.commit(), false); assert.equal(candidate.publicationStarted, false);
  assert.equal(game.battle, terminal); assert.equal(field.stop, request); assert.equal(game.state.inBattle, true);
  assert.deepEqual(game.state.snapshot(), before);
  field.prepareEncounterReturn = prepare; assert.equal(game.prepareBattleReturn()!.commit(), true);
});

test("discard is refused during owned publication and publicationStarted remains sticky after success or a later exception", () => {
  for (const throwAfterPublication of [false, true]) {
    const { game } = setup(); start(game); win(game);
    const prepare = game.field.prepareEncounterReturn;
    let candidate: PreparedSessionBattleReturn | null = null;
    game.field.prepareEncounterReturn = function(...args) {
      const publication = prepare.apply(this, args), commit = publication.commitWith;
      publication.commitWith = owned => {
        commit(() => {
          owned(); assert.equal(candidate!.publicationStarted, true);
          assert.equal(candidate!.commit(), false, "reentrant commit cannot publish a second owned transaction");
          assert.throws(() => candidate!.discard(), /publication has started/);
        });
        if (throwAfterPublication) throw new Error("Controlled post-publication failure");
      };
      return publication;
    };
    candidate = game.prepareBattleReturn(); assert.ok(candidate);
    if (throwAfterPublication) assert.throws(candidate.commit, /Controlled post-publication/);
    else assert.equal(candidate.commit(), true);
    assert.equal(candidate.publicationStarted, true); assert.equal(candidate.commit(), false); candidate.discard();
    assert.equal(game.state.snapshot().completedBattles.length, 1);
  }
});

test("ordinary escape uses the same prepared return but grants no victory receipt, currency or growth", () => {
  const data = walkEncounterFixture(1);
  data.battle.encounters[1000]!.escapePolicy = { kind: "framework-battle-escape-v1", id: "prepared-escape" };
  const game = new GameSession(data.field, data.battle, 627, { battleHandoff: "prepared" }), before = game.state.snapshot();
  assert.equal(game.field.move("right"), true); game.advance(240); const request = game.field.stop;
  assert.equal(request?.kind, "encounter"); assert.equal(game.battle, null); start(game);
  game.battle!.players[0]!.hp = 17; game.battle!.players[0]!.mp = 3;
  assert.equal(game.requestEscape(), true); game.advance(10); assert.equal(game.battle!.phase, "escaped");
  const candidate = game.prepareBattleReturn(); assert.ok(candidate); assert.equal(candidate.outcome, "escaped");
  candidate.discard(); assert.equal(game.field.stop, request); assert.equal(game.state.inBattle, true);
  assert.equal(game.prepareBattleReturn()!.commit(), true); assert.equal(game.gil, before.gil);
  assert.deepEqual(game.completedEncounters, []); assert.deepEqual(game.state.snapshot().completedBattles,
    [{ serial: 0, encounterId: 1000, outcome: "escaped" }]);
  assert.deepEqual([game.players[0]!.hp, game.players[0]!.mp], [17, 3]);
});

function handoffContent(): BattleHandoffContent {
  const row = (id: number, table: string) => ({ file: "synthetic", assetPath: "controlled/" + table, serializedFile: "controlled",
    objectId: "9007199254740993", rowId: String(id) });
  return { kind: "battle-handoff-content-v1", source: { encounterId: 1000, row: row(1000, "monster_party.csv"),
    metadata: { backgroundId: 1, bgmId: 0, appearanceProduction: 0, notEscape: 0 }, dependencies: [
      { table: "monster_party.csv", id: 1000, binding: "bound", source: row(1000, "monster_party.csv") },
      { table: "battle_background_asset.csv", id: 1, binding: "bound", source: row(1, "battle_background_asset.csv") },
    ] }, policy: { kind: "framework-battle-handoff-v1", id: "controlled-only", audio: "retain-field", introduction: "omit" } };
}
function fresh(profile: "source" | "framework") {
  const f = sourceNewGameFixture(), declaration = { kind: "framework-development-v1" as const,
    policy: "omit-anonymous-environment-particles-v1" as const, sourceContentHash: "a".repeat(64), omissions: [] };
  if (profile === "framework") {
    f.content.developmentProfile = structuredClone(declaration); f.world.developmentProfile = structuredClone(declaration);
    f.map.developmentProfile = structuredClone(declaration);
  }
  f.map.scripts.reserved = [{ kind: "encounter", party: 1000, continuation: "fallback",
    script: "reserved", index: 0, source: f.source }];
  const entry = new NewGameFieldEntry(f.content.entry, f.presentation), first = entry.prepareStart(f.fade,
    { active: true, callbacks: "absent" }); first.commit(); let fade = first.fade; fade.advance(0.5);
  for (let n = 0; n < 3; n++) { const next = entry.prepareResume(fade, true)!; next.commit(); fade = next.fade; }
  const game = GameSession.prepareNewGame(f.content, f.world, f.map, f.battle, fade, f.presentation,
    { battleHandoff: "prepared", audioReadiness: { isReady: () => true } });
  const launch = entry.prepareLaunch(fade, game.newGamePreparation(true)); game.launchNewGame(launch.launch); launch.commit();
  assert.equal(game.field.stop?.kind, "encounter"); return { ...f, game };
}

test("source origin cannot acquire native handoff from a development policy or a ready audio provider", () => {
  const f = fresh("source"), before = f.game.state.snapshot(), request = f.game.field.stop;
  f.battle.encounters[1000]!.handoff = handoffContent();
  assert.throws(() => f.game.prepareBattleStart(), /verified native contract/);
  assert.equal(f.game.field.stop, request); assert.equal(f.game.state.inBattle, false);
  assert.deepEqual(f.game.state.snapshot(), before);
});

test("an explicit framework fresh entry requires authored handoff policy before opening the same owned lease", () => {
  const f = fresh("framework"), request = f.game.field.stop;
  assert.throws(() => f.game.prepareBattleStart(), /explicit content policy/);
  assert.equal(f.game.state.inBattle, false); assert.equal(f.game.field.stop, request);
  f.battle.encounters[1000]!.handoff = handoffContent();
  const candidate = f.game.prepareBattleStart(); assert.ok(candidate);
  assert.equal(candidate.content.handoff!.policy!.id, "controlled-only");
  assert.equal(f.game.state.inBattle, true); assert.equal(f.game.battle, null);
  candidate.discard(); assert.equal(f.game.state.inBattle, false); assert.equal(f.game.field.stop, request);
});
