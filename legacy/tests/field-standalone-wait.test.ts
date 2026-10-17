import test from "node:test";
import assert from "node:assert/strict";
import { compileFieldStandaloneWaitInstruction, sourceStandaloneWaitSelector } from "../src/compiler/field-standalone-wait.js";
import { decodeFieldOp } from "../src/compiler/field.js";
import { initialFieldCoreRegisters } from "../src/core/field-core-registers.js";
import { EventState } from "../src/core/event-state.js";
import { FieldGame } from "../src/core/field.js";
import { transitionFixture, set, mapVar, exit } from "./fixtures/event-script-transition.js";
import { GameSession } from "../src/core/game-session.js";
import { GameFlow } from "../src/core/game-flow.js";
import { GameEventSaveCoordinator } from "../src/core/game-event-save.js";
import { CheckpointStorage } from "../src/core/saved-game.js";
import { gameEventSaveFixture, eventSaveReadyHost, afterEventSave } from "./fixtures/game-event-save.js";
import type { Op } from "../src/field/types.js";
import { reachableFrontierFixture } from "./fixtures/reachable-frontiers.js";
import { exploreReachableFrontiers } from "../src/tools/reachable-frontiers.js";

const wait = { kind: "standalone-wait" } as const;
const raw = () => ({ type: 1, mnemonic: "SysCall", operands: {
  iValues: Array(8).fill(0), rValues: Array(8).fill(0), sValues: [sourceStandaloneWaitSelector, ...Array(7).fill("")] } });
const tasks = (field: object): any[] => Reflect.get(field, "tasks");

test("the source platform wait has a distinct exact decoder and retains its original site", () => {
  assert.deepEqual(compileFieldStandaloneWaitInstruction(raw()), wait);
  const site = { script: "main", index: 61, source: { file: "synthetic", assetPath: "timing", objectId: "9223372036854775807" } };
  assert.deepEqual(decodeFieldOp(raw(), site, {}), { ...wait, ...site });
  for (const mutate of [
    (v: ReturnType<typeof raw>) => v.type = 2,
    (v: ReturnType<typeof raw>) => v.operands.sValues[0] += " ",
    (v: ReturnType<typeof raw>) => v.operands.sValues[1] = "unused unknown",
    (v: ReturnType<typeof raw>) => v.operands.iValues[0] = 7,
    (v: ReturnType<typeof raw>) => v.operands.rValues[0] = .5,
    (v: ReturnType<typeof raw>) => v.operands.sValues.pop(),
  ]) { const value = raw(); mutate(value); assert.throws(() => compileFieldStandaloneWaitInstruction(value)); }
  const value = raw(); let called = false;
  Object.defineProperty(value.operands.rValues, "0", { enumerable: true, get() { called = true; return 0; } });
  assert.throws(() => compileFieldStandaloneWaitInstruction(value)); assert.equal(called, false);
});

// Absolute seconds at entry=.05 retain the source subtraction boundary:
// .06-.05 < .01 and .15-.05 < .1. Do not replace it with rounded countdowns.
for (const [milliseconds, waitMilliseconds] of [[-2147483648, 10], [-1, 10], [0, 10], [1, 10],
  [10, 20], [11, 20], [35, 40], [100, 110]] as const)
  test(`MapLocal[7]=${milliseconds} yields on its first clock and resumes at the source boundary`, () => {
    const f = transitionFixture({ main: [wait, set(mapVar(), 1), exit] });
    f.state.write(mapVar(7), milliseconds); const field = f.create(); field.advance(50); field.startEvent("main");
    const bank = tasks(field)[0].generalRegisters;
    assert.deepEqual(bank.i, initialFieldCoreRegisters().i); assert.deepEqual(bank.s, initialFieldCoreRegisters().s);
    assert.equal(bank.r[0], milliseconds / 1000); assert.equal(bank.r[1], .05);
    assert.equal(f.state.read(mapVar()), 0); field.advance(0); assert.equal(f.state.read(mapVar()), 0);
    assert.equal(field.checkpointReady, false); assert.throws(() => field.checkpoint());
    f.state.write(mapVar(7), 2147483647); // Capture once, never reread a later write.
    const clocks = waitMilliseconds / 10;
    for (let clock = 1; clock < clocks; clock++) { field.advance(10); assert.equal(f.state.read(mapVar()), 0); }
    field.advance(10); assert.equal(f.state.read(mapVar()), 1); assert.equal(field.stop, null);
    assert.equal(field.checkpointReady, true); assert.equal(tasks(field)[0].generalRegisters, bank);
  });

test("unknown map-local state fails without publishing Core timing registers or running the continuation", () => {
  const f = transitionFixture({ main: [wait, set(mapVar(), 1), exit] });
  const snapshot = f.state.snapshot(); snapshot.map[7] = null;
  const state = new EventState(snapshot), field = new FieldGame(f.content, state); field.startEvent("main");
  assert.match(field.stop?.message ?? "", /MapLocalVariable\[7\]/);
  assert.deepEqual(tasks(field)[0].generalRegisters, initialFieldCoreRegisters());
  assert.equal(state.read(mapVar()), 0);
});

test("a waiting Core rejects changed source instruction or register ownership", () => {
  for (const corrupt of [(task: any) => task.generalRegisters = initialFieldCoreRegisters(),
    (task: any) => task.pc++, (task: any) => task.standaloneWait.op.index++]) {
    const f = transitionFixture({ main: [set(mapVar(7), 30), wait, set(mapVar(), 1), exit] });
    const field = f.create(); field.startEvent("main"); corrupt(tasks(field)[0]); field.advance(40);
    assert.match(field.stop?.message ?? "", /lost its source instruction or Core registers/);
    assert.equal(f.state.read(mapVar()), 0);
  }
});

test("Session and durable event saving preserve the completed register bank and never repeat timing or grants", async () => {
  const f = gameEventSaveFixture(), original = f.field.scripts.saveFlow!;
  const commands = [set(mapVar(7), 35), original[0]!, wait, original[1]!,
    set(mapVar(7), 0), wait, ...original.slice(2)];
  f.field.scripts.saveFlow = commands.map((op, index) => ({ ...op, script: "saveFlow", index,
    source: { file: "synthetic", assetPath: "standalone-wait-save" } } as Op));
  const session = new GameSession(f.field, f.battle, 314), flow = new GameFlow(session);
  flow.start(); flow.advance(0, eventSaveReadyHost); session.field.eventState.write(afterEventSave, 0);
  const memory = new Map<string, string>(); let fail = true;
  const storage = new CheckpointStorage({ getItem: key => memory.get(key) ?? null,
    setItem: (key, value) => { if (fail) throw Error("controlled storage quota"); memory.set(key, value); } });
  assert.equal(session.field.startEvent("saveFlow"), true); assert.equal(f.itemCount(session), 2);
  flow.advance(1000, { ...eventSaveReadyHost, overlayOpen: true }); assert.equal(session.field.time, 0);
  flow.advance(30, eventSaveReadyHost); assert.equal(session.eventSaveRequest, null);
  flow.advance(10, eventSaveReadyHost); assert.ok(session.eventSaveRequest);
  const savedBank = structuredClone(tasks(session.field)[0].generalRegisters);
  assert.equal((await new GameEventSaveCoordinator(flow, storage).save(1)).status, "failed");
  assert.ok(session.eventSaveRequest); assert.equal(f.itemCount(session), 2); fail = false;
  assert.equal((await new GameEventSaveCoordinator(flow, storage).save(1)).status, "committed");
  const saved = (await storage.load())!, restored = GameSession.restore(saved.checkpoint, f.field, f.battle);
  assert.deepEqual(tasks(restored.field)[0].generalRegisters, savedBank);
  for (const owner of [session, restored]) {
    owner.advance(10); assert.equal(owner.checkpointReady, false); assert.equal(f.itemCount(owner), 2);
    owner.advance(0); assert.equal(f.itemCount(owner), 2);
    owner.advance(10); assert.equal(owner.checkpointReady, true); assert.equal(f.itemCount(owner), 5);
    assert.equal(owner.field.eventState.read(afterEventSave), 1);
  }
  assert.deepEqual(restored.checkpoint(), session.checkpoint());
});

test("actual input, map loading, timed source-style calls, battle return and durable saving keep one continuous Session", async () => {
  const f = await reachableFrontierFixture({ forcedBattle: true, standaloneTiming: true });
  const report = await exploreReachableFrontiers(f.host, { maxRuns: 90, maxDepth: 64, maxTicksPerRun: 1500 });
  assert.ok(report.runs.flatMap(run => run.inputs).some((input: any) =>
    input.kind === "automatic-battle-return" && input.outcome === "forced"));
  assert.ok(report.reached.some(point => point.mapId === f.ids[2]));
  assert.ok(report.anchors.some(anchor => anchor.reason === "source-event-save"));
  assert.ok(f.counts().restores > 0);
  assert.ok(!report.frontiers.some(frontier => frontier.capability === "logical-clock"));
  for (const game of f.seenSessions) {
    const battles = game.state.snapshot().completedBattles;
    // The fixture intentionally loops back and permits another real battle.
    // A repeated visit is valid; duplicate publication of one serial is not.
    assert.equal(new Set(battles.map(battle => battle.serial)).size, battles.length);
    assert.ok(battles.every(battle => battle.outcome === "forced"));
  }
  assert.ok(f.seenSessions.every(game => game.state.completedEncounters.length === 0));
  assert.equal(report.origin, "authored-mechanism"); assert.equal(report.sourceCampaignComplete, false);
});
