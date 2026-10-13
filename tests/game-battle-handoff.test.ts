import test from "node:test";
import assert from "node:assert/strict";
import { GameFlow } from "../src/core/game-flow.js";
import { GameBattleHandoff, type GameBattleStartPresentation, type GameBattleReturnPresentation } from "../src/core/game-battle-handoff.js";
import { GameSession, type PreparedSessionBattleStart } from "../src/core/game-session.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";

const ready = { visible: true, mediaReady: true, overlayOpen: false };
type Presentation = { tag: number; kind: "start" | "retry" | "return" };
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
/** Real session/world/field/owned/battle implementations. Only asynchronous
 * host resources and fault observations are controlled by the tests. */
function fixture() {
  const data = checkpointFixture(), game = new GameSession(data.field, data.battle, 314, { battleHandoff: "prepared" });
  const flow = new GameFlow(game); flow.start(); flow.advance(0, ready);
  const initial = game.checkpoint(), owned = game.state, before = owned.snapshot(), field = game.field;
  field.startEvent("fight");
  const request = field.stop!;
  assert.equal(request.kind, "encounter"); assert.equal(game.battle, null);
  const candidates: PreparedSessionBattleStart[] = [], prepare = game.prepareBattleStart.bind(game);
  game.prepareBattleStart = () => { const next = prepare(); if (next) candidates.push(next); return next; };
  const presentations: Presentation[] = [], discarded: Presentation[] = [];
  const allocate = (candidate: GameBattleStartPresentation | GameBattleReturnPresentation) => {
    const value = { tag: presentations.length + 1, kind: candidate.kind };
    presentations.push(value); return value;
  };
  const host = { prepareStart: async (candidate: GameBattleStartPresentation) => allocate(candidate),
    prepareReturn: async (candidate: GameBattleReturnPresentation) => allocate(candidate),
    discard: (presentation: Presentation) => { discarded.push(presentation); } };
  const unchanged = () => {
    assert.equal(game.field, field); assert.equal(field.stop, request); assert.equal(game.state, owned);
    assert.equal(game.battle, null); assert.equal(owned.inBattle, false); assert.deepEqual(owned.snapshot(), before);
  };
  return { ...data, game, flow, initial, owned, before, field, request, candidates, host, presentations, discarded, unchanged };
}
type Fixture = ReturnType<typeof fixture>;
function victory(f: Fixture) {
  const battle = f.game.battle!;
  for (const [index, actor] of battle.ready.entries())
    assert.equal(battle.command(actor.id, 10, { kind: "single", id: battle.enemies[index]!.id }), true);
  f.flow.advance(2000, ready); assert.equal(battle.phase, "victory"); return battle;
}
function wrapStart(f: Fixture, transform: (candidate: PreparedSessionBattleStart) => PreparedSessionBattleStart) {
  const original = f.game.prepareBattleStart.bind(f.game);
  f.game.prepareBattleStart = () => { const candidate = original(); return candidate && transform(candidate); };
}

test("start preparation failure retains the raw request and shared owner; retry publishes once", async () => {
  const f = fixture(), error = new Error("Controlled decode failure"); let failures = 1;
  const handoff = new GameBattleHandoff(f.flow, { ...f.host,
    prepareStart: async (candidate) => { if (failures-- > 0) throw error; return f.host.prepareStart(candidate); } });
  const failed = await handoff.start(); assert.equal(failed.status, "failed");
  if (failed.status !== "failed") assert.fail("Expected preparation failure");
  assert.equal(failed.error, error); assert.equal(failed.kind, "start"); assert.equal(failed.request, f.request);
  assert.equal(failed.session, f.game); assert.equal(f.flow.busy, false); assert.equal(handoff.busy, false); f.unchanged();
  assert.equal(f.candidates[0]!.commit(), false);
  const started = await handoff.start(); assert.equal(started.status, "committed");
  if (started.status !== "committed") assert.fail("Expected publication");
  assert.equal(started.request, f.request); assert.equal(started.kind, "start"); assert.equal(started.session, f.game);
  assert.equal(f.candidates[1]!.commit(), false); assert.equal(f.game.state.inBattle, true);
  victory(f); assert.equal((await handoff.return()).status, "committed"); f.flow.advance(10, ready);
  assert.equal(f.game.checkpoint().encounterSerial, f.initial.encounterSerial + 1);
  assert.equal(f.owned.snapshot().completedBattles.length, 1);
  await assert.rejects(handoff.start(), /pending encounter/);
});

test("host views are detached data without transaction methods or persistent owner access", async () => {
  const f = fixture(), handoff = new GameBattleHandoff(f.flow, { ...f.host, prepareStart: async (candidate) => {
    assert.equal(Object.isFrozen(candidate), true);
    for (const key of ["commit", "discard", "validate", "publicationStarted"]) assert.equal(key in candidate, false);
    assert.notEqual(candidate.request, f.request);
    candidate.request.party = 9999; candidate.content.players[0]!.hp = 0;
    assert.deepEqual(f.owned.snapshot(), f.before);
    return f.host.prepareStart(candidate);
  } });
  assert.equal((await handoff.start()).status, "committed");
  assert.equal(f.request.party, 1000); assert.equal(f.game.battle!.players[0]!.hp, f.before.roster[0]!.hp);
});

test("pending entry blocks input/clock and excludes concurrent operations without resume catch-up", async () => {
  const f = fixture(), media = deferred<Presentation>();
  const handoff = new GameBattleHandoff(f.flow, { ...f.host, prepareStart: async () => media.promise });
  const time = f.field.time, audio = f.field.bgm.snapshot(), pending = handoff.start();
  assert.equal(f.flow.phase, "battle-entry"); assert.equal(f.flow.inputReady, false); assert.equal(handoff.busy, true);
  f.flow.advance(10000, ready); f.game.advance(10000);
  assert.equal(f.field.time, time); assert.deepEqual(f.field.bgm.snapshot(), audio);
  assert.equal(f.flow.move("right"), false); assert.equal(f.flow.confirm(), false);
  await assert.rejects(handoff.start(), /already in progress/);
  assert.throws(() => f.flow.beginOperation("save"), /already in progress/);
  media.resolve({ tag: 1, kind: "start" }); assert.equal((await pending).status, "committed");
  assert.equal(f.flow.phase, "battle"); f.flow.advance(0, ready);
  assert.deepEqual(f.game.battle!.timingState.input.paused, false);
  assert.equal(f.field.bgm.snapshot().time, audio.time);
});

test("cancelled late media is disposed once and cannot unlock or overwrite a newer battle", async () => {
  const f = fixture(), media = deferred<Presentation>(); let calls = 0;
  const handoff = new GameBattleHandoff(f.flow, { ...f.host,
    prepareStart: async candidate => ++calls === 1 ? media.promise : f.host.prepareStart(candidate) });
  const old = handoff.start(); handoff.cancel(); handoff.cancel(); f.unchanged();
  assert.equal((await handoff.start()).status, "committed"); const current = f.game.battle;
  const newer = f.flow.beginOperation("save"), obsolete: Presentation = { tag: 99, kind: "start" };
  media.resolve(obsolete); assert.equal((await old).status, "cancelled");
  assert.deepEqual(f.discarded, [obsolete]); assert.equal(f.game.battle, current); assert.equal(newer.isCurrent(), true);
  newer.cancel(); handoff.cancel(); assert.deepEqual(f.discarded, [obsolete]);
});

test("title and session replacement revoke a private lease and cancel late rejection without affecting newer I/O", async () => {
  const f = fixture(), media = deferred<Presentation>(), next = checkpointFixture().game;
  const handoff = new GameBattleHandoff(f.flow, { ...f.host, prepareStart: async () => media.promise });
  const old = handoff.start(); assert.equal(f.owned.inBattle, true);
  f.flow.returnToTitle(); assert.equal(f.owned.inBattle, false);
  f.flow.start(next, { paused: true }); const newer = f.flow.beginOperation("load");
  media.reject(new Error("Obsolete media error")); assert.equal((await old).status, "cancelled");
  assert.equal(f.flow.session, next); assert.equal(f.flow.paused, true); assert.equal(newer.isCurrent(), true);
  assert.equal(f.game.battle, null); assert.deepEqual(f.owned.snapshot(), f.before); newer.cancel();
});

test("request mutation cancels rather than redirects publication; field staleness is an explicit retryable failure", async (t) => {
  for (const mutation of ["request", "events"] as const) await t.test(mutation, async () => {
    const f = fixture(), media = deferred<Presentation>();
    const handoff = new GameBattleHandoff(f.flow, { ...f.host, prepareStart: async () => media.promise });
    const pending = handoff.start();
    if (mutation === "request") f.request.party = 9999;
    else f.field.eventState.write({ category: "ScenarioFlag1", index: 28 }, 1);
    media.resolve({ tag: 1, kind: "start" }); const result = await pending;
    assert.equal(result.status, mutation === "request" ? "cancelled" : "failed");
    assert.equal(f.game.battle, null); assert.equal(f.owned.inBattle, false); assert.deepEqual(f.owned.snapshot(), f.before);
    assert.equal(f.field.stop, f.request); assert.equal(f.discarded.length, 1);
    if (mutation === "request") f.request.party = 1000;
    assert.equal((await handoff.start()).status, "committed");
  });
});

test("return preparation failure retains the exact terminal battle and one uncommitted result", async () => {
  const f = fixture(), error = new Error("Controlled return media error"); let failures = 1;
  const handoff = new GameBattleHandoff(f.flow, { ...f.host, prepareReturn: async candidate => {
    if (failures-- > 0) throw error; return f.host.prepareReturn(candidate);
  } });
  await handoff.start(); const terminal = victory(f), owned = f.owned.snapshot();
  const failed = await handoff.return(); assert.equal(failed.status, "failed");
  if (failed.status !== "failed") assert.fail("Expected return preparation failure");
  assert.equal(failed.kind, "return"); assert.equal(failed.request, f.request); assert.equal(failed.error, error);
  assert.equal(f.game.battle, terminal); assert.equal(terminal.phase, "victory"); assert.equal(f.owned.inBattle, true);
  assert.deepEqual(f.owned.snapshot(), owned); assert.equal(f.flow.phase, "victory");
  assert.equal((await handoff.return()).status, "committed");
  assert.equal(f.game.battle, null); assert.equal(f.owned.inBattle, false); assert.equal(f.owned.snapshot().completedBattles.length, 1);
  const after = f.owned.snapshot(); await assert.rejects(handoff.return(), /pending encounter/);
  assert.deepEqual(f.owned.snapshot(), after); f.flow.advance(10, ready);
  assert.equal(f.field.flags.ScenarioFlag1![1], true);
});

test("cancelled return retains its lease; retry settles once and obsolete presentation cannot replace it", async () => {
  const f = fixture(), media = deferred<Presentation>(); let calls = 0;
  const handoff = new GameBattleHandoff(f.flow, { ...f.host,
    prepareReturn: async candidate => ++calls === 1 ? media.promise : f.host.prepareReturn(candidate) });
  await handoff.start(); const terminal = victory(f), owned = f.owned.snapshot(), old = handoff.return();
  assert.equal(f.flow.phase, "battle-return"); f.flow.advance(10000, ready);
  handoff.cancel(); assert.equal(f.game.battle, terminal); assert.equal(f.owned.inBattle, true);
  assert.deepEqual(f.owned.snapshot(), owned); assert.equal((await handoff.return()).status, "committed");
  const after = f.owned.snapshot(), obsolete: Presentation = { tag: 90, kind: "return" };
  media.resolve(obsolete); assert.equal((await old).status, "cancelled");
  assert.deepEqual(f.discarded, [obsolete]); assert.deepEqual(f.owned.snapshot(), after);
  assert.equal(after.completedBattles.length, 1);
});

test("defeat retry prepares privately and reuses the original lease, entry resources and serial", async () => {
  const f = fixture(), error = new Error("Controlled retry decode error"); let failRetry = true;
  const handoff = new GameBattleHandoff(f.flow, { ...f.host, prepareStart: async candidate => {
    if (candidate.kind === "retry" && failRetry) { failRetry = false; throw error; }
    return f.host.prepareStart(candidate);
  } });
  await handoff.start(); const defeated = f.game.battle!, entry = structuredClone(defeated.players);
  for (const player of defeated.players) { player.hp = 0; player.conditionIds = [305]; }
  f.flow.advance(10, ready); assert.equal(defeated.phase, "defeat");
  const failed = await handoff.retry(); assert.equal(failed.status, "failed");
  assert.equal(f.game.battle, defeated); assert.deepEqual(f.owned.snapshot(), f.before); assert.equal(f.owned.inBattle, true);
  const result = await handoff.retry(); assert.equal(result.status, "committed");
  if (result.status !== "committed") assert.fail("Expected retry publication");
  assert.equal(result.kind, "retry"); assert.equal(result.request, f.request); assert.notEqual(f.game.battle, defeated);
  assert.deepEqual(f.game.battle!.players, entry); victory(f); await handoff.return(); f.flow.advance(10, ready);
  assert.equal(f.game.checkpoint().encounterSerial, f.initial.encounterSerial + 1);
  assert.equal(f.owned.snapshot().completedBattles.length, 1);
});

test("reentrant cancellation during candidate creation waits for the returned private candidate before disposal", async () => {
  const f = fixture(), handoff = new GameBattleHandoff(f.flow, f.host);
  wrapStart(f, candidate => { handoff.cancel(); return candidate; });
  assert.equal((await handoff.start()).status, "cancelled"); f.unchanged();
  assert.equal(f.candidates[0]!.commit(), false); assert.equal(f.presentations.length, 0);
});

test("reentrant host cancellation disposes its returned presentation without publishing", async () => {
  const f = fixture(); let handoff!: GameBattleHandoff<Presentation>;
  handoff = new GameBattleHandoff(f.flow, { ...f.host, prepareStart: async candidate => {
    handoff.cancel(); return f.host.prepareStart(candidate);
  } });
  assert.equal((await handoff.start()).status, "cancelled"); f.unchanged();
  assert.deepEqual(f.discarded, f.presentations); assert.equal(f.discarded.length, 1);
});

test("final core validation can return to title or replace the session before publication", async (t) => {
  for (const action of ["title", "replace"] as const) await t.test(action, async () => {
    const f = fixture(), next = checkpointFixture().game, handoff = new GameBattleHandoff(f.flow, f.host);
    const players = f.owned.battlePlayers.bind(f.owned); let validations = 0;
    f.owned.battlePlayers = lease => {
      if (++validations === 2) {
        if (action === "title") f.flow.returnToTitle(); else f.flow.start(next);
      }
      return players(lease);
    };
    assert.equal((await handoff.start()).status, "cancelled");
    assert.equal(f.game.battle, null); assert.equal(f.owned.inBattle, false); assert.deepEqual(f.owned.snapshot(), f.before);
    assert.equal(f.discarded.length, 1);
    if (action === "title") assert.equal(f.flow.phase, "title"); else assert.equal(f.flow.session, next);
  });
});

test("actual return publication refuses title/cancel while keeping the ticket and settles once", async () => {
  const f = fixture(), handoff = new GameBattleHandoff(f.flow, f.host); await handoff.start(); victory(f);
  const prepare = f.owned.prepareVictory.bind(f.owned); let publicationObserved = false;
  f.owned.prepareVictory = (...args) => {
    const owned = prepare(...args);
    return Object.assign(() => {
      publicationObserved = true;
      assert.throws(() => f.flow.returnToTitle(), /publication/);
      assert.throws(() => handoff.cancel(), /publication/);
      assert.equal(f.flow.busy, true); assert.equal(f.flow.phase, "battle-return");
      owned();
    }, { validate: owned.validate, fieldState: owned.fieldState });
  };
  assert.equal((await handoff.return()).status, "committed"); assert.equal(publicationObserved, true);
  assert.equal(f.flow.busy, false); assert.equal(f.owned.snapshot().completedBattles.length, 1);
});

test("BattleGame constructor and final shared validation failures are retryable before publication", async (t) => {
  for (const stage of ["constructor", "final-validation"] as const) await t.test(stage, async () => {
    const f = fixture(), handoff = new GameBattleHandoff(f.flow, f.host);
    const inventory = f.owned.battleInventory.bind(f.owned), players = f.owned.battlePlayers.bind(f.owned);
    const validationError = new Error("Controlled final shared validation failure");
    let constructing = false, fault = true;
    f.owned.battleInventory = lease => {
      const actual = inventory(lease); constructing = true;
      if (stage === "constructor" && fault) { fault = false; return { ...actual, limit: 0 }; }
      return actual;
    };
    f.owned.battlePlayers = lease => {
      if (stage === "final-validation" && constructing && fault) { fault = false; throw validationError; }
      return players(lease);
    };
    const failed = await handoff.start(); assert.equal(failed.status, "failed");
    if (failed.status !== "failed") assert.fail("Expected a retryable prepublication failure");
    assert.equal(constructing, true); assert.equal(failed.kind, "start"); assert.equal(failed.request, f.request);
    if (stage === "constructor") assert.match(String(failed.error), /Invalid inventory limit/);
    else assert.equal(failed.error, validationError);
    assert.equal(f.candidates[0]!.publicationStarted, false); assert.equal(f.candidates[0]!.commit(), false);
    assert.equal(f.discarded.length, 1); assert.equal(f.flow.busy, false); f.unchanged();
    assert.equal((await handoff.start()).status, "committed"); assert.equal(f.candidates[1]!.publicationStarted, true);
    victory(f); await handoff.return(); f.flow.advance(10, ready);
    assert.equal(f.game.checkpoint().encounterSerial, f.initial.encounterSerial + 1);
    assert.equal(f.owned.snapshot().completedBattles.length, 1);
  });
});

test("the repeated return validation still fails before owned publication and can be prepared again", async () => {
  const f = fixture(), handoff = new GameBattleHandoff(f.flow, f.host); await handoff.start();
  const terminal = victory(f), before = f.owned.snapshot(), error = new Error("Controlled final return validation failure");
  const prepareOwned = f.owned.prepareVictory.bind(f.owned), prepareField = f.field.prepareEncounterReturn.bind(f.field);
  const prepareReturn = f.game.prepareBattleReturn.bind(f.game); let finalValidation = false, fault = true;
  let candidate: ReturnType<GameSession["prepareBattleReturn"]> = null;
  f.game.prepareBattleReturn = () => { candidate = prepareReturn(); return candidate; };
  f.owned.prepareVictory = (...args) => {
    const owned = prepareOwned(...args);
    return Object.assign(() => owned(), { fieldState: owned.fieldState, validate: () => {
      if (finalValidation && fault) { fault = false; throw error; }
      owned.validate();
    } });
  };
  f.field.prepareEncounterReturn = (...args) => {
    const resume = prepareField(...args);
    return Object.assign(() => resume(), { validate: resume.validate,
      commitWith: (write: () => void) => { finalValidation = true; resume.commitWith(write); } });
  };
  const failed = await handoff.return(); assert.equal(failed.status, "failed");
  if (failed.status !== "failed") assert.fail("Expected a retryable final return validation failure");
  assert.equal(failed.error, error); assert.equal(failed.kind, "return"); assert.equal(failed.request, f.request);
  assert.equal(candidate!.publicationStarted, false); assert.equal(f.game.battle, terminal); assert.equal(f.owned.inBattle, true);
  assert.deepEqual(f.owned.snapshot(), before); assert.equal(f.discarded.length, 1);
  assert.equal((await handoff.return()).status, "committed"); assert.equal(candidate!.publicationStarted, true);
  assert.equal(f.owned.snapshot().completedBattles.length, 1); assert.equal(f.owned.inBattle, false);
});

test("an exception after the actual owned return commit stays fatal and cannot award twice", async () => {
  const f = fixture(), handoff = new GameBattleHandoff(f.flow, f.host); await handoff.start();
  const terminal = victory(f), error = new Error("Controlled failure after owned return publication");
  const prepare = f.owned.prepareVictory.bind(f.owned), prepareReturn = f.game.prepareBattleReturn.bind(f.game);
  let candidate: ReturnType<GameSession["prepareBattleReturn"]> = null;
  f.game.prepareBattleReturn = () => { candidate = prepareReturn(); return candidate; };
  f.owned.prepareVictory = (...args) => {
    const owned = prepare(...args);
    return Object.assign(() => { owned(); throw error; }, { validate: owned.validate, fieldState: owned.fieldState });
  };
  await assert.rejects(handoff.return(), caught => caught === error);
  assert.equal(candidate!.publicationStarted, true); assert.equal(f.game.battle, terminal);
  assert.equal(f.owned.inBattle, false); assert.equal(f.owned.snapshot().completedBattles.length, 1);
  assert.equal(f.flow.busy, false); assert.equal(handoff.busy, false); assert.equal(f.discarded.length, 1);
  const settled = f.owned.snapshot(); assert.throws(() => f.game.prepareBattleReturn(), /Stale battle lease/);
  assert.deepEqual(f.owned.snapshot(), settled);
});

test("a false core commit is an explicit stale failure and a throwing publication remains fatal", async (t) => {
  await t.test("false", async () => {
    const f = fixture(), handoff = new GameBattleHandoff(f.flow, f.host);
    wrapStart(f, candidate => ({ ...candidate, get publicationStarted() { return candidate.publicationStarted; },
      commit: () => { candidate.discard(); return false; } }));
    const result = await handoff.start(); assert.equal(result.status, "failed");
    if (result.status !== "failed") assert.fail("Expected stale failure");
    assert.match(String(result.error), /state changed/); f.unchanged(); assert.equal(f.discarded.length, 1);
  });
  await t.test("published then throw", async () => {
    const f = fixture(), error = new Error("Publication violated its contract"), handoff = new GameBattleHandoff(f.flow, f.host);
    wrapStart(f, candidate => ({ ...candidate, get publicationStarted() { return candidate.publicationStarted; },
      commit: () => { assert.equal(candidate.commit(), true); throw error; } }));
    await assert.rejects(handoff.start(), caught => caught === error);
    assert.ok(f.game.battle); assert.equal(f.owned.inBattle, true); assert.equal(f.flow.busy, false);
    await assert.rejects(handoff.start(), /pending encounter/); assert.equal(f.discarded.length, 1);
  });
});

test("cleanup errors remain diagnostics and undefined is still a disposable presentation", async (t) => {
  await t.test("cleanup", async () => {
    const f = fixture(), error = new Error("Primary prepare failure"), cleanup = new Error("Candidate disposal fault");
    wrapStart(f, candidate => ({ ...candidate, get publicationStarted() { return candidate.publicationStarted; },
      discard: () => { candidate.discard(); throw cleanup; } }));
    const handoff = new GameBattleHandoff(f.flow, { ...f.host, prepareStart: async () => { throw error; } });
    const result = await handoff.start(); assert.equal(result.status, "failed");
    if (result.status !== "failed") assert.fail("Expected failure");
    assert.equal(result.error, error); assert.deepEqual(result.cleanupErrors, [cleanup]); f.unchanged();
  });
  await t.test("undefined", async () => {
    const f = fixture(), media = deferred<undefined>(), discarded: undefined[] = [];
    const handoff = new GameBattleHandoff(f.flow, { prepareStart: async () => media.promise,
      prepareReturn: async () => undefined, discard: value => { discarded.push(value); } });
    const pending = handoff.start(); handoff.cancel(); media.resolve(undefined);
    assert.equal((await pending).status, "cancelled"); assert.deepEqual(discarded, [undefined]); f.unchanged();
  });
});

test("Flow guards run before owner invalidation, reject reentry, and never run for finish or a stale ticket", () => {
  const f = fixture(), next = checkpointFixture().game, error = new Error("Publishing cannot be revoked");
  const ticket = f.flow.beginOperation("battle-entry"); let calls = 0;
  const unguard = ticket.onInvalidate(() => { calls++; throw error; });
  assert.throws(() => f.flow.returnToTitle(), caught => caught === error);
  assert.throws(() => f.flow.start(next), caught => caught === error);
  assert.throws(() => ticket.cancel(), caught => caught === error);
  assert.equal(ticket.isCurrent(), true); assert.equal(f.flow.session, f.game); assert.equal(f.flow.started, true);
  unguard(); ticket.onInvalidate(() => { throw new Error("finish must not invoke a guard"); });
  assert.equal(ticket.finish(), true); const newer = f.flow.beginOperation("battle-return");
  ticket.cancel(); assert.equal(ticket.finish(), false); assert.equal(newer.isCurrent(), true); assert.equal(calls, 3);
  const remove = newer.onInvalidate(() => { newer.finish(); });
  assert.throws(() => f.flow.returnToTitle(), /during invalidation/); assert.equal(newer.isCurrent(), true);
  remove(); const removeReentry = newer.onInvalidate(() => { f.flow.start(next); });
  assert.throws(() => f.flow.returnToTitle(), /Reentrant/); assert.equal(newer.isCurrent(), true); assert.equal(f.flow.session, f.game);
  removeReentry(); newer.cancel(); assert.equal(f.flow.busy, false);
});
