import test from "node:test";
import assert from "node:assert/strict";
import { BattleGame } from "../src/core/battle.js";
import { GameState } from "../src/core/game-state.js";
import { GameSession } from "../src/core/game-session.js";
import { GameFlow } from "../src/core/game-flow.js";
import { GameCommands } from "../src/core/game-commands.js";
import { GameBattleHandoff } from "../src/core/game-battle-handoff.js";
import { CheckpointStorage } from "../src/core/saved-game.js";
import { WEB_BATTLE_EVENT_CONTROLS } from "../src/core/battle-controls.js";
import { WEB_SCRIPTED_BATTLE_ACTIONS } from "../src/core/scripted-battle-action.js";
import { WEB_BATTLE_EVENT_EFFECTS, createWebBattleEventEffectHost } from "../src/core/battle-event-effect.js";
import { projectCommittedBattleResult } from "../src/core/source-battle-result.js";
import { parseBattleForcedReturnResult } from "../src/core/battle-forced-return.js";
import { advanceBattleEvent, createBattleEventState } from "../src/core/battle-event.js";
import { battleMessageContent, battleMessageProgram, battleMessageSessionFixture, messageRaw } from "./fixtures/battle-event-message.js";
import { playerSessionFixture } from "./fixtures/battle-player-game.js";
import { authoredBattleEffect } from "./fixtures/battle-event-effect.js";

const ready = { visible: true, mediaReady: true, overlayOpen: false };
const force = () => messageRaw("BattleForceExit");
const program = () => battleMessageProgram([force(), messageRaw("Wait", .1), messageRaw("Exit")]);
function setup(p = program()) {
  const f = battleMessageSessionFixture(p), runtime = { ...f.runtime, battleEventControls: WEB_BATTLE_EVENT_CONTROLS },
    game = new GameSession(f.field, f.battle, 314, runtime), flow = new GameFlow(game);
  game.field.eventState.write({ category: "ScenarioVariable", index: 3 }, 0);
  flow.start(); flow.advance(0, ready); assert(game.field.startEvent("fight")); flow.advance(10, ready);
  assert(game.prepareBattleStart()!.commit()); return { ...f, runtime, game, flow, battle: game.battle! };
}
function forced(f: ReturnType<typeof setup>) { f.flow.advance(10, ready); assert.equal(f.battle.phase, "forced"); }
const ownedWithoutReceipts = (state: ReturnType<GameState["snapshot"]>) => ({ ...state, completedBattles: [] });

test("whole no-save instruction shape is admitted while Save and every altered unused operand stay explicit", () => {
  assert.deepEqual(program().instructions[0]!.op, { kind: "force-return" });
  for (const key of ["iValues", "rValues", "sValues"] as const) {
    const changed = force(); (changed.operands[key] as (string | number)[])[7] = key === "sValues" ? "unknown" : 1;
    assert.equal(battleMessageProgram([changed, messageRaw("Exit")]).instructions[0]!.op.kind, "blocked");
  }
  const saved = battleMessageProgram([messageRaw("BattleForceExitOnSave"), messageRaw("Exit")]);
  assert.throws(() => createBattleEventState(saved), /owned Corps layout.*nonparticipant recovery.*retained steal\/drop/);
  assert.throws(() => new BattleGame(battleMessageContent(program()), 1), /explicit Web battle event control policy/);
});

test("force yields Next; later instructions and wait survive without an invented Exit", () => {
  const p = program(), state = createBattleEventState(p), context = { clock: 1, timeSeconds: .01,
    started: true, aiCoreAlive: false, actionStaging: true };
  const next = advanceBattleEvent(p, state, context);
  assert.deepEqual(next.requests, [{ kind: "force-return", pc: 0 }]); assert.equal(next.state.pc, 1);
  assert.equal(next.state.status, "running");
  const after = advanceBattleEvent(p, next.state, context); assert.equal(after.state.wait?.kind, "time");
  assert.equal(after.state.pc, 1); assert.equal(after.state.status, "waiting");
});

test("forced judgment outranks dead players, living enemies and a queued scripted action, with no reward or queue execution", () => {
  const p = program(); p.instructions.splice(1, 0, { mnemonic: "BattleAction", op: { kind: "script-action",
    sourceActorKind: 1, sourceTargetKind: 1, asynchronous: true,
    actor: { side: "player", id: 1000 }, target: { side: "player", id: 1001 }, abilityId: 11 } }); p.end++;
  const content = battleMessageContent(p), b = new BattleGame(content, 3, undefined, undefined, undefined, undefined, undefined, undefined,
    { controls: WEB_BATTLE_EVENT_CONTROLS, scriptedActions: WEB_SCRIPTED_BATTLE_ACTIONS });
  for (const player of b.players) { player.hp = 0; player.conditionIds = [305]; }
  b.advance(10); assert.equal(b.phase, "forced"); assert.equal(b.reward, null);
  assert(b.enemies.every(enemy => enemy.hp > 0)); assert.equal(b.pendingActions.length, 1);
  const before = structuredClone(b.combatants); b.advance(1000); assert.deepEqual(b.combatants, before);
  assert.equal(b.previewVictory(), null); assert.equal(b.previewEscape(), null); assert.equal(b.ready.length, 0);
});

test("a forced request stops a real staged action before its unresolved hit and retires it with the battle", () => {
  const p = battleMessageProgram([messageRaw("Wait", .05), force(), messageRaw("Wait", .1), messageRaw("Exit")]),
    b = new BattleGame(battleMessageContent(p), 8, undefined, undefined, undefined, undefined, undefined, undefined,
      { controls: WEB_BATTLE_EVENT_CONTROLS });
  assert(b.command(b.players[0]!.id, 10, b.enemies[0]!.id)); b.advance(10); assert(b.action);
  assert.equal(b.action.resolved, false); const hp = b.enemies.map(enemy => enemy.hp);
  b.advance(60); assert.equal(b.phase, "forced"); assert(b.action); assert.equal(b.action.resolved, false);
  b.advance(1000); assert.deepEqual(b.enemies.map(enemy => enemy.hp), hp); assert.equal(b.reward, null);
});

test("disabled end judgment retains the force request until the source later enables it", () => {
  const enabled = messageRaw("BattleEndEnabled"); enabled.operands.iValues[0] = 1;
  const f = setup(battleMessageProgram([messageRaw("BattleEndEnabled"), force(), messageRaw("Wait", .03), enabled, messageRaw("Exit")]));
  f.flow.advance(20, ready); assert.equal(f.battle.phase, "active");
  f.flow.advance(30, ready); assert.equal(f.battle.phase, "forced"); assert.equal(f.battle.reward, null);
});

test("writes after the request stay staged and join the same owned field-return publication", () => {
  const p = program(), ref = { category: "ScenarioVariable" as const, index: 3 };
  p.instructions.splice(1, 0, { mnemonic: "Calc", op: { kind: "variable-calc", left: ref,
    operator: "←", right: { kind: "immediate", value: 7 } } }); p.end++;
  const f = setup(p); forced(f);
  assert.equal(f.game.field.eventState.read(ref), 0);
  assert.equal(f.battle.eventSharedReturn!.candidate.global[3], 7);
  const cancelled = f.game.prepareBattleReturn()!; cancelled.discard(); assert.equal(f.game.field.eventState.read(ref), 0);
  assert(f.game.prepareBattleReturn()!.commit()); assert.equal(f.game.field.eventState.read(ref), 7);
});

test("forced no-save preserves owned resources, conditions, rows, equipment, inventory, growth and currency exactly once", () => {
  const f = setup(), before = f.game.state.snapshot();
  f.battle.players[0]!.hp = 1; f.battle.players[0]!.mp = 0; f.battle.players[0]!.row = "back";
  forced(f); const candidate = f.game.prepareBattleReturn()!;
  assert.equal(candidate.outcome, "forced"); assert.deepEqual(f.game.state.snapshot(), before);
  assert(candidate.commit()); const after = f.game.state.snapshot();
  assert.deepEqual(ownedWithoutReceipts(after), ownedWithoutReceipts(before));
  assert.deepEqual(after.completedBattles, [{ serial: 0, encounterId: 1000, outcome: "forced" }]);
  assert.deepEqual(f.game.state.completedEncounters, []); assert.equal(f.game.state.inBattle, false);
  assert.equal(candidate.commit(), false); assert.equal(f.battle.takeForcedReturn(), null);
  assert.throws(() => projectCommittedBattleResult(after, 1), /previous-result publication and current Corps eligibility projection/);
});

test("a forced return validates dynamic borrowed history but preserves the original saved groups and disabled owners", () => {
  const f = playerSessionFixture([{ kind: "add-player", sourceId: 33 }, { kind: "wait", seconds: .01 },
    { kind: "change-player-group", group: 1 }, { kind: "wait", seconds: .01 }, { kind: "force-return" }]),
    game = new GameSession(f.field, f.battle, 71, { battleEventControls: WEB_BATTLE_EVENT_CONTROLS });
  const before = game.state.snapshot(); game.field.startEvent("fight");
  for (let n = 0; n < 20 && game.battle?.phase !== "forced"; n++) game.advance(10);
  assert.equal(game.battle!.phase, "forced"); const b = game.battle!, result = b.previewForcedReturn()!;
  assert(result.participants.some(p => p.sourceId === 33));
  const changed = structuredClone(result); changed.participants[0]!.sourceId++;
  const lease = { serial: 0, encounterId: 1000 };
  assert.throws(() => game.state.prepareForcedReturn(lease, changed), /Stale battle lease/);
  assert(game.continueForcedReturn()); assert.deepEqual(ownedWithoutReceipts(game.state.snapshot()), ownedWithoutReceipts(before));
});

test("malformed resource-bearing or identity-changing forced envelopes cannot release an owned lease", () => {
  const f = setup(), state = f.game.state;
  assert.throws(() => parseBattleForcedReturnResult({ ...f.battle.previewForcedReturn(), players: [] }), /checkpoint fields/);
  const { battle } = battleMessageSessionFixture(), owned = new GameState(battle.gameState, battle.common.players, battle.contentHash, battle.common.conditions),
    lease = owned.openBattle(1000), result = { kind: "battle-no-save-return-v1" as const, resultType: 4 as const,
      participants: owned.battlePlayers(lease).map(p => ({ ownedId: p.id, sourceId: p.sourceId })) }, before = owned.snapshot();
  for (const change of [(r: typeof result) => { r.participants[0]!.sourceId++; },
    (r: typeof result) => { r.participants.reverse(); }, (r: typeof result) => { r.participants.push(r.participants[0]!); }]) {
    const changed = structuredClone(result); change(changed); assert.throws(() => owned.prepareForcedReturn(lease, changed), /identity/);
    assert.deepEqual(owned.snapshot(), before); assert.equal(owned.inBattle, true);
  }
  const commit = owned.prepareForcedReturn(lease, result); result.participants[0]!.sourceId++;
  commit(); assert.throws(commit, /Stale/); assert.equal(state.inBattle, true);
  const saved = owned.snapshot(), historical = { ...saved, formatVersion: 11,
    roster: saved.roster.map(({ magicLearningValue: _, ...member }) => member) };
  const fresh = new GameState(battle.gameState, battle.common.players, battle.contentHash, battle.common.conditions);
  assert.throws(() => fresh.restore(historical as never), /historical battle receipt outcome/);
});

test("cancelled, failed and stale return candidates retain the terminal owner; actual handoff retries and settles once", async () => {
  const f = setup(); forced(f); const before = f.game.state.snapshot(), commands = new GameCommands(f.flow, f.game);
  assert.equal(commands.canReturnBattle(f.battle), true); assert.equal(commands.canRetryBattle(f.battle), false);
  const cancelled = f.game.prepareBattleReturn()!; cancelled.discard(); assert.equal(cancelled.commit(), false);
  const stale = f.game.prepareBattleReturn()!; f.battle.players[0]!.hp--; assert.equal(stale.commit(), false);
  let finish!: (v: null) => void;
  const handoff = new GameBattleHandoff(f.flow, { async prepareStart() { return null; },
    prepareReturn() { return new Promise<null>(resolve => { finish = resolve; }); }, discard() {} });
  const pending = handoff.return(); handoff.cancel(); finish(null); assert.equal((await pending).status, "cancelled");
  assert.equal(f.game.battle, f.battle); assert.deepEqual(f.game.state.snapshot(), before);
  let fail = true;
  const retry = new GameBattleHandoff(f.flow, { async prepareStart() { return null; },
    async prepareReturn(candidate) { assert.equal(candidate.outcome, "forced"); if (fail) throw Error("authored media refusal"); return null; }, discard() {} });
  assert.equal((await retry.return()).status, "failed"); assert.equal(f.game.battle, f.battle);
  fail = false; assert.equal((await retry.return()).status, "committed"); assert.equal(f.game.battle, null);
  assert.equal(commands.canReturnBattle(f.battle), false); assert.deepEqual(f.game.state.snapshot().completedBattles.map(b => b.outcome), ["forced"]);
});

test("forced receipts survive real checkpoint Storage restore and a second complete battle lease", async () => {
  const f = setup(); forced(f); assert(f.game.prepareBattleReturn()!.commit()); f.game.advance(10);
  const values = new Map<string, string>(), storage = new CheckpointStorage({ getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } });
  await storage.save(f.game.checkpoint(), 1000); const saved = await storage.load(); assert(saved);
  const restored = GameSession.restore(saved.checkpoint, f.field, f.game.battleCatalog, undefined, f.runtime);
  assert.deepEqual(restored.checkpoint(), saved.checkpoint); assert(restored.field.startEvent("fight")); restored.advance(10);
  assert(restored.prepareBattleStart()!.commit()); restored.advance(10); assert.equal(restored.battle!.phase, "forced");
  assert(restored.prepareBattleReturn()!.commit()); assert.deepEqual(restored.state.snapshot().completedBattles.map(b => b.outcome), ["forced", "forced"]);
});

test("same-frame forced request, Msg and effect failures roll back together; successful retirement contains throwing cleanup", () => {
  const p = battleMessageProgram([force(), messageRaw("Nop"), messageRaw("Msg", -1, "ASYNC"), messageRaw("Wait", .1), messageRaw("Exit")]);
  p.instructions[1]!.op = authoredBattleEffect(1); const f = battleMessageSessionFixture(p), base = createWebBattleEventEffectHost();
  let fail = true, discards = 0;
  const game = new GameSession(f.field, f.battle, 9, { ...f.runtime, battleEventControls: WEB_BATTLE_EVENT_CONTROLS,
    battleEventEffects: { policy: WEB_BATTLE_EVENT_EFFECTS, prepare(request) { const resource = base.prepare(request); return { ...resource,
      commit() { if (fail) throw Error("authored effect commit failure"); resource.commit(); },
      discard() { discards++; throw Error("authored discard failure"); } }; } } });
  game.field.startEvent("fight"); game.advance(10); assert(game.prepareBattleStart()!.commit());
  const b = game.battle!, owner = game.field.sourceMessage, before = { event: b.eventExecution, message: owner.snapshot(), revision: owner.mutationRevision, owned: game.state.snapshot() };
  assert.throws(() => game.advance(10), /authored effect commit failure/);
  assert.equal(b.phase, "active"); assert.deepEqual({ event: b.eventExecution, message: owner.snapshot(), revision: owner.mutationRevision, owned: game.state.snapshot() }, before);
  fail = false; b.advance(0); assert.equal(b.phase, "forced"); assert.equal(owner.active, true);
  const candidate = game.prepareBattleReturn()!; candidate.discard(); assert.equal(owner.active, true);
  assert(game.prepareBattleReturn()!.commit()); assert.equal(owner.active, false); assert.equal(b.effectPresentation.length, 0);
  assert.equal(discards, 2); assert.throws(() => b.advance(10), /Retired/); assert.equal(game.state.snapshot().completedBattles.length, 1);
});
